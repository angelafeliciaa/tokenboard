// One-off ops script: reprice usage_day rows stored under an older price-table version (e.g. models
// that were $0 because the snapshot predated them). A CLI re-sync can NOT fix these: the Idempotency-Key
// is a hash of each chunk, so the server replays the stored response for an already-seen chunk and never
// reprices it. Instead this recomputes cost_usd from the stored token columns with the same priceRecord
// path a sync uses, bumps price_table_version, recomputes usage_day_total, then runs the board rebuild.
//
// Default is a DRY RUN (read-only, prints counts). Writing needs an explicit --write.
// Idempotent: rows already on the current version are skipped; a rerun after a failure resumes, and
// --write always ends with a rebuild so a crash between the DB update and the rebuild self-heals.
// Run: cd web && pnpm exec dotenv -e ../.env -- tsx --conditions react-server scripts/reprice-usage-days.ts [--write] [--batch-days N]
import { sql } from "drizzle-orm";
import { loadPriceTable, PRICE_TABLE_VERSION } from "@tokenboard/cost";
import { db } from "@/db/client";
import { sumCostUsd } from "@/lib/sync/compute-cost";
import { planReprice, type RepriceUpdate, type StoredUsageDay } from "@/lib/sync/plan-reprice";

const DEFAULT_BATCH_DAYS = 200;
const USAGE = "usage: reprice-usage-days.ts [--write] [--batch-days N]";

function parseArgs(argv: string[]): { write: boolean; batchDays: number } {
  let write = false;
  let batchDays = DEFAULT_BATCH_DAYS;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--write") write = true;
    else if (arg === "--batch-days") {
      batchDays = Number(argv[++i]);
      if (!Number.isInteger(batchDays) || batchDays < 1) throw new Error(`--batch-days needs a positive integer. ${USAGE}`);
    } else throw new Error(`unknown argument "${arg}". ${USAGE}`);
  }
  return { write, batchDays };
}

interface DayKey {
  userId: string;
  date: string;
}

// Keyset page over the distinct (user, date) pairs that still hold a stale row. Paging by key (not
// OFFSET) keeps the dry run and the write run identical even though writing shrinks the stale set.
async function nextStaleDays(after: DayKey | null, limit: number): Promise<DayKey[]> {
  const cursorUser = after?.userId ?? "";
  const cursorDate = after?.date ?? "";
  const rows = (await db.execute(sql`
    select user_id::text as user_id, date::text as date
    from usage_day
    where price_table_version <> ${PRICE_TABLE_VERSION}
      and (user_id::text, date::text) > (${cursorUser}, ${cursorDate})
    group by user_id, date
    order by user_id::text, date::text
    limit ${limit}
  `)) as unknown as Array<{ user_id: string; date: string }>;
  return rows.map((r) => ({ userId: r.user_id, date: r.date }));
}

type Executor = Pick<typeof db, "execute">;

async function readStaleRows(ex: Executor, days: DayKey[]): Promise<StoredUsageDay[]> {
  const pairs = sql.join(days.map((d) => sql`(${d.userId}::uuid, ${d.date}::date)`), sql`, `);
  const rows = (await ex.execute(sql`
    select user_id::text as user_id, device_id::text as device_id, date::text as date, tool, model,
           input_tokens::text as input, output_tokens::text as output,
           cache_read_tokens::text as cache_read, cache_create_5m::text as cache_create_5m,
           cache_create_1h::text as cache_create_1h, cost_usd::text as cost_usd,
           price_table_version
    from usage_day
    where (user_id, date) in (${pairs}) and price_table_version <> ${PRICE_TABLE_VERSION}
  `)) as unknown as Array<Record<string, string>>;
  return rows.map((r) => ({
    userId: r.user_id!,
    deviceId: r.device_id!,
    date: r.date!,
    tool: r.tool!,
    model: r.model!,
    input: r.input!,
    output: r.output!,
    cacheRead: r.cache_read!,
    cacheCreate5m: r.cache_create_5m!,
    cacheCreate1h: r.cache_create_1h!,
    costUsd: r.cost_usd!,
    priceTableVersion: r.price_table_version!,
  }));
}

async function applyUpdate(ex: Executor, u: RepriceUpdate): Promise<void> {
  const r = u.row;
  const result = await ex.execute(sql`
    update usage_day
       set cost_usd = ${u.costUsd6dp}, price_table_version = ${PRICE_TABLE_VERSION}, updated_at = now()
     where user_id = ${r.userId}::uuid and device_id = ${r.deviceId}::uuid and date = ${r.date}::date
       and tool = ${r.tool} and model = ${r.model}
  `);
  // A silent 0-row update would mean the row vanished mid-run; surface it rather than count it repriced.
  if ((result as unknown as { count: number }).count !== 1) {
    throw new Error(`update touched ${(result as unknown as { count: number }).count} rows for ${r.userId} ${r.date} ${r.tool}/${r.model}, expected 1`);
  }
}

