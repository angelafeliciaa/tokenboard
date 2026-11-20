import { execFile } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (file: string, args: string[]) => Promise<CommandResult>;

export const runCommand: CommandRunner = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { encoding: "utf8" }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : err ? 1 : 0;
      // A spawn error (e.g. ENOENT: the scheduler binary isn't installed) has no stderr; keep its message.
      resolve({ code, stdout: stdout ?? "", stderr: stderr || (err && code === 1 ? err.message : "") });
    });
  });

export function commandDetail(result: CommandResult): string {
  return result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
}
