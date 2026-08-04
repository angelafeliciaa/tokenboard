import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type { ServiceSpec } from "./spec.js";
import type { SchedulerBackend } from "./backend.js";
import { runCommand } from "./exec.js";

const TASK_NOT_FOUND = /cannot find|does not exist|no such/i;

export const taskName = (label: string) => label.replace(/^sh\./, "").replace(/\./g, "-");

export function buildSchtasksRunCommand(spec: ServiceSpec): string {
  const inner = [spec.nodePath, spec.cliEntry, ...spec.args].map((a) => `"${a}"`).join(" ");
  return `cmd /c ${inner} >> "${spec.logPath}" 2>&1`;
}

export function scheduleArgs(spec: ServiceSpec): string[] {
  if (spec.intervalSeconds % 86_400 === 0) {
    return ["/SC", "DAILY", "/MO", String(spec.intervalSeconds / 86_400)];
  }
  return ["/SC", "MINUTE", "/MO", String(Math.max(1, Math.round(spec.intervalSeconds / 60)))];
}

export function parseSchtasksState(stdout: string): { loaded: boolean; detail: string } {
  const stateMatch = /Scheduled Task State:\s*(.+)/i.exec(stdout);
  const statusMatch = /(?:^|\n)\s*Status:\s*(.+)/i.exec(stdout);
  const state = (stateMatch?.[1] ?? statusMatch?.[1] ?? "").trim();
  if (!state) return { loaded: false, detail: "registered with Task Scheduler (state unknown)" };
  return { loaded: !/disabled/i.test(state), detail: `Task Scheduler: ${state}` };
}

export const schtasksBackend: SchedulerBackend = {
  name: "Task Scheduler",

  async install(spec) {
    await mkdir(dirname(spec.logPath), { recursive: true });
    const create = await runCommand("schtasks", [
      "/Create",
      "/TN", taskName(spec.label),
      "/TR", buildSchtasksRunCommand(spec),
      ...scheduleArgs(spec),
      "/F",
    ]);
    if (create.code !== 0) {
      throw new Error(`schtasks /Create failed: ${create.stderr.trim() || create.stdout.trim() || `exit ${create.code}`}`);
    }
    const run = await runCommand("schtasks", ["/Run", "/TN", taskName(spec.label)]);
    return run.code === 0
      ? { firstRunStarted: true }
      : { firstRunStarted: false, firstRunDetail: run.stderr.trim() || run.stdout.trim() || `exit ${run.code}` };
  },

  async uninstall(spec) {
    const del = await runCommand("schtasks", ["/Delete", "/TN", taskName(spec.label), "/F"]);
    if (del.code !== 0 && !TASK_NOT_FOUND.test(`${del.stderr}${del.stdout}`)) {
      throw new Error(`schtasks /Delete failed (task may still be registered): ${del.stderr.trim() || del.stdout.trim() || `exit ${del.code}`}`);
    }
  },

  async status(spec) {
    const query = await runCommand("schtasks", ["/Query", "/TN", taskName(spec.label), "/V", "/FO", "LIST"]);
    if (query.code !== 0) {
      return { installed: false, loaded: false, detail: "not registered with Task Scheduler" };
    }
    const { loaded, detail } = parseSchtasksState(query.stdout);
    return { installed: true, loaded, detail };
  },
};
