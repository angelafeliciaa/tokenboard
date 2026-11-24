import { test } from "node:test";
import assert from "node:assert/strict";
import { pageWindow, totalPages, PAGE_GAP, type PageSlot } from "@/lib/board/page-window";

// The pager's slot algorithm (MUI boundaryCount/siblingCount convention). The load-bearing promise
// is that the FIRST and LAST pages are always present, so neither end can be stranded off-window.
const render = (slots: PageSlot[]) => slots.map((s) => (s === PAGE_GAP ? "…" : String(s))).join(" ");

test("short boards show every page, no gaps", () => {
  assert.equal(render(pageWindow(1, 1)), "1");
  assert.equal(render(pageWindow(2, 3)), "1 2 3");
  assert.equal(render(pageWindow(3, 5)), "1 2 3 4 5");
});

test("long boards keep the first AND last page pinned", () => {
  assert.equal(render(pageWindow(1, 6)), "1 2 3 … 6");
  assert.equal(render(pageWindow(6, 6)), "1 … 4 5 6");
  assert.equal(render(pageWindow(1, 20)), "1 2 3 … 20");
  assert.equal(render(pageWindow(10, 20)), "1 … 10 … 20");
  assert.equal(render(pageWindow(20, 20)), "1 … 18 19 20");
  assert.equal(render(pageWindow(50, 100)), "1 … 50 … 100");
});

// The decisive invariant: whatever the position, both ends are one click away.
test("page 1 and the last page appear for EVERY current page", () => {
  for (const total of [1, 2, 5, 7, 8, 12, 20, 97]) {
    for (let current = 1; current <= total; current++) {
      const slots = pageWindow(current, total);
      assert.ok(slots.includes(1), `total=${total} current=${current} lost page 1: ${render(slots)}`);
      assert.ok(slots.includes(total), `total=${total} current=${current} lost page ${total}: ${render(slots)}`);
    }
  }
});

test("cell count stays constant on long boards (row never reflows while paging)", () => {
  const widths = new Set<number>();
  for (let current = 1; current <= 20; current++) widths.add(pageWindow(current, 20).length);
  assert.deepEqual([...widths], [5], "every page should render the same number of cells");
});

// The compact cap is the whole point of SIBLING_COUNT=0 — a pager that grows with the board would
// defeat it. 5 = both boundaries + the current page + both gap markers.
test("never renders more than 5 cells, at any board size", () => {
  for (const total of [1, 2, 5, 6, 8, 12, 20, 97, 500]) {
    for (let current = 1; current <= total; current++) {
      const width = pageWindow(current, total).length;
      assert.ok(width <= 5, `total=${total} p${current} rendered ${width} cells: ${render(pageWindow(current, total))}`);
    }
  }
});

test("a one-page gap renders the page itself, never a wider ellipsis", () => {
  // total=8, current=4 leaves exactly one page (6 or 7) between the window and the last boundary.
  for (const total of [8, 9, 10]) {
    for (let current = 1; current <= total; current++) {
      const slots = pageWindow(current, total);
      const numbers = slots.filter((s): s is number => s !== PAGE_GAP);
      for (let i = 1; i < numbers.length; i++) {
        const jump = numbers[i]! - numbers[i - 1]!;
        const gapBetween = slots.indexOf(numbers[i]!) - slots.indexOf(numbers[i - 1]!) > 1;
        if (jump === 2) {
          assert.equal(gapBetween, false, `total=${total} p${current}: single missing page hidden behind …`);
        }
      }
    }
  }
});

test("slots are strictly ascending with no duplicates", () => {
  for (const total of [1, 6, 8, 20, 97]) {
    for (let current = 1; current <= total; current++) {
      const numbers = pageWindow(current, total).filter((s): s is number => s !== PAGE_GAP);
      for (let i = 1; i < numbers.length; i++) {
        assert.ok(numbers[i]! > numbers[i - 1]!, `total=${total} p${current} not ascending: ${render(pageWindow(current, total))}`);
      }
    }
  }
});

test("out-of-range and degenerate inputs stay sane", () => {
  assert.equal(render(pageWindow(0, 6)), render(pageWindow(1, 6))); // clamped up to page 1
  assert.equal(render(pageWindow(99, 6)), render(pageWindow(6, 6))); // clamped down to the last page
  assert.equal(render(pageWindow(1, 0)), "1"); // no pages -> still one slot
});

test("totalPages ceilings and never returns 0", () => {
  assert.equal(totalPages(67, 12), 6);
  assert.equal(totalPages(60, 12), 5);
  assert.equal(totalPages(1, 12), 1);
  assert.equal(totalPages(0, 12), 1); // empty board is still "page 1 of 1"
  assert.equal(totalPages(10, 0), 1); // guard against a /0
});
