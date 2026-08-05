export function totalPages(totalEntries: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(totalEntries / pageSize));
}

export function pageWindow(current: number, total: number, span = 5): number[] {
  const clampedTotal = Math.max(1, total);
  const clampedCurrent = Math.min(Math.max(1, current), clampedTotal);
  const size = Math.min(span, clampedTotal);
  let start = Math.max(1, clampedCurrent - Math.floor(size / 2));
  const end = Math.min(clampedTotal, start + size - 1);
  start = Math.max(1, end - size + 1);
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);
  return pages;
}