// Same rollup SQL as persist-usage.ts step 9.
async function recomputeDayTotal(ex: Executor, d: DayKey): Promise<void> {
  await ex.execute(sql`
    insert into usage_day_total (user_id, date, tokens, cost_usd, updated_at)
    select user_id, date, sum(tokens), sum(cost_usd), now()
      from usage_day where user_id = ${d.userId} and date = ${d.date}
      group by user_id, date
    on conflict (user_id, date) do update set
      tokens = excluded.tokens, cost_usd = excluded.cost_usd, updated_at = now()
  `);
}

interface Stats {
  days: number;
  staleRows: number;
  costChangedRows: number;
  costDeltaMicros: bigint;
  unpricedRowsByModel: Map<string, number>;
}

const toMicros = (cost: string): bigint => BigInt(Math.round(sumCostUsd([cost]) * 1_000_000));

function record(stats: Stats, days: DayKey[], updates: RepriceUpdate[]): void {
  stats.days += days.length;
  stats.staleRows += updates.length;
  for (const u of updates) {
    if (u.costChanged) stats.costChangedRows++;
    stats.costDeltaMicros += toMicros(u.costUsd6dp) - toMicros(u.row.costUsd);
    if (!u.priced) stats.unpricedRowsByModel.set(u.row.model, (stats.unpricedRowsByModel.get(u.row.model) ?? 0) + 1);
  }
}

async function main(): Promise<void> {
  const { write, batchDays } = parseArgs(process.argv.slice(2));
  const prices = loadPriceTable();
  const dbHost = new URL(process.env.DATABASE_URL!).host; // client.ts already failed loud if unset
  console.log(`reprice-usage-days: ${write ? "WRITE" : "DRY RUN"} against ${dbHost}, price table ${PRICE_TABLE_VERSION}`);

  // Fail before touching the DB if the final rebuild could not run, so we never leave totals updated
  // with boards stale for want of an env var.
  if (write && (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)) {
    throw new Error("--write needs UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN set (the board rebuild runs after repricing)");
  }

  const stats: Stats = { days: 0, staleRows: 0, costChangedRows: 0, costDeltaMicros: 0n, unpricedRowsByModel: new Map() };
  let cursor: DayKey | null = null;
  for (;;) {
    const days = await nextStaleDays(cursor, batchDays);
    if (days.length === 0) break;
    cursor = days[days.length - 1]!;

    if (!write) {
      record(stats, days, planReprice(await readStaleRows(db, days), prices, PRICE_TABLE_VERSION));
      continue;
    }
    await db.transaction(async (tx) => {
      // Lock first, read second: persist-usage.ts takes the same lock before it upserts, so a
      // concurrent sync can't change the token columns between this read and the cost write.
      for (const d of days) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${d.userId}), hashtext(${d.date}))`);
      }
      const updates = planReprice(await readStaleRows(tx, days), prices, PRICE_TABLE_VERSION);
      for (const u of updates) await applyUpdate(tx, u);
      for (const d of days) await recomputeDayTotal(tx, d);
      record(stats, days, updates);
    });
    console.log(`  repriced through ${cursor.userId} ${cursor.date} (${stats.staleRows} rows so far)`);
  }

  const delta = Number(stats.costDeltaMicros) / 1_000_000;
  console.log(
    `${write ? "repriced" : "would reprice"}: ${stats.staleRows} usage_day row(s) over ${stats.days} (user, date) day(s); ` +
      `${stats.costChangedRows} change cost; total cost delta ${delta >= 0 ? "+" : ""}${delta.toFixed(6)} USD`,
  );
  for (const [model, rows] of stats.unpricedRowsByModel) {
    console.log(`  still unpriced (not in the snapshot): ${model} (${rows} row(s))`);
  }

  if (!write) {
    console.log("dry run only; rerun with --write to apply.");
    return;
  }
  // Always rebuild, even at 0 stale rows: a previous run may have died after the DB commit but before
  // the rebuild. rebuild also reseeds the `all` board from full history, so days older than its 40-day
  // bucket window are covered too.
  const { rebuildBoardsFromPostgres } = await import("@/lib/leaderboard/rebuild");
  const result = await rebuildBoardsFromPostgres();
  console.log(`rebuild: ${result.scopes} scope(s), ${result.buckets} bucket-rows`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("reprice-usage-days failed:", err);
    process.exit(1);
  },
);
