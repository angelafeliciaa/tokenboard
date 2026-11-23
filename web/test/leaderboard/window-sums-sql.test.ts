import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const queries: string[] = [];
mock.module("@/db/client", {
  exports: {
    db: {
      execute: async (q: SQL) => {
        queries.push(new PgDialect().sqlToQuery(q).sql);
        return [];
      },
    },
  },
});

const { fallbackBoard, fallbackMeRank } = await import("@/lib/leaderboard/window-sums");

const base = { metric: "tokens", windowStart: "2026-06-09", windowEnd: "2026-06-15" } as const;

test("fallback ties break like Redis: user_id text, C collation, descending", async () => {
  queries.length = 0;
  await fallbackBoard({ ...base, scope: "g", limit: 50 });
  await fallbackMeRank({ ...base, scope: "g", userId: "u" });

  const ordered = queries.filter((q) => /order by/.test(q));
  assert.ok(ordered.length >= 2, "expected both fallback queries to be captured");
  for (const q of ordered) {
    assert.match(q, /u\.id::text collate "C" desc/);
    assert.doesNotMatch(q, /u\.id asc|user_id asc/);
  }
});

test("fallback ranks the seeded population: every non-banned user, $0 included", async () => {
  const scopes = ["g", "c:11111111-1111-4111-8111-111111111111"] as const;
  for (const scope of scopes) {
    queries.length = 0;
    await fallbackBoard({ ...base, scope, limit: 50 });
    await fallbackMeRank({ ...base, scope, userId: "u" });

    assert.equal(queries.length, 3, "board query, ranked query, and the no-row total count");
    for (const q of queries) {
      assert.match(q, /from users u/, "population must start from users, not usage rows");
      assert.match(q, /u\.banned_at is null/);
      assert.doesNotMatch(q, /\bhaving\b/, "a usage > 0 filter would drop the $0-seeded users");
      if (scope !== "g") assert.match(q, /join memberships mm on mm\.user_id = u\.id and mm\.community_id = \$/);
    }
    for (const q of queries.slice(0, 2)) {
      assert.match(q, /left join usage_day_total udt\s+on udt\.user_id = u\.id and udt\.date <= /);
    }
  }
});
