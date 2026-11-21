// Pure half of scripts/reprice-usage-days.ts. Uses priceRecord so a repriced row matches a fresh sync.
import type { PriceTable } from "@tokenboard/cost";
import { priceRecord } from "./compute-cost";

// bigint and numeric columns arrive as text, so nothing round-trips through a float.
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

function toCount(value: string, field: string, row: StoredUsageDay): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(
      `reprice: ${field}=${value} is not a safe integer (user ${row.userId}, ${row.date}, ${row.tool}/${row.model}) — fix the row by hand before repricing`,
    );
  }
  return n;
}

// Compares with "differs", not "older", so stored rows follow a rollback to an older snapshot too.
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
