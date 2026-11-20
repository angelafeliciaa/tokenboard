// Ops script: rebuild all leaderboard boards from Postgres against the live Upstash + DATABASE_URL.
// The signed /api/cron/leaderboard-rebuild route is the prod trigger; this is the local/ops path.
// Run: cd web && pnpm exec dotenv -e ../.env -- tsx --conditions react-server scripts/rebuild-boards.ts
// (--conditions react-server makes the `server-only` import a no-op outside Next.)
import { rebuildBoardsFromPostgres } from "@/lib/leaderboard/rebuild";

async function main() {
  const result = await rebuildBoardsFromPostgres();
  process.stdout.write(`rebuild-boards: rebuilt ${result.scopes} scope(s), ${result.buckets} bucket-rows\n`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("rebuild-boards failed:", err);
    process.exit(1);
  },
);
