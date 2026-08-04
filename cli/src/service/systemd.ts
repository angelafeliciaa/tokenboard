import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import type { ServiceSpec } from "./spec.js";
import type { SchedulerBackend } from "./backend.js";
import { runCommand } from "./exec.js";

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

export const systemdBackend: SchedulerBackend = {
  name: "systemd",

  async install(spec) {
    if (!hasSystemd()) throw new Error(NO_SYSTEMD_MESSAGE);
    const dir = userUnitDir();
    await mkdir(dir, { recursive: true });
    await mkdir(dirname(spec.logPath), { recursive: true });
    await writeFile(join(dir, serviceUnitName(spec.label)), buildServiceUnit(spec), "utf8");
    await writeFile(join(dir, timerUnitName(spec.label)), buildTimerUnit(spec), "utf8");

    await runCommand("systemctl", ["--user", "daemon-reload"]);
    const enable = await runCommand("systemctl", ["--user", "enable", "--now", timerUnitName(spec.label)]);
    if (enable.code !== 0) {
      throw new Error(`systemctl enable failed: ${enable.stderr.trim() || enable.stdout.trim() || `exit ${enable.code}`}`);
    }
    const start = await runCommand("systemctl", ["--user", "start", serviceUnitName(spec.label)]);
    return start.code === 0
      ? { firstRunStarted: true }
      : { firstRunStarted: false, firstRunDetail: start.stderr.trim() || start.stdout.trim() || `exit ${start.code}` };
  },

  async uninstall(spec) {
    if (hasSystemd()) {
      const disable = await runCommand("systemctl", ["--user", "disable", "--now", timerUnitName(spec.label)]);
      if (disable.code !== 0 && !/not loaded|no such file|does not exist/i.test(`${disable.stderr}${disable.stdout}`)) {
        throw new Error(`systemctl disable failed (timer may still be active): ${disable.stderr.trim() || disable.stdout.trim() || `exit ${disable.code}`}`);
      }
    }
    await rm(join(userUnitDir(), serviceUnitName(spec.label)), { force: true });
    await rm(join(userUnitDir(), timerUnitName(spec.label)), { force: true });
    if (hasSystemd()) {
      await runCommand("systemctl", ["--user", "daemon-reload"]);
    }
  },

  async status(spec) {
    if (!hasSystemd()) return { installed: false, loaded: false, detail: "systemd not available on this system" };
    const active = await runCommand("systemctl", ["--user", "is-active", timerUnitName(spec.label)]);
    const loaded = active.stdout.trim() === "active";
    const enabled = await runCommand("systemctl", ["--user", "is-enabled", timerUnitName(spec.label)]);
    const installed = enabled.code === 0 || loaded;
    return {
      installed,
      loaded,
      detail: loaded ? `timer active (${enabled.stdout.trim() || "enabled"})` : installed ? "timer installed but inactive" : "timer not installed",
    };
  },
};
