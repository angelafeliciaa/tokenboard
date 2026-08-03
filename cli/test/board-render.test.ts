import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBoardTable, renderMeLine } from "../src/render/board-table.js";
import { sanitizeTerminalText } from "../src/render/sanitize.js";
import { resolveStyle } from "../src/render/terminal-style.js";
import type { BoardResponse, BoardEntry } from "@tokenboard/contracts";

const ESC = String.fromCharCode(0x1b);
const NEWLINE = String.fromCharCode(0x0a);

const plainAscii = resolveStyle({
  isTTY: false,
  noColorEnv: false,
  noColorFlag: true,
  asciiFlag: true,
  columns: 80,
  colorterm: undefined,
  term: undefined,
  forceColor: undefined,
});

const entry = (over: Partial<BoardEntry>): BoardEntry => ({
  rank: 1,
  handle: "devon",
  tier: "individual",
  tokens: 1_500_000,
  cost: 312,
  delta: { rankChange: 0, tokensChange: 0, pct: 0, direction: "flat" },
  sparkline: [],
  isMe: false,
  ...over,
});

const board = (over: Partial<BoardResponse>): BoardResponse => ({
  community: null,
  window: "7d",
  metric: "tokens",
  generatedAt: "2026-08-03T00:00:00Z",
  priceTableVersion: "test",
  windowStart: "2026-07-27",
  windowEnd: "2026-08-03",
  totalEntries: 2,
  entries: [
    entry({ rank: 1, handle: "doomslug", tokens: 2_000_000, delta: { rankChange: 1, tokensChange: 1, pct: 1, direction: "up" } }),
    entry({ rank: 2, handle: "devon", tokens: 1_500_000, isMe: true, delta: { rankChange: -1, tokensChange: -1, pct: -1, direction: "down" } }),
  ],
  me: { inTopN: true, rank: 2, totalEntries: 2, handle: "devon" },
  ...over,
});

test("renders ranked handles with humanized token values", () => {
  const text = renderBoardTable(board({}), plainAscii);
  assert.match(text, /@doomslug/);
  assert.match(text, /@devon/);
  assert.match(text, /2M/);
  assert.match(text, /1\.5M/);
});

test("marks the caller row and shows ascii delta arrows", () => {
  const text = renderBoardTable(board({}), plainAscii);
  const meRow = text.split("\n").find((l) => l.includes("@devon"));
  assert.ok(meRow?.trimStart().startsWith(">"));
  assert.match(text, /\^1/);
  assert.match(text, /v1/);
});

test("cost metric formats approx USD", () => {
  const text = renderBoardTable(board({ metric: "cost" }), plainAscii);
  assert.match(text, /~\$/);
});

test("empty board shows a friendly note", () => {
  const text = renderBoardTable(board({ entries: [], totalEntries: 0, me: null }), plainAscii);
  assert.match(text, /no entries yet/);
});

test("renderMeLine summarizes rank out of total, null when absent", () => {
  assert.match(renderMeLine(board({}), plainAscii)!, /#2 of 2/);
  assert.equal(renderMeLine(board({ me: null }), plainAscii), null);
});

test("sanitizeTerminalText removes control chars and newlines", () => {
  assert.equal(sanitizeTerminalText(`${ESC}[31mred${NEWLINE}next`), "[31mrednext");
  assert.equal(sanitizeTerminalText("plain-handle"), "plain-handle");
});

test("sanitizeTerminalText removes unicode bidi and zero-width controls, keeps normal text", () => {
  const rlo = String.fromCharCode(0x202e);
  const zwsp = String.fromCharCode(0x200b);
  const bom = String.fromCharCode(0xfeff);
  const alm = String.fromCharCode(0x061c);
  assert.equal(sanitizeTerminalText(`ev${rlo}il${zwsp}x${bom}${alm}`), "evilx");
  assert.equal(sanitizeTerminalText("café-münchen"), "café-münchen");
});

test("board table neutralizes escape/newline injection from remote handles", () => {
  const evil = board({
    entries: [entry({ rank: 1, handle: `${ESC}[2Jevil${NEWLINE}injected`, isMe: false })],
    totalEntries: 1,
    me: null,
  });
  const text = renderBoardTable(evil, plainAscii);
  assert.ok(!text.includes(ESC));
  assert.equal(text.split("\n").length, 2);
});
