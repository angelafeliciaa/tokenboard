// Which page numbers a pager shows, and where the gaps go.
//
// Follows the convention MUI Pagination settled on (boundaryCount / siblingCount), which is also
// what Bootstrap-style hand-rolled pagers and shadcn's Pagination primitives assume: keep the FIRST
// and LAST pages permanently visible, show a few siblings either side of the current page, and drop
// an ellipsis into any gap between those groups. Both ends stay one click away no matter how deep
// you are, which is the whole point — a window that scrolls off the ends strands the user.
//
// Two rules stop the classic bugs:
//   - An ellipsis is only emitted for a gap of 2+ pages. A gap of exactly one page renders that
//     page instead: "1 … 3 4 5" hides page 2 behind an ellipsis that is WIDER than the number it
//     replaces, which is silly.
//   - The sibling window is SHIFTED, never truncated, near the ends — so page 1 of 20 shows
//     "1 2 3 4 5 … 20", not a stunted "1 2 3 … 20". Constant width avoids the row reflowing as
//     you page.

// A gap in the sequence. Rendered as a non-interactive "…".
export const PAGE_GAP = "gap" as const;
export type PageSlot = number | typeof PAGE_GAP;

// Pages pinned at each end.
const BOUNDARY_COUNT = 1;
// Pages either side of the current one. 0 => the current page alone between the gaps, capping the
// row at 5 cells ("1 … 10 … 20"). MUI/AntD default to 1 (7 cells), but a compact board reads better
// with fewer targets — you step with ◀ ▶ and the pinned ends cover the long jumps.
const SIBLING_COUNT = 0;

// The total number of numbered cells we aim to render, so the pager's width stays stable across
// pages: both boundaries + both sibling groups + the current page + both gap markers.
const TARGET_SLOTS = BOUNDARY_COUNT * 2 + SIBLING_COUNT * 2 + 3;

export function totalPages(totalEntries: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(totalEntries / pageSize));
}

// The ordered slots for a pager: page numbers plus PAGE_GAP markers. `current` is clamped into
// [1, total], so an out-of-range page still yields a sane sequence.
export function pageWindow(current: number, total: number): PageSlot[] {
  if (total <= 1) return [1];

  // Few enough pages that everything fits — no gaps, no arithmetic.
  if (total <= TARGET_SLOTS) return range(1, total);

  const page = clamp(current, 1, total);

  // The moving window around the current page, shifted (not clipped) so it keeps its width when it
  // bumps into either end.
  const windowSize = SIBLING_COUNT * 2 + 1;
  const firstBoundaryEnd = BOUNDARY_COUNT; // last page belonging to the leading boundary group
  const lastBoundaryStart = total - BOUNDARY_COUNT + 1;
  let windowStart = clamp(page - SIBLING_COUNT, firstBoundaryEnd + 1, lastBoundaryStart - windowSize);
  let windowEnd = windowStart + windowSize - 1;

  // Near an end, absorb the window into that boundary group and grow the other side, so the cell
  // count matches the mid-board case instead of collapsing to "1 2 … 20".
  const gapsNeeded = (windowStart > firstBoundaryEnd + 1 ? 1 : 0) + (windowEnd < lastBoundaryStart - 1 ? 1 : 0);
  const grow = TARGET_SLOTS - (BOUNDARY_COUNT * 2 + windowSize + gapsNeeded);
  if (grow > 0) {
    if (gapsNeeded < 2 && windowStart <= firstBoundaryEnd + 1) {
      windowEnd = Math.min(lastBoundaryStart - 1, windowEnd + grow);
    } else if (gapsNeeded < 2) {
      windowStart = Math.max(firstBoundaryEnd + 1, windowStart - grow);
    }
  }

  const slots: PageSlot[] = [];
  slots.push(...range(1, firstBoundaryEnd));
  pushGapOrPage(slots, firstBoundaryEnd, windowStart);
  slots.push(...range(windowStart, windowEnd));
  pushGapOrPage(slots, windowEnd, lastBoundaryStart);
  slots.push(...range(lastBoundaryStart, total));
  return slots;
}

// Bridge the space between `before` and `after` (both exclusive): nothing when they're adjacent, the
// single page itself when exactly one is missing, otherwise a gap marker.
function pushGapOrPage(slots: PageSlot[], before: number, after: number): void {
  const missing = after - before - 1;
  if (missing <= 0) return;
  if (missing === 1) slots.push(before + 1);
  else slots.push(PAGE_GAP);
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
