import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

// The web tsconfig uses jsx:"preserve" and tsx compiles to the classic runtime, so JSX needs React in scope.
(globalThis as { React?: unknown }).React = await import("react");
mock.module("next/link", {
  exports: {
    default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) =>
      (globalThis as any).React.createElement("a", { href, ...rest }, children),
  },
});
const { Pager } = await import("@/components/board/pager");

const props = { basePath: "/global", window: "7d", metric: "tokens", pageSize: 50 } as const;
const render = (p: { page: number; totalEntries: number; shown: number }) =>
  renderToStaticMarkup(Pager({ ...props, ...p }) as never);

test("an empty page past 1 still renders a link back instead of nothing", () => {
  // totalEntries over-counts: it claims 3 pages but page 3 came back empty.
  const html = render({ page: 3, totalEntries: 120, shown: 0 });

  assert.notEqual(html, "");
  assert.match(html, /href="\/global\?window=7d&amp;metric=tokens&amp;page=2"/);
  assert.match(html, /href="\/global\?window=7d&amp;metric=tokens&amp;page=1"/);
});

test("an empty first page renders no pager", () => {
  assert.equal(render({ page: 1, totalEntries: 0, shown: 0 }), "");
});
