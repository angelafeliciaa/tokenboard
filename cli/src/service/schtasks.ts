import type { ServiceSpec } from "./spec.js";
import type { SchedulerBackend, ServiceStatus } from "./backend.js";
import { runCommand } from "./exec.js";

export const taskName = (label: string) => label.replace(/^sh\./, "").replace(/\./g, "-");

export function buildSchtasksRunCommand(spec: ServiceSpec): string {
  const inner = [spec.nodePath, spec.cliEntry, ...spec.args].map((a) => `"${a}"`).join(" ");
  return `cmd /c ${inner} >> "${spec.logPath}" 2>&1`;
}

const intervalMinutes = (spec: ServiceSpec) => Math.max(1, Math.round(spec.intervalSeconds / 60));

export function parseSchtasksState(stdout: string): { loaded: boolean; detail: string } {
  const stateMatch = /Scheduled Task State:\s*(.+)/i.exec(stdout);
  const statusMatch = /(?:^|\n)\s*Status:\s*(.+)/i.exec(stdout);
  const state = (stateMatch?.[1] ?? statusMatch?.[1] ?? "").trim();
  const disabled = /disabled/i.test(state);
  return { loaded: !disabled, detail: state ? `Task Scheduler: ${state}` : "registered with Task Scheduler" };
}

export const schtasksBackend: SchedulerBackend = {
  name: "Task Scheduler",

  async install(spec) {
    const create = await runCommand("schtasks", [
      "/Create",
      "/TN", taskName(spec.label),
      "/TR", buildSchtasksRunCommand(spec),
      "/SC", "MINUTE",
      "/MO", String(intervalMinutes(spec)),
      "/F",
    ]);
    if (create.code !== 0) {
      throw new Error(`schtasks /Create failed: ${create.stderr.trim() || create.stdout.trim() || `exit ${create.code}`}`);
    }
    await runCommand("schtasks", ["/Run", "/TN", taskName(spec.label)]);
  },

  async uninstall(spec) {
    await runCommand("schtasks", ["/Delete", "/TN", taskName(spec.label), "/F"]);
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
