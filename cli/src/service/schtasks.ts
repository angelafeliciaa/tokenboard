import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type { ServiceSpec } from "./spec.js";
import type { SchedulerBackend } from "./backend.js";
import { commandDetail, type CommandRunner } from "./exec.js";
import { runSteps, type StepOutcome } from "./steps.js";

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

export function parseSchtasksState(stdout: string): StepOutcome {
  const stateMatch = /Scheduled Task State:\s*(.+)/i.exec(stdout);
  const statusMatch = /(?:^|\n)\s*Status:\s*(.+)/i.exec(stdout);
  const state = (stateMatch?.[1] ?? statusMatch?.[1] ?? "").trim();
  if (!state) return { status: "unknown", detail: "schtasks /Query showed no task state" };
  return { status: /disabled/i.test(state) ? "failed" : "done", detail: `Task Scheduler: ${state}` };
}

export function createSchtasksBackend(run: CommandRunner): SchedulerBackend {
  return {
    name: "Task Scheduler",

    install: (spec) =>
      runSteps([
        ["create log folder", async () => {
          await mkdir(dirname(spec.logPath), { recursive: true });
          return { status: "done", detail: dirname(spec.logPath) };
        }],
        ["register task", async () => {
          const create = await run("schtasks", [
            "/Create",
            "/TN", taskName(spec.label),
            "/TR", buildSchtasksRunCommand(spec),
            ...scheduleArgs(spec),
            "/F",
          ]);
          return create.code === 0
            ? { status: "done", detail: taskName(spec.label) }
            : { status: "failed", detail: `schtasks /Create: ${commandDetail(create)}` };
        }],
        ["start first sync", async () => {
          const res = await run("schtasks", ["/Run", "/TN", taskName(spec.label)]);
          return res.code === 0
            ? { status: "done", detail: "started" }
            : { status: "failed", detail: `schtasks /Run: ${commandDetail(res)}` };
        }],
      ]),

    uninstall: (spec) =>
      runSteps([
        ["delete task", async () => {
          const del = await run("schtasks", ["/Delete", "/TN", taskName(spec.label), "/F"]);
          if (del.code === 0) return { status: "done", detail: taskName(spec.label) };
          if (TASK_NOT_FOUND.test(`${del.stderr}${del.stdout}`)) return { status: "skipped", detail: "task not registered" };
          return { status: "failed", detail: `schtasks /Delete: ${commandDetail(del)} (the task may still be registered)` };
        }],
      ]),

    status: (spec) => {
      let queryOutput = "";
      return runSteps(
        [
          ["registered with Task Scheduler", async () => {
            const query = await run("schtasks", ["/Query", "/TN", taskName(spec.label), "/V", "/FO", "LIST"]);
            if (query.code === 0) {
              queryOutput = query.stdout;
              return { status: "done", detail: taskName(spec.label) };
            }
            if (TASK_NOT_FOUND.test(`${query.stderr}${query.stdout}`)) return { status: "failed", detail: "not registered" };
            return { status: "unknown", detail: `schtasks /Query: ${commandDetail(query)}` };
          }],
          ["task enabled", async () => parseSchtasksState(queryOutput)],
        ],
        "unknown",
      );
    },
  };
}
