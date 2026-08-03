import stringWidth from "string-width";
import { humanizeTokens, formatApproxUsd } from "./humanize.js";
import { styler, type TerminalStyle } from "./terminal-style.js";
import { sanitizeTerminalText } from "./sanitize.js";
import type { BoardResponse, BoardEntry, BoardMetric } from "@tokenboard/contracts";

const handleText = (entry: BoardEntry): string => `@${sanitizeTerminalText(entry.handle)}`;

function padStartW(value: string, width: number): string {
  const gap = width - stringWidth(value);
  return gap > 0 ? " ".repeat(gap) + value : value;
}

function padEndW(value: string, width: number): string {
  const gap = width - stringWidth(value);
  return gap > 0 ? value + " ".repeat(gap) : value;
}

function metricCell(entry: BoardEntry, metric: BoardMetric): string {
  return metric === "cost" ? formatApproxUsd(entry.cost) : humanizeTokens(entry.tokens);
}

function deltaCell(entry: BoardEntry, ascii: boolean): string {
  const { direction, rankChange } = entry.delta;
  if (direction === "new") return "new";
  if (direction === "up") return `${ascii ? "^" : "▲"}${Math.abs(rankChange)}`;
  if (direction === "down") return `${ascii ? "v" : "▼"}${Math.abs(rankChange)}`;
  return ascii ? "-" : "·";
}

function windowLabel(window: BoardResponse["window"]): string {
  if (window === "7d") return "last 7 days";
  if (window === "30d") return "last 30 days";
  return "all time";
}

export function renderBoardTable(
  board: BoardResponse,
  style: TerminalStyle,
  extraEntries: BoardEntry[] = [],
): string {
  const c = styler(style);
  const rows = [...board.entries, ...extraEntries];
  const title = sanitizeTerminalText(board.community ? board.community.name : "Global board");
  const header = c.bold(title) + c.dim(` · ${windowLabel(board.window)} · ${board.metric}`);

  if (rows.length === 0) {
    return `  ${header}\n  ${c.dim("no entries yet — be the first to sync.")}`;
  }

  const rankW = Math.max(...rows.map((e) => stringWidth(String(e.rank))));
  const handleW = Math.max(...rows.map((e) => stringWidth(handleText(e))));
  const valueW = Math.max(...rows.map((e) => stringWidth(metricCell(e, board.metric))));

  const lines = rows.map((entry) => {
    const rank = padStartW(String(entry.rank), rankW);
    const handle = padEndW(handleText(entry), handleW);
    const value = padStartW(metricCell(entry, board.metric), valueW);
    const delta = deltaCell(entry, style.ascii);
    const marker = entry.isMe ? c.coral(style.ascii ? ">" : "›") : " ";
    const handleColored = entry.isMe ? c.coralHi(handle) : handle;
    const deltaColored =
      entry.delta.direction === "up"
        ? c.green(delta)
        : entry.delta.direction === "down"
          ? c.red(delta)
          : c.dim(delta);
    return `  ${marker} ${c.dim(rank)}  ${handleColored}  ${c.bold(value)}  ${deltaColored}`;
  });

  return [`  ${header}`, ...lines].join("\n");
}

export function renderMeLine(board: BoardResponse, style: TerminalStyle): string | null {
  const c = styler(style);
  if (!board.me) return null;
  return c.dim(`  you: #${board.me.rank} of ${board.me.totalEntries}`);
}
