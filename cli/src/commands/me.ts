import { resolveApiBase } from "../claim/api-base.js";
import { readAuthFile } from "../config/auth-store.js";
import { fetchBoard } from "../board/transport.js";
import { renderBoardTable, renderMeLine } from "../render/board-table.js";
import { resolveBoardOutputStyle } from "../render/output-style.js";
import type { BoardViewOptions } from "./top.js";

export async function runMe(options: BoardViewOptions): Promise<void> {
  const auth = await readAuthFile();
  if (!auth) throw new Error("not signed in — run `tokenboard claim` first.");

  const base = resolveApiBase();
  const board = await fetchBoard(base, {
    community: "global",
    window: options.window,
    metric: options.metric,
    limit: options.limit,
    me: auth.handle,
  });

  if (options.json) {
    process.stdout.write(JSON.stringify(board, null, 2) + "\n");
    return;
  }

  const style = resolveBoardOutputStyle(options);
  if (!board.me) {
    process.stdout.write(`  you're not on the board yet, @${auth.handle} — run \`tokenboard sync\`.\n`);
    return;
  }

  const extra = board.me.inTopN ? [] : [board.me.entry];
  process.stdout.write(renderBoardTable(board, style, extra) + "\n");
  const meLine = renderMeLine(board, style);
  if (meLine) process.stdout.write(meLine + "\n");
}
