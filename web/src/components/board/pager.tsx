// Pagination row (dashboard-pixel .pager-row). Real paging via ?page= (page N => the board reads
// offset (N-1)*pageSize). Renders the "lo–hi of M" range + prev/next + a windowed set of numbered
// page links, each preserving the current window+metric. Server component (no client state — each
// page is a <Link> that re-renders the server board). Disabled ends are plain <span>s (no dead links).
import Link from "next/link";
import type { BoardWindow, BoardMetric } from "@tokenboard/contracts";
import styles from "./pager.module.css";

// How many numbered links to show around the current page.
const WINDOW = 5;

export function Pager({
  totalEntries,
  shown,
  page,
  pageSize,
  basePath,
  window,
  metric,
}: {
  totalEntries: number;
  shown: number;
  page: number;
  pageSize: number;
  basePath: string;
  window: BoardWindow;
  metric: BoardMetric;
}) {
  if (shown === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize));
  const current = Math.min(Math.max(page, 1), totalPages);
  const lo = (current - 1) * pageSize + 1;
  const hi = lo + shown - 1;

  const href = (p: number) => {
    const params = new URLSearchParams({ window, metric });
    if (p > 1) params.set("page", String(p)); // page 1 is the clean canonical URL (no ?page=1)
    return `${basePath}?${params.toString()}`;
  };

  // A centered window of page numbers, clamped to [1, totalPages].
  const half = Math.floor(WINDOW / 2);
  const end = Math.min(totalPages, Math.max(current + half, WINDOW));
  const start = Math.max(1, end - WINDOW + 1);
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);

  const atFirst = current <= 1;
  const atLast = current >= totalPages;

  return (
    <div className={styles.pagerRow}>
      <span className={styles.range}>
        {lo}&ndash;{hi} of {totalEntries}
      </span>
      <div className={styles.pager}>
        {atFirst ? (
          <span className={`${styles.pg} ${styles.nav}`} aria-disabled="true" aria-label="Previous page">
            &#9664;
          </span>
        ) : (
          <Link
            className={`${styles.pg} ${styles.nav}`}
            href={href(current - 1)}
            aria-label="Previous page"
            rel="prev"
          >
            &#9664;
          </Link>
        )}

        {pages.map((p) =>
          p === current ? (
            <span key={p} className={`${styles.pg} ${styles.active}`} aria-current="page">
              {p}
            </span>
          ) : (
            <Link key={p} className={styles.pg} href={href(p)} aria-label={`Page ${p}`}>
              {p}
            </Link>
          ),
        )}

        {atLast ? (
          <span className={`${styles.pg} ${styles.nav}`} aria-disabled="true" aria-label="Next page">
            &#9654;
          </span>
        ) : (
          <Link
            className={`${styles.pg} ${styles.nav}`}
            href={href(current + 1)}
            aria-label="Next page"
            rel="next"
          >
            &#9654;
          </Link>
        )}
      </div>
    </div>
  );
}
