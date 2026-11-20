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
    assert.match(q, /user_id"?::text collate "C" desc/);
    assert.doesNotMatch(q, /user_id"? asc/);
  }
});
