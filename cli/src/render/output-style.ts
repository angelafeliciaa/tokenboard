import { resolveStyle, type TerminalStyle } from "./terminal-style.js";

export interface OutputStyleOptions {
  noColor: boolean;
  ascii: boolean;
}

export function resolveBoardOutputStyle(options: OutputStyleOptions): TerminalStyle {
  return resolveStyle({
    isTTY: Boolean(process.stdout.isTTY),
    noColorEnv: process.env["NO_COLOR"] !== undefined,
    noColorFlag: options.noColor,
    asciiFlag: options.ascii,
    columns: process.stdout.columns,
    colorterm: process.env["COLORTERM"],
    term: process.env["TERM"],
    forceColor: process.env["FORCE_COLOR"],
  });
}
