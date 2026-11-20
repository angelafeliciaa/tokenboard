import { open } from "node:fs/promises";
import { readAuthFile } from "../config/auth-store.js";
import { selectBackend, type SchedulerBackend } from "../service/backend.js";
import { buildServiceSpec, SYNC_INTERVAL_SECONDS, type ServiceSpec } from "../service/spec.js";
import type { StepResult, StepStatus } from "../service/steps.js";

const out = (line: string) => process.stdout.write(`${line}\n`);
const LOG_TAIL_BYTES = 64 * 1024;

function cadenceLabel(seconds: number): string {
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return days === 1 ? "daily" : `every ${days} days`;
  }
  return `every ${Math.round(seconds / 60)} min`;
}

export function tailRange(fileSize: number, maxBytes: number = LOG_TAIL_BYTES): { start: number; length: number } {
  const start = Math.max(0, fileSize - maxBytes);
  return { start, length: fileSize - start };
}

export async function readLastRun(logPath: string): Promise<{ at: Date; line: string } | null> {
  let handle;
  try {
    handle = await open(logPath, "r");
    const info = await handle.stat();
    const { start, length } = tailRange(info.size);
    const buffer = Buffer.alloc(length);
    const bytesRead = length > 0 ? (await handle.read(buffer, 0, length, start)).bytesRead : 0;
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const lastLine = text.split("\n").map((l) => l.trim()).filter(Boolean).at(-1);
    if (!lastLine) return { at: info.mtime, line: "(no output yet)" };
    const hasInteriorNewline = text.replace(/\n+$/, "").includes("\n");
    const truncated = start > 0 && !hasInteriorNewline;
    return { at: info.mtime, line: truncated ? `…${lastLine}` : lastLine };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  } finally {
    await handle?.close();
  }
}

const STEP_MARK: Record<StepStatus, string> = { done: "ok", skipped: "skipped", failed: "FAILED", unknown: "unknown" };
// Status steps are checks, not actions: a "failed" check just means "no".
const CHECK_MARK: Record<StepStatus, string> = { done: "yes", skipped: "skipped", failed: "no", unknown: "unknown" };

function printSteps(steps: StepResult[], marks: Record<StepStatus, string> = STEP_MARK): void {
  for (const s of steps) out(`  [${marks[s.status]}] ${s.step}${s.detail ? `: ${s.detail}` : ""}`);
}

// The step that stopped the run (backends stop at the first step that isn't done/skipped), if any.
const firstProblem = (steps: StepResult[]) => steps.find((s) => s.status !== "done" && s.status !== "skipped");

export type ServiceState = "active" | "inactive" | "not installed" | "unknown";

// Status steps are ordered "is it registered?" then "is it armed?". Anything unreadable is unknown —
// never reported as running.
export function summarizeStatus(steps: StepResult[]): ServiceState {
  if (steps.length === 0 || steps.some((s) => s.status === "unknown")) return "unknown";
  if (steps[0]!.status === "failed") return "not installed";
  return steps.every((s) => s.status === "done") ? "active" : "inactive";
}

export async function runServiceInstall(backend: SchedulerBackend = selectBackend(), spec: ServiceSpec = buildServiceSpec()): Promise<void> {
  const steps = await backend.install(spec);
  printSteps(steps);

  const problem = firstProblem(steps);
  if (problem) {
    out(`  tokenboard service: install incomplete, "${problem.step}" ${problem.status === "failed" ? "failed" : "is unknown"}.`);
    out("  Fix that, then run `tokenboard service install` again. Until then, run `tokenboard sync` by hand.");
    process.exitCode = 1;
    return;
  }

  out(`  tokenboard service: installed. Syncing ${cadenceLabel(SYNC_INTERVAL_SECONDS)} via ${backend.name}.`);
  out(`  Logs: ${spec.logPath}`);

  let signedIn: boolean;
  try {
    signedIn = (await readAuthFile()) !== null;
  } catch {
    // A malformed auth.json must not fail an install that already succeeded; the nudge below covers it.
    signedIn = false;
  }
  if (!signedIn) {
    out("  Not signed in yet: run `tokenboard claim` so the background sync has credentials.");
  }
}

export async function runServiceUninstall(backend: SchedulerBackend = selectBackend(), spec: ServiceSpec = buildServiceSpec()): Promise<void> {
  const steps = await backend.uninstall(spec);
  printSteps(steps);

  const problem = firstProblem(steps);
  if (problem) {
    out(`  tokenboard service: uninstall incomplete, "${problem.step}" failed. Background sync may still run.`);
    out("  Fix that, then run `tokenboard service uninstall` again.");
    process.exitCode = 1;
    return;
  }
  out(`  tokenboard service: uninstalled from ${backend.name}. Background sync stopped.`);
}

export async function runServiceStatus(backend: SchedulerBackend = selectBackend(), spec: ServiceSpec = buildServiceSpec()): Promise<void> {
  const steps = await backend.status(spec);
  const state = summarizeStatus(steps);

  out(`  tokenboard service: ${state === "inactive" ? "installed (inactive)" : state} (${backend.name}).`);
  printSteps(steps, CHECK_MARK);

  if (state === "unknown") {
    out(`  Couldn't read the job's state from ${backend.name}; see the step above.`);
    process.exitCode = 1;
  }

  const lastRun = await readLastRun(spec.logPath);
  if (lastRun) {
    out(`  Last run: ${lastRun.at.toISOString()}`);
    out(`    ${lastRun.line}`);
  } else if (state === "active" || state === "inactive") {
    out("  Last run: not yet. The first sync runs shortly after install.");
  }

  if (state === "not installed") {
    out("  Run `tokenboard service install` to start syncing in the background.");
  }
}
