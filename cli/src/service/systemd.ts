import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import type { ServiceSpec } from "./spec.js";
import type { SchedulerBackend } from "./backend.js";
import { commandDetail, type CommandRunner } from "./exec.js";
import { runSteps, type StepOutcome } from "./steps.js";

export function hasSystemd(): boolean {
  return existsSync("/run/systemd/system");
}

const NO_SYSTEMD_MESSAGE =
  "background sync needs systemd (systemctl --user), which this Linux system isn't running. Run `tokenboard sync` manually or from your own scheduler (cron, etc.).";

const userUnitDir = () => join(homedir(), ".config", "systemd", "user");
const unitBase = (label: string) => label.replace(/\./g, "-");
export const serviceUnitName = (label: string) => `${unitBase(label)}.service`;
export const timerUnitName = (label: string) => `${unitBase(label)}.timer`;

function systemdQuote(value: string): string {
  return /[\s"\\]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;
}

export function buildServiceUnit(spec: ServiceSpec): string {
  const exec = [spec.nodePath, spec.cliEntry, ...spec.args].map(systemdQuote).join(" ");
  return `[Unit]
Description=tokenboard daily usage sync

[Service]
Type=oneshot
ExecStart=${exec}
StandardOutput=append:${spec.logPath}
StandardError=append:${spec.logPath}
`;
}

export function buildTimerUnit(spec: ServiceSpec): string {
  return `[Unit]
Description=tokenboard daily usage sync (timer)

[Timer]
OnBootSec=2min
OnUnitActiveSec=${spec.intervalSeconds}s
Persistent=true

[Install]
WantedBy=timers.target
`;
}

const NOT_INSTALLED = /not loaded|no such file|does not exist|not.found/i;
const KNOWN_ACTIVE_STATES = new Set(["active", "inactive", "failed", "activating", "deactivating", "reloading"]);

export function parseIsActive(stdout: string): StepOutcome {
  const state = stdout.trim();
  if (state === "active") return { status: "done", detail: "timer active" };
  if (KNOWN_ACTIVE_STATES.has(state)) return { status: "failed", detail: `timer ${state}` };
  return { status: "unknown", detail: `systemctl is-active printed ${state ? `"${state}"` : "nothing"}` };
}

// systemdRunning is injectable so the systemctl paths can be tested on hosts without systemd.
export function createSystemdBackend(run: CommandRunner, systemdRunning: () => boolean = hasSystemd): SchedulerBackend {
  const systemctl = async (args: string[]): Promise<StepOutcome> => {
    const res = await run("systemctl", ["--user", ...args]);
    return res.code === 0
      ? { status: "done", detail: `systemctl --user ${args.join(" ")}` }
      : { status: "failed", detail: `systemctl --user ${args[0]}: ${commandDetail(res)}` };
  };
  const requireSystemd = async (): Promise<StepOutcome> =>
    systemdRunning() ? { status: "done", detail: "/run/systemd/system" } : { status: "failed", detail: NO_SYSTEMD_MESSAGE };
  const unitPaths = (spec: ServiceSpec) => [serviceUnitName(spec.label), timerUnitName(spec.label)].map((u) => join(userUnitDir(), u));

  return {
    name: "systemd",

    install: (spec) =>
      runSteps([
        ["find systemd", requireSystemd],
        ["create log folder", async () => {
          await mkdir(dirname(spec.logPath), { recursive: true });
          return { status: "done", detail: dirname(spec.logPath) };
        }],
        ["write unit files", async () => {
          const dir = userUnitDir();
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, serviceUnitName(spec.label)), buildServiceUnit(spec), "utf8");
          await writeFile(join(dir, timerUnitName(spec.label)), buildTimerUnit(spec), "utf8");
          return { status: "done", detail: dir };
        }],
        ["reload systemd", () => systemctl(["daemon-reload"])],
        ["enable timer", () => systemctl(["enable", "--now", timerUnitName(spec.label)])],
        ["start first sync", () => systemctl(["start", serviceUnitName(spec.label)])],
      ]),

    uninstall: (spec) =>
      runSteps([
        ["disable timer", async () => {
          if (!systemdRunning()) return { status: "skipped", detail: "systemd isn't running, so nothing is loaded" };
          const res = await run("systemctl", ["--user", "disable", "--now", timerUnitName(spec.label)]);
          if (res.code === 0) return { status: "done", detail: "timer stopped and disabled" };
          if (NOT_INSTALLED.test(`${res.stderr}${res.stdout}`)) return { status: "skipped", detail: "timer not installed" };
          return { status: "failed", detail: `systemctl --user disable: ${commandDetail(res)} (the timer may still be active)` };
        }],
        ["remove unit files", async () => {
          for (const path of unitPaths(spec)) await rm(path, { force: true });
          return { status: "done", detail: userUnitDir() };
        }],
        ["reload systemd", async () =>
          systemdRunning() ? systemctl(["daemon-reload"]) : { status: "skipped", detail: "systemd isn't running" }],
      ]),

    status: (spec) =>
      runSteps(
        [
          ["timer installed", async () => {
            if (!systemdRunning()) return { status: "failed", detail: "systemd isn't running on this system" };
            const res = await run("systemctl", ["--user", "is-enabled", timerUnitName(spec.label)]);
            const state = res.stdout.trim();
            if (res.code === 0) return { status: "done", detail: state || "enabled" };
            if (state === "disabled" || NOT_INSTALLED.test(`${res.stderr}${state}`)) return { status: "failed", detail: state || "not installed" };
            return { status: "unknown", detail: `systemctl is-enabled: ${commandDetail(res)}` };
          }],
          ["timer active", async () => parseIsActive((await run("systemctl", ["--user", "is-active", timerUnitName(spec.label)])).stdout)],
        ],
        "unknown",
      ),
  };
}
