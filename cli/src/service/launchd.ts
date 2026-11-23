import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import type { ServiceSpec } from "./spec.js";
import type { SchedulerBackend } from "./backend.js";
import { commandDetail, type CommandRunner } from "./exec.js";
import { runSteps, type StepOutcome } from "./steps.js";

const NOT_LOADED = /no such process|could not find|not find/i;

const launchAgentsDir = () => join(homedir(), "Library", "LaunchAgents");
export const launchdPlistPath = (label: string) => join(launchAgentsDir(), `${label}.plist`);

const guiDomain = () => `gui/${process.getuid?.() ?? 0}`;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildLaunchdPlist(spec: ServiceSpec): string {
  const programArgs = [spec.nodePath, spec.cliEntry, ...spec.args]
    .map((arg) => `      <string>${xmlEscape(arg)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xmlEscape(spec.label)}</string>
    <key>ProgramArguments</key>
    <array>
${programArgs}
    </array>
    <key>StartInterval</key>
    <integer>${spec.intervalSeconds}</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>${xmlEscape(spec.logPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(spec.logPath)}</string>
</dict>
</plist>
`;
}

// `launchctl print` prints `state = running` / `state = not running` for a loaded job; anything else is unreadable.
export function parseLaunchdState(stdout: string): StepOutcome {
  const stateLine = stdout.split("\n").map((l) => l.trim()).find((l) => l.startsWith("state = "));
  return stateLine
    ? { status: "done", detail: stateLine }
    : { status: "unknown", detail: "launchctl print succeeded but showed no `state =` line" };
}

export function createLaunchdBackend(run: CommandRunner): SchedulerBackend {
  // Bootout by service target, not plist path: for a job that isn't loaded the target form exits
  // "3: No such process" (matched by NOT_LOADED), while the path form exits a generic "5: Input/output error".
  const target = (spec: ServiceSpec) => `${guiDomain()}/${spec.label}`;

  const unload = async (spec: ServiceSpec): Promise<StepOutcome> => {
    const boot = await run("launchctl", ["bootout", target(spec)]);
    if (boot.code === 0) return { status: "done", detail: "unloaded" };
    if (NOT_LOADED.test(`${boot.stderr}${boot.stdout}`)) return { status: "skipped", detail: "not loaded" };
    return { status: "failed", detail: `launchctl bootout: ${commandDetail(boot)} (the job may still be running)` };
  };

  return {
    name: "launchd",

    install: (spec) =>
      runSteps([
        ["create log folder", async () => {
          await mkdir(dirname(spec.logPath), { recursive: true });
          return { status: "done", detail: dirname(spec.logPath) };
        }],
        ["write plist", async () => {
          await mkdir(launchAgentsDir(), { recursive: true });
          await writeFile(launchdPlistPath(spec.label), buildLaunchdPlist(spec), "utf8");
          return { status: "done", detail: launchdPlistPath(spec.label) };
        }],
        ["unload previous job", () => unload(spec)],
        ["register with launchd", async () => {
          const boot = await run("launchctl", ["bootstrap", guiDomain(), launchdPlistPath(spec.label)]);
          return boot.code === 0
            ? { status: "done", detail: target(spec) }
            : { status: "failed", detail: `launchctl bootstrap: ${commandDetail(boot)}` };
        }],
        ["start first sync", async () => {
          const kick = await run("launchctl", ["kickstart", target(spec)]);
          return kick.code === 0
            ? { status: "done", detail: "started" }
            : { status: "failed", detail: `launchctl kickstart: ${commandDetail(kick)}` };
        }],
      ]),

    uninstall: (spec) =>
      runSteps([
        ["unload job", () => unload(spec)],
        ["remove plist", async () => {
          await rm(launchdPlistPath(spec.label), { force: true });
          return { status: "done", detail: launchdPlistPath(spec.label) };
        }],
      ]),

    status: (spec) =>
      runSteps(
        [
          ["registered with launchd", async () => {
            const print = await run("launchctl", ["print", target(spec)]);
            if (print.code === 0) return parseLaunchdState(print.stdout);
            if (NOT_LOADED.test(`${print.stderr}${print.stdout}`)) return { status: "failed", detail: "not registered" };
            return { status: "unknown", detail: `launchctl print: ${commandDetail(print)}` };
          }],
        ],
        "unknown",
      ),
  };
}
