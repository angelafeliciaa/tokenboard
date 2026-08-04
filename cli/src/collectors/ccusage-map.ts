import type { NormalizedRecord } from "@tokenboard/contracts";
import { canonicalModel } from "../normalize/model-alias.js";
import { canonicalTool } from "../normalize/tool-name.js";

// ccusage@20 `<source> daily --json --offline` output shape (the subset we use).
export interface CcusageModelBreakdown {
  modelName?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number; // SINGLE combined value — ccusage emits no 5m/1h split
}

// Per-model counts under the `models` map — same fields as CcusageModelBreakdown, except the
// model name is the KEY rather than a `modelName` field.
export type CcusageModelsMap = Record<string, Omit<CcusageModelBreakdown, "modelName">>;

export interface CcusageDailyRow {
  date?: string; // already local-day "YYYY-MM-DD" from ccusage
  modelBreakdowns?: CcusageModelBreakdown[];
  models?: CcusageModelsMap;
}

function count(n: number | undefined): number {
  return Math.max(0, Math.trunc(n ?? 0));
}

// ccusage@20 emits the per-model split in TWO different shapes depending on the subcommand, and we
// must read both or a source's data is silently dropped (this is exactly how `codex` was lost —
// verified against ccusage@20: `claude daily` emits `modelBreakdowns`, `codex daily` emits `models`):
//   modelBreakdowns: [{ modelName: "x", ... }]     <- claude, and the combined `daily` report
//   models:          { "x": { ... } }              <- codex
// Normalize both to one breakdown list, preferring whichever is NON-EMPTY. Exactly one is populated
// in every shape observed from ccusage@20, so the both-populated case is purely defensive: there
// `modelBreakdowns` wins and `models` is ignored — never summed, which would double-count.
//
// The non-empty test (not a field-presence test) is deliberate. An empty `modelBreakdowns: []`
// alongside a populated `models` is treated as "read models", because the failure this whole path
// exists to prevent is silently dropping a source's usage. Preferring a present-but-empty array
// would reintroduce that exact bug for any future source emitting both. Neither populated -> [],
// which maps to zero records either way, so the ordering only matters when data is actually there.
function modelBreakdownsOf(row: CcusageDailyRow): CcusageModelBreakdown[] {
  if (row.modelBreakdowns && row.modelBreakdowns.length > 0) return row.modelBreakdowns;
  if (!row.models) return [];
  return Object.entries(row.models).map(([modelName, counts]) => ({ ...counts, modelName }));
}

// Pure: map ccusage daily rows -> NormalizedRecord[] at the per-model grain (one record per
// date+source+model). Mapping at the daily-row total would lose the per-model split — a single
// row can carry several models.
//
// ccusage gives no 5m/1h split, so the combined cacheCreationTokens goes entirely into
// cacheCreate5m and cacheCreate1h is 0 — a documented approximation (prices long-tail
// cache writes at the 5m/1.25x rate; only affects non-Claude-Code tools). ccusage's own
// cost is ignored — cost is recomputed from the bundled snapshot.
export function ccusageDailyToRecords(source: string, daily: CcusageDailyRow[]): NormalizedRecord[] {
  const tool = canonicalTool(source);
  const out: NormalizedRecord[] = [];
  for (const row of daily) {
    if (!row.date) continue;
    for (const mb of modelBreakdownsOf(row)) {
      if (!mb.modelName) continue;
      out.push({
        date: row.date,
        tool,
        model: canonicalModel(mb.modelName),
        input: count(mb.inputTokens),
        output: count(mb.outputTokens),
        cacheRead: count(mb.cacheReadTokens),
        cacheCreate5m: count(mb.cacheCreationTokens), // combined -> 5m bucket
        cacheCreate1h: 0, // documented approximation
      });
    }
  }
  return out;
}
