// Pure half of the one-off reprice (scripts/reprice-usage-days.ts): given stored usage_day rows and
// the current price table, say which rows are stale and what each should cost now. Reuses priceRecord
// so a repriced row is byte-identical to what a fresh sync of the same counts would store.
import type { PriceTable } from "@tokenboard/cost";
import { priceRecord } from "./compute-cost";

// A usage_day row as the script reads it: bigints/numerics arrive as text (exact, no float round-trip).
export interface StoredUsageDay {
  userId: string;
  deviceId: string;
  date: string;
  tool: string;
  model: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheCreate5m: string;
  cacheCreate1h: string;
  costUsd: string;
  priceTableVersion: string;
}

export interface RepriceUpdate {
  row: StoredUsageDay;
  costUsd6dp: string;
  priced: boolean;
  costChanged: boolean;
}

// Counts are JS numbers in the shared engine; refuse to silently lose precision on a huge bigint.
function toCount(value: string, field: string, row: StoredUsageDay): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(
      `reprice: ${field}=${value} is not a safe integer (user ${row.userId}, ${row.date}, ${row.tool}/${row.model}) — fix the row by hand before repricing`,
    );
  }
  return n;
}

// Rows already on currentVersion are skipped, which is what makes a rerun a no-op. "differs" (not
// "older") on purpose: after a rollback to an older snapshot the stored rows should follow it too.
export function planReprice(
  rows: StoredUsageDay[],
  prices: PriceTable,
  currentVersion: string,
): RepriceUpdate[] {
  const updates: RepriceUpdate[] = [];
  for (const row of rows) {
    if (row.priceTableVersion === currentVersion) continue;
    const { costUsd6dp, priced } = priceRecord(
      {
        date: row.date,
        tool: row.tool,
        model: row.model,
        input: toCount(row.input, "input_tokens", row),
        output: toCount(row.output, "output_tokens", row),
        cacheRead: toCount(row.cacheRead, "cache_read_tokens", row),
        cacheCreate5m: toCount(row.cacheCreate5m, "cache_create_5m", row),
        cacheCreate1h: toCount(row.cacheCreate1h, "cache_create_1h", row),
      },
      prices,
    );
    updates.push({ row, costUsd6dp, priced, costChanged: Number(row.costUsd) !== Number(costUsd6dp) });
  }
  return updates;
}
