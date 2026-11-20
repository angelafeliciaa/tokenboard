import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { FakeRedis } from "../support/fake-redis";

const redis = new FakeRedis();
let allowedIds: string[] = []; // ids the (mocked) banned_at check lets through
const fallbackCalls: Array<{ limit: number; offset: number }> = [];

mock.module("@/lib/redis/client", { exports: { redis } });
mock.module("@/db/client", {
  exports: { db: { select: () => ({ from: () => ({ where: async () => allowedIds.map((id) => ({ id })) }) }) } },
});
mock.module("@/lib/leaderboard/profile-cache", {
  exports: {
    loadProfiles: async (ids: string[]) =>
      new Map(ids.map((id) => [id, { handle: id, tier: "free", displayName: id, avatar: null, tierPill: null }])),
  },
});
mock.module("@/lib/leaderboard/window-sums-batch", { exports: { windowTotalsForUsers: async () => new Map() } });
mock.module("@/lib/leaderboard/window-sums", {
  exports: {
    fallbackBoard: async (p: { limit: number; offset?: number }) => {
      fallbackCalls.push({ limit: p.limit, offset: p.offset ?? 0 });
      return Array.from({ length: p.limit }, (_, i) => ({ userId: `pg-${i}`, score: 1 }));
    },
    fallbackMeRank: async () => ({ rank: null, score: null, totalEntries: 999 }),
    sparklinesForUsers: async () => new Map(),
    topToolForUsers: async () => new Map(),
    earliestDateForUsers: async () => null,
  },
});

const { assembleBoard } = await import("@/lib/leaderboard/assemble-board");
const { lbKey } = await import("@/lib/leaderboard/keys");

const id = (n: number) => `m${String(n).padStart(4, "0")}`;
const run = (limit: number, offset = 0) =>
  assembleBoard({
    query: { community: "global", window: "7d", metric: "tokens", limit, offset, format: "json" },
    scope: "g",
    community: null,
    meUserId: null,
    callerUserId: null,
  });

test("a page the backfill cap leaves short is served from Postgres instead", async () => {
  // limit 2 -> chunks of 34, capped at 8 chunks = 272 members scanned. Only index 271 is eligible
  // inside the cap, and eligible members exist past it, so Redis can only produce a 1-row page.
  const members: Array<[string, number]> = Array.from({ length: 300 }, (_, i) => [id(i), 1000 - i]);
  redis.zsets.clear();
  redis.seed(lbKey("g", "t", "7d"), members);
  allowedIds = [id(271), id(280), id(281)];
  fallbackCalls.length = 0;

  const board = await run(2);

  assert.deepEqual(fallbackCalls, [{ limit: 2, offset: 0 }]);
  assert.equal(board.entries.length, 2);
});

test("a short final page that exhausted Redis stays on Redis", async () => {
  redis.zsets.clear();
  redis.seed(lbKey("g", "t", "7d"), [[id(1), 3], [id(2), 2], [id(3), 1]]);
  allowedIds = [id(1), id(2), id(3)];
  fallbackCalls.length = 0;

  const board = await run(5);

  assert.deepEqual(fallbackCalls, []);
  assert.deepEqual(board.entries.map((e) => e.handle), [id(1), id(2), id(3)]);
});
