import Link from "next/link";
import { MAX_BOARD_OFFSET, type BoardWindow, type BoardMetric } from "@tokenboard/contracts";
import { pageWindow, totalPages } from "@/lib/board/page-window";
import styles from "./pager.module.css";

function hrefFor(basePath: string, window: BoardWindow, metric: BoardMetric, page: number): string {
  const params = new URLSearchParams({ window, metric, page: String(page) });
  return `${basePath}?${params.toString()}`;
}

export function Pager({
  basePath,
  window,
  metric,
  page,
  pageSize,
  totalEntries,
  shown,
}: {
  basePath: string;
  window: BoardWindow;
  metric: BoardMetric;
  page: number;
  pageSize: number;
  totalEntries: number;
  shown: number;
}) {
  const maxReachablePage = Math.floor(MAX_BOARD_OFFSET / pageSize) + 1;
  const pages = Math.min(totalPages(totalEntries, pageSize), maxReachablePage);

  if (shown === 0) {
    if (page <= 1) return null;
    // totalEntries can over-count (members the board holds that no longer rank), so a page past 1 can
    // come back empty. Without a link back the pager vanishes and the user is stranded.
    const back = Math.min(page - 1, pages);
    return (
      <nav className={styles.emptyPage} aria-label="Pagination">
        <p className={styles.range}>No entries on page {page}.</p>
        <Link className={`${styles.pg} ${styles.back}`} href={hrefFor(basePath, window, metric, back)}>
          Back to page {back}
        </Link>
        {back > 1 && (
          <Link className={`${styles.pg} ${styles.back}`} href={hrefFor(basePath, window, metric, 1)}>
            First page
          </Link>
        )}
      </nav>
    );
  }

  const current = Math.min(Math.max(1, page), pages);
  const offset = (current - 1) * pageSize;
  const from = offset + 1;
  const to = offset + shown;

  return (
    <div className={styles.pagerRow}>
      <span className={styles.range}>
        {from}&ndash;{to} of {totalEntries}
      </span>
      <div className={styles.pager}>
        {current > 1 ? (
          <Link
            className={`${styles.pg} ${styles.nav}`}
            href={hrefFor(basePath, window, metric, current - 1)}
            aria-label="Previous page"
          >
            &#9664;
          </Link>
        ) : (
          <button type="button" className={`${styles.pg} ${styles.nav}`} disabled aria-label="Previous page">
            &#9664;
          </button>
        )}

        {pageWindow(current, pages).map((p) =>
          p === current ? (
            <span key={p} className={`${styles.pg} ${styles.active}`} aria-current="page">
              {p}
            </span>
          ) : (
            <Link key={p} className={styles.pg} href={hrefFor(basePath, window, metric, p)} aria-label={`Page ${p}`}>
              {p}
            </Link>
          ),
        )}

        {current < pages ? (
          <Link
            className={`${styles.pg} ${styles.nav}`}
            href={hrefFor(basePath, window, metric, current + 1)}
            aria-label="Next page"
          >
            &#9654;
          </Link>
        ) : (
          <button type="button" className={`${styles.pg} ${styles.nav}`} disabled aria-label="Next page">
            &#9654;
          </button>
        )}
      </div>
    </div>
  );
}
