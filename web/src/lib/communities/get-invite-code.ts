import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export async function getInviteCode(slug: string): Promise<string | null> {
  const rows = (await db.execute(sql`
    select trim(trailing from join_code) as code
    from communities
    where slug = ${slug} and join_policy = 'code'
    limit 1
  `)) as unknown as Array<{ code: string | null }>;
  const code = rows[0]?.code ?? null;
  return code && code.length > 0 ? code : null;
}
