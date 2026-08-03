import { resolveApiBase } from "../claim/api-base.js";
import { readAuthFile } from "../config/auth-store.js";
import { fetchBoard } from "../board/transport.js";
import { renderBoardTable, renderMeLine } from "../render/board-table.js";
import { resolveBoardOutputStyle } from "../render/output-style.js";
import type { BoardWindow, BoardMetric } from "@tokenboard/contracts";

export interface BoardViewOptions {
  window: BoardWindow;
  metric: BoardMetric;
  limit?: number;
  json: boolean;
  noColor: boolean;
  ascii: boolean;
}

export async function runTop(options: BoardViewOptions): Promise<void> {
  const base = resolveApiBase();
  const auth = await readAuthFile();
  const board = await fetchBoard(base, {
    community: "global",
    window: options.window,
    metric: options.metric,
    format: options.json ? "json" : "cli",
    limit: options.limit,
    me: auth?.handle,
  });

  if (options.json) {
    process.stdout.write(JSON.stringify(board, null, 2) + "\n");
    return;
  }

  const style = resolveBoardOutputStyle(options);
  const extra = board.me && !board.me.inTopN ? [board.me.entry] : [];
  process.stdout.write(renderBoardTable(board, style, extra) + "\n");
  const meLine = renderMeLine(board, style);
  if (meLine) process.stdout.write(meLine + "\n");
}
