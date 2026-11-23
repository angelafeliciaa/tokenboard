// Take a user out of every Redis board key they can appear in. Called when an admin bans them.
//
// WHY: the board pages by raw ZSET index (`offset`). A banned member who is still in the ZSET
// occupies an index, so every banned member ahead of a page shifts its window and a row can repeat
// on the next page. Marking users.banned_at alone leaves them in until the nightly rebuild, so the
// ban has to purge them from Redis too.
//
// Keys covered (everything the sweep/rebuild or the write-path derives a board from):
//   - lb:{scope}:{metric}:{7d|30d|all}   the boards that are read
//   - lbsnap:{scope}:{metric}:{7d|30d}   previous-period ranks, so deltas don't count the banned user
//   - lbday:{scope}:{metric}:{date}      the day buckets the sweep ZUNIONSTOREs 7d/30d from. Without
//                                        these the next sweep would re-add the user to 7d/30d.
//
// UNBAN needs no call here: users.banned_at = null lets the write-path accept their next sync (which
// re-ZADDs every window absolute) and the nightly sweep re-seed them at $0; the nightly rebuild
// restores their day buckets from usage_day_total.
import "server-only";
import { redis } from "@/lib/redis/client";
import { lbKey, lbsnapKey, lbdayKey, ALL_WINDOWS, METRIC_TOKENS, SWEPT_WINDOWS, type Scope } from "./keys";
import { currentWindowBucketDates, previousWindowBucketDates } from "./windows";

// Every bucket date the sweep reads for 7d/30d: the 30d window (today-29..today) plus the previous
// window shifted one day back (today-30..yesterday), i.e. today-30..today. Later sweeps read a subset.
function sweepBucketDates(now: Date): string[] {
  return [...new Set([...previousWindowBucketDates("30d", now), ...currentWindowBucketDates("30d", now)])];
}

// Rejects if Redis fails (the caller must not report the ban as fully applied). ZREM is idempotent,
// so re-running after a failure is safe.
export async function removeUserFromBoards(userId: string, scopes: Scope[], now: Date = new Date()): Promise<number> {
  const dates = sweepBucketDates(now);
  const pipe = redis.pipeline();
  let commands = 0;
  for (const scope of scopes) {
    for (const metric of METRIC_TOKENS) {
      for (const w of ALL_WINDOWS) {
        pipe.zrem(lbKey(scope, metric, w), userId);
        commands++;
      }
      for (const w of SWEPT_WINDOWS) {
        pipe.zrem(lbsnapKey(scope, metric, w), userId);
        commands++;
      }
      for (const date of dates) {
        pipe.zrem(lbdayKey(scope, metric, date), userId);
        commands++;
      }
    }
  }
  await pipe.exec();
  return commands;
}
