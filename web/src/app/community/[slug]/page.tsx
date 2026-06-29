// Board page — server component for /community/[slug] (slug="global" -> the global board). Replicates
// the API route's sequence (getViewer -> resolveBoardScope -> assembleBoard) DIRECTLY rather than
// fetch-to-self: no self-HTTP hop, no second cookie round-trip, full BoardResponse types. The window
// tabs + metric toggle are client leaves that drive ?window=/?metric=, so this re-renders server-side.
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { boardQuerySchema } from "@tokenboard/contracts";
import { getViewer } from "@/lib/auth/get-viewer";
import { resolveBoardScope } from "@/lib/leaderboard/resolve-scope";
import { assembleBoard } from "@/lib/leaderboard/assemble-board";
import { WEB_DEFAULT_METRIC, WEB_DEFAULT_WINDOW, WEB_PAGE_SIZE } from "@/lib/board/web-defaults";
import { ogImageUrl } from "@/lib/og/og-hash";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { BoardTitle } from "./board-title";
import { WindowTabs } from "@/components/board/window-tabs";
import { MetricToggle } from "@/components/board/metric-toggle";
import { BoardRow } from "@/components/board/board-row";
import { YourStanding } from "@/components/board/your-standing";
import { CommunityPanel } from "@/components/board/community-panel";
import { Pager } from "@/components/board/pager";
import styles from "./board.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Keyed on primitives (not the searchParams object) so generateMetadata and the page component share
// one result via React cache() per request — otherwise the getViewer + scope + assembleBoard chain
// runs twice per navigation.
const loadBoard = cache(async function loadBoard(
  slug: string,
  windowParam: string,
  metricParam: string,
  page: number,
) {
  const parsed = boardQuerySchema.safeParse({
    community: slug,
    window: windowParam,
    metric: metricParam,
    limit: WEB_PAGE_SIZE,
    offset: (page - 1) * WEB_PAGE_SIZE,
  });
  if (!parsed.success) return { kind: "notfound" as const };

  const viewer = await getViewer();
  if (viewer === "outage") return { kind: "outage" as const };
  const callerUserId = viewer?.userId ?? null;

  const resolved = await resolveBoardScope(parsed.data.community, callerUserId);
  if (!resolved.ok) return { kind: "notfound" as const };

  const board = await assembleBoard({
    query: parsed.data,
    scope: resolved.scope,
    community: resolved.community,
    meUserId: callerUserId,
    callerUserId,
  });
  return { kind: "ok" as const, board, viewer };
});

// ?page= is 1-based; a missing/invalid/<1 value floors to page 1.
function parsePage(sp: Search): number {
  const n = Number.parseInt(one(sp.page) ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

const loadBoardFromSearch = (slug: string, sp: Search) =>
  loadBoard(slug, one(sp.window) ?? WEB_DEFAULT_WINDOW, one(sp.metric) ?? WEB_DEFAULT_METRIC, parsePage(sp));

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Search>;
}) {
  const { slug } = await params;
  const res = await loadBoardFromSearch(slug, await searchParams);
  if (res.kind !== "ok") return { title: "tokenboard" };
  const name = res.board.community?.name ?? "Global";
  return {
    title: `${name} — tokenboard`,
    openGraph: { images: [ogImageUrl(slug, res.board)] },
  };
}

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Search>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const res = await loadBoardFromSearch(slug, sp);
  if (res.kind === "outage") throw new Error("auth_unavailable");
  if (res.kind !== "ok") notFound();

  const { board, viewer } = res;
  const page = parsePage(sp);
  const isGlobal = slug.toLowerCase() === "global" || slug === "";
  const currentPath = isGlobal ? "/global" : `/community/${slug}`;

  // Any empty page beyond page 1 is a dead end ("No synced usage", no pager to recover) — whether an
  // over-shoot (?page=99) OR a tail page whose rows all got banned-filtered (banned stragglers inflate
  // totalEntries/ZCARD, so a totalEntries-derived "last page" can itself be empty). Redirect to page 1:
  // the canonical top, which holds the real entries, and which never redirects (page > 1 guard) — so
  // no loop. If page 1 is itself empty, the board genuinely has nothing to show and renders the empty
  // state correctly.
  if (board.entries.length === 0 && page > 1) {
    const params = new URLSearchParams({ window: board.window, metric: board.metric });
    redirect(`${currentPath}?${params.toString()}`);
  }

  // COMPANY-board privacy gate (DESIGN §7.2): there's no opt-in/alias column yet, so until Phase 8
  // lands it, company boards alias every row by rank rather than leak real handles.
  const aliasCompany = board.community?.type === "company";
  // Pin "you" below the page only when you're off it AND we're on page 1 (the pin is a once-only
  // "here's where you stand" cue; repeating it on every page would be noise).
  const pinnedMe = page === 1 && board.me && board.me.inTopN === false ? board.me.entry : null;

  return (
    <div className={`${styles.surfaceBoardBase} ${styles.surfaceBoardArcade}`}>
      <SiteNav active={isGlobal ? "global" : "communities"} viewer={viewer} currentPath={currentPath} />
      <main className={styles.shell}>
        <div className={styles.layout}>
          <div className={styles.card}>
            <div className={styles.head}>
              <BoardTitle name={board.community?.name ?? "Global"} />
            </div>

            <div className={styles.controls}>
              <WindowTabs current={board.window} basePath={currentPath} metric={board.metric} />
              <MetricToggle current={board.metric} basePath={currentPath} window={board.window} />
            </div>

            <div className={styles.boardLabel}>
              <span>Standings</span>
              <span className={styles.rule} aria-hidden="true" />
              <span className={styles.leg}>
                <span className={styles.ar} aria-hidden="true">
                  ▲▼
                </span>{" "}
                vs last week
              </span>
            </div>

            {board.entries.length === 0 ? (
              <p className={styles.empty}>No synced usage in this window yet. Be the first on the board.</p>
            ) : (
              <ul className={styles.board}>
                {board.entries.map((e) => (
                  <BoardRow key={e.handle} entry={e} metric={board.metric} aliasCompany={aliasCompany} />
                ))}
                {pinnedMe && (
                  <BoardRow
                    key={`me-${pinnedMe.handle}`}
                    entry={pinnedMe}
                    metric={board.metric}
                    aliasCompany={aliasCompany}
                    pinned
                  />
                )}
              </ul>
            )}

            <Pager
              totalEntries={board.totalEntries}
              shown={board.entries.length}
              page={page}
              pageSize={WEB_PAGE_SIZE}
              basePath={currentPath}
              window={board.window}
              metric={board.metric}
            />
          </div>

          <aside className={styles.rail}>
            <YourStanding
              me={board.me}
              entries={board.entries}
              metric={board.metric}
              viewer={viewer}
              aliasCompany={aliasCompany}
            />
            {board.community && <CommunityPanel community={board.community} />}
          </aside>
        </div>
      </main>
      <SiteFooter variant="board" />
    </div>
  );
}
