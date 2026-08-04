import { open } from "node:fs/promises";
import { readAuthFile } from "../config/auth-store.js";
import { selectBackend } from "../service/backend.js";
import { buildServiceSpec, SYNC_INTERVAL_SECONDS } from "../service/spec.js";

const out = (line: string) => process.stdout.write(`${line}\n`);
const LOG_TAIL_BYTES = 64 * 1024;

function cadenceLabel(seconds: number): string {
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return days === 1 ? "daily" : `every ${days} days`;
  }
  return `every ${Math.round(seconds / 60)} min`;
}

export async function readLastRun(logPath: string): Promise<{ at: Date; line: string } | null> {
  let handle;
  try {
    handle = await open(logPath, "r");
    const info = await handle.stat();
    const start = Math.max(0, info.size - LOG_TAIL_BYTES);
    const length = info.size - start;
    const buffer = Buffer.alloc(length);
    const bytesRead = length > 0 ? (await handle.read(buffer, 0, length, start)).bytesRead : 0;
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const lastLine = text.split("\n").map((l) => l.trim()).filter(Boolean).at(-1);
    if (!lastLine) return { at: info.mtime, line: "(no output yet)" };
    const truncated = start > 0 && !text.includes("\n");
    return { at: info.mtime, line: truncated ? `…${lastLine}` : lastLine };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  } finally {
    await handle?.close();
  }
}

export async function runServiceInstall(): Promise<void> {
  const backend = selectBackend();
  const spec = buildServiceSpec();
  await backend.install(spec);

  out(`  tokenboard service — installed. Syncing ${cadenceLabel(SYNC_INTERVAL_SECONDS)} via ${backend.name}.`);
  out(`  Logs: ${spec.logPath}`);

  if (!(await readAuthFile())) {
    out("  Not signed in yet — run `tokenboard claim` so the background sync has credentials.");
  }
}

export async function runServiceUninstall(): Promise<void> {
  const backend = selectBackend();
  const spec = buildServiceSpec();
  await backend.uninstall(spec);
  out(`  tokenboard service — removed from ${backend.name}. Background sync stopped.`);
}

export async function runServiceStatus(): Promise<void> {
  const backend = selectBackend();
  const spec = buildServiceSpec();
  const status = await backend.status(spec);

  out(`  tokenboard service — ${status.loaded ? "active" : status.installed ? "installed (inactive)" : "not installed"} (${backend.name}).`);
  out(`  ${status.detail}`);

  const lastRun = await readLastRun(spec.logPath);
  if (lastRun) {
    out(`  Last run: ${lastRun.at.toISOString()}`);
    out(`    ${lastRun.line}`);
  } else if (status.installed) {
    out("  Last run: not yet — the first sync runs shortly after install.");
  }

  if (!status.installed) {
    out("  Run `tokenboard service install` to start syncing in the background.");
  }
}
