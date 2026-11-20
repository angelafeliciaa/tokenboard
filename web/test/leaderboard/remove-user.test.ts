import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { FakeRedis } from "../support/fake-redis";

const fake = new FakeRedis();
mock.module("@/lib/redis/client", { exports: { redis: fake } });
const { removeUserFromBoards } = await import("@/lib/leaderboard/remove-user");
const { lbKey, lbsnapKey, lbdayKey } = await import("@/lib/leaderboard/keys");

const BANNED = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const COMMUNITY = "c:11111111-1111-4111-8111-111111111111" as const;
const NOW = new Date("2026-06-15T12:00:00Z");

test("banning removes the user from every board, snapshot and day-bucket key, keeping others", async () => {
  fake.zsets.clear();
  const keys = [
    ...(["g", COMMUNITY] as const).flatMap((scope) =>
      (["t", "usd"] as const).flatMap((m) => [
        lbKey(scope, m, "7d"),
        lbKey(scope, m, "30d"),
        lbKey(scope, m, "all"),
        lbsnapKey(scope, m, "7d"),
        lbsnapKey(scope, m, "30d"),
        lbdayKey(scope, m, "2026-06-15"), // today
        lbdayKey(scope, m, "2026-05-16"), // today-30: the oldest bucket the 30d snapshot reads
      ]),
    ),
  ];
  for (const k of keys) fake.seed(k, [[BANNED, 9], [OTHER, 5]]);

  await removeUserFromBoards(BANNED, ["g", COMMUNITY], NOW);

  for (const k of keys) assert.deepEqual(fake.members(k), [OTHER], `${k} should only keep the other user`);
});

test("a Redis failure rejects so the ban is not reported as fully applied", async () => {
  fake.zsets.clear();
  fake.failOn = "zrem";
  try {
    await assert.rejects(removeUserFromBoards(BANNED, ["g"], NOW), /zrem failed/);
  } finally {
    fake.failOn = null;
  }
});
