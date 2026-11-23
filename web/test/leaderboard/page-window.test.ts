import { test } from "node:test";
import assert from "node:assert/strict";
import { pageWindow, totalPages } from "@/lib/board/page-window";

test("totalPages rounds up and is at least 1", () => {
  assert.equal(totalPages(0, 50), 1);
  assert.equal(totalPages(50, 50), 1);
  assert.equal(totalPages(58, 50), 2);
  assert.equal(totalPages(101, 50), 3);
});

test("pageWindow returns every page when they fit in the span", () => {
  assert.deepEqual(pageWindow(1, 2), [1, 2]);
  assert.deepEqual(pageWindow(2, 2), [1, 2]);
});

test("pageWindow centers on the current page and clamps at the ends", () => {
  assert.deepEqual(pageWindow(1, 10), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageWindow(5, 10), [3, 4, 5, 6, 7]);
  assert.deepEqual(pageWindow(10, 10), [6, 7, 8, 9, 10]);
});

test("pageWindow tolerates out-of-range current pages", () => {
  assert.deepEqual(pageWindow(0, 3), [1, 2, 3]);
  assert.deepEqual(pageWindow(99, 3), [1, 2, 3]);
});
