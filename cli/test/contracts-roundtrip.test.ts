import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizedRecordSchema } from "@tokenboard/contracts";
import { parsedLineToRecord } from "../src/collectors/claude-code-map.js";
import { ccusageDailyToRecords } from "../src/collectors/ccusage-map.js";
import { aggregateByKey } from "../src/aggregate/aggregate.js";
import type { ParsedLine } from "../src/collectors/parsed-line.js";

// Both collectors must emit records matching the ONE wire shape (@tokenboard/contracts) —
// the single source of truth, so the CLI and server never drift. This test feeds a
// realistic line through each map, aggregates, and asserts every output validates.

test("Claude Code map output validates against the contracts schema", () => {
  const line: ParsedLine = {
    messageId: "msg_bdrk_abc",
    model: "claude-opus-4-8",
    usage: {
      input_tokens: 10718,
      output_tokens: 467,
      cache_read_input_tokens: 14830,
      cache_creation: { ephemeral_5m_input_tokens: 6374, ephemeral_1h_input_tokens: 0 },
    },
    timestamp: "2026-06-21T20:25:21.021Z",
    sourcePath: "/x/a.jsonl",
    lineIndex: 0,
  };
  const records = aggregateByKey([parsedLineToRecord(line, "America/New_York")]);
  assert.equal(records.length, 1);
  for (const r of records) assert.ok(normalizedRecordSchema.safeParse(r).success);
});

test("ccusage map output validates against the contracts schema", () => {
  const daily = [
    {
      date: "2026-06-21",
      modelBreakdowns: [
        { modelName: "gpt-5", inputTokens: 22000, outputTokens: 9100, cacheReadTokens: 0, cacheCreationTokens: 0 },
        { modelName: "claude-opus-4-8", inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 100 },
      ],
    },
  ];
  const records = aggregateByKey(ccusageDailyToRecords("codex", daily));
  assert.equal(records.length, 2);
  for (const r of records) assert.ok(normalizedRecordSchema.safeParse(r).success);
});

// REGRESSION: `ccusage codex daily --json` emits its per-model split as a keyed `models` OBJECT,
// not the `modelBreakdowns` ARRAY that `claude daily` emits. Reading only the array silently
// dropped 100% of Codex usage even though "codex" was wired into CCUSAGE_SOURCES.
test("ccusage `models` keyed-object rows map to records (codex shape)", () => {
  const daily = [
    {
      date: "2026-08-01",
      models: {
        "gpt-5-codex": { inputTokens: 200, outputTokens: 500, cacheReadTokens: 800, cacheCreationTokens: 0 },
        "gpt-5.1-codex": { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 40 },
      },
    },
  ];
  const records = aggregateByKey(ccusageDailyToRecords("codex", daily));
  assert.equal(records.length, 2);
  for (const r of records) assert.ok(normalizedRecordSchema.safeParse(r).success);

  const byModel = new Map(records.map((r) => [r.model, r]));
  assert.deepEqual(byModel.get("gpt-5-codex"), {
    date: "2026-08-01",
    tool: "codex",
    model: "gpt-5-codex",
    input: 200,
    output: 500,
    cacheRead: 800,
    cacheCreate5m: 0,
    cacheCreate1h: 0,
  });
  // combined cacheCreationTokens lands entirely in the 5m bucket (documented approximation)
  assert.equal(byModel.get("gpt-5.1-codex")?.cacheCreate5m, 40);
  assert.equal(byModel.get("gpt-5.1-codex")?.cacheCreate1h, 0);
});

test("a row carrying BOTH shapes prefers modelBreakdowns and never double-counts", () => {
  const records = ccusageDailyToRecords("codex", [
    {
      date: "2026-08-01",
      modelBreakdowns: [{ modelName: "gpt-5-codex", inputTokens: 200 }],
      models: { "gpt-5-codex": { inputTokens: 200 } },
    },
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.input, 200); // 200, not 400
});

test("both collectors aggregate together without key collision", () => {
  const claude = parsedLineToRecord(
    {
      messageId: "m",
      model: "claude-opus-4-8",
      usage: { input_tokens: 1, output_tokens: 1 },
      timestamp: "2026-06-21T00:00:00.000Z",
      sourcePath: "/x/a.jsonl",
      lineIndex: 0,
    },
    "UTC",
  );
  const ccusage = ccusageDailyToRecords("codex", [
    { date: "2026-06-21", modelBreakdowns: [{ modelName: "claude-opus-4-8", inputTokens: 1 }] },
  ]);
  // same date+model but DIFFERENT tool (claude-code vs codex) -> two distinct rows.
  const records = aggregateByKey([claude, ...ccusage]);
  assert.equal(records.length, 2);
  assert.deepEqual(new Set(records.map((r) => r.tool)), new Set(["claude-code", "codex"]));
});

test("a deliberately off-spec record FAILS the schema (show-data's guard is real)", () => {
  const bad = { date: "2026-06-21", tool: "claude-code", model: "x", input: -5, output: 0, cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0 };
  assert.equal(normalizedRecordSchema.safeParse(bad).success, false);
});
