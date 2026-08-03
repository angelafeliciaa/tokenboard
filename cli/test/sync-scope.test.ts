import { test } from "node:test";
import assert from "node:assert/strict";
import { filterRecordsForSync, isValidIsoDate, parseSinceArg, parseSourcesArg } from "../src/commands/sync.js";
import { currentVersion } from "../src/version.js";
import type { NormalizedRecord } from "@tokenboard/contracts";

const rec = (date: string, tool: string): NormalizedRecord => ({
  date,
  tool,
  model: "claude-sonnet-4",
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheCreate5m: 0,
  cacheCreate1h: 0,
});

const records = [
  rec("2026-07-01", "claude-code"),
  rec("2026-07-15", "codex"),
  rec("2026-08-01", "claude-code"),
  rec("2026-08-02", "gemini"),
];

test("no options passes every record through", () => {
  assert.equal(filterRecordsForSync(records, {}).length, 4);
});

test("since keeps only records on/after the day (inclusive)", () => {
  const kept = filterRecordsForSync(records, { since: "2026-08-01" });
  assert.deepEqual(kept.map((r) => r.date), ["2026-08-01", "2026-08-02"]);
});

test("sources keeps only the named tools, case-insensitively", () => {
  const kept = filterRecordsForSync(records, { sources: ["Codex", "GEMINI"] });
  assert.deepEqual(kept.map((r) => r.tool), ["codex", "gemini"]);
});

test("since and sources combine (AND)", () => {
  const kept = filterRecordsForSync(records, { since: "2026-07-10", sources: ["claude-code"] });
  assert.deepEqual(kept.map((r) => r.date), ["2026-08-01"]);
});

test("empty sources list is treated as no source filter", () => {
  assert.equal(filterRecordsForSync(records, { sources: [] }).length, 4);
});

test("currentVersion resolves the installed @tokenboard/cli version", () => {
  assert.match(currentVersion(), /^\d+\.\d+\.\d+/);
});

test("isValidIsoDate accepts real dates and rejects impossible ones", () => {
  assert.ok(isValidIsoDate("2026-08-01"));
  assert.ok(isValidIsoDate("2024-02-29"));
  assert.ok(!isValidIsoDate("2026-19-99"));
  assert.ok(!isValidIsoDate("2026-02-30"));
  assert.ok(!isValidIsoDate("2025-02-29"));
  assert.ok(!isValidIsoDate("2026-00-10"));
  assert.ok(!isValidIsoDate("2026-8-1"));
  assert.ok(!isValidIsoDate("nonsense"));
});

test("isValidIsoDate computes leap years directly across the full four-digit range", () => {
  assert.ok(isValidIsoDate("0000-02-29"));
  assert.ok(isValidIsoDate("2000-02-29"));
  assert.ok(!isValidIsoDate("1900-02-29"));
  assert.ok(!isValidIsoDate("0001-02-29"));
});

test("parseSinceArg passes undefined through but rejects an explicitly blank value", () => {
  assert.equal(parseSinceArg(undefined), undefined);
  assert.equal(parseSinceArg("2026-08-01"), "2026-08-01");
  assert.throws(() => parseSinceArg(""), /needs a date/);
  assert.throws(() => parseSinceArg("   "), /needs a date/);
  assert.throws(() => parseSinceArg(true), /needs a date/);
});

test("parseSourcesArg passes undefined through but rejects a blank/empty list", () => {
  assert.equal(parseSourcesArg(undefined), undefined);
  assert.deepEqual(parseSourcesArg("codex, claude-code"), ["codex", "claude-code"]);
  assert.throws(() => parseSourcesArg(""), /needs at least one tool/);
  assert.throws(() => parseSourcesArg(",, ,"), /needs at least one tool/);
  assert.throws(() => parseSourcesArg(true), /needs at least one tool/);
});
