import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPriceTable } from "@tokenboard/cost";
import { planReprice, type StoredUsageDay } from "@/lib/sync/plan-reprice";

const prices = loadPriceTable();
const CURRENT = "litellm-2026-11-20";

const base: StoredUsageDay = {
  userId: "u1",
  deviceId: "d1",
  date: "2026-11-01",
  tool: "claude-code",
  model: "claude-opus-5-5",
  input: "1000000",
  output: "1000000",
  cacheRead: "0",
  cacheCreate5m: "0",
  cacheCreate1h: "0",
  costUsd: "0.000000",
  priceTableVersion: "litellm-2026-06-21",
};

test("a stale $0 row for a now-priced model is repriced from its token columns", () => {
  const [u] = planReprice([base], prices, CURRENT);
  assert.equal(u!.costUsd6dp, "24.000000"); // 1M * 4e-6 + 1M * 2e-5
  assert.equal(u!.priced, true);
  assert.equal(u!.costChanged, true);
});

test("rows already on the current version are skipped (rerun is a no-op)", () => {
  assert.deepEqual(planReprice([{ ...base, priceTableVersion: CURRENT }], prices, CURRENT), []);
});

test("a stale row whose cost does not change is still returned so its version is bumped", () => {
  const row = { ...base, model: "not-a-real-model", costUsd: "0.000000" };
  const [u] = planReprice([row], prices, CURRENT);
  assert.equal(u!.priced, false);
  assert.equal(u!.costUsd6dp, "0.000000");
  assert.equal(u!.costChanged, false);
});

test("all five token columns feed the cost", () => {
  const row = { ...base, input: "10", output: "20", cacheRead: "30", cacheCreate5m: "40", cacheCreate1h: "50" };
  const [u] = planReprice([row], prices, CURRENT);
  // 10*4e-6 + 20*2e-5 + 30*2e-7 + 40*5e-6 + 50*8e-6
  assert.equal(u!.costUsd6dp, "0.001046");
});

test("bare gemini-4 resolves via the gemini/ prefix fallback", () => {
  const row = { ...base, model: "gemini-4-argon", input: "10", output: "20", cacheRead: "30", cacheCreate5m: "0", cacheCreate1h: "0" };
  const [u] = planReprice([row], prices, CURRENT);
  assert.equal(u!.priced, true);
  // 10*2e-6 + 20*1e-5 + 30*1e-7
  assert.equal(u!.costUsd6dp, "0.000223");
});

test("a token count beyond 2^53 fails loud instead of pricing a rounded number", () => {
  assert.throws(() => planReprice([{ ...base, input: "9007199254740993" }], prices, CURRENT), /not a safe integer/);
});
