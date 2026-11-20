import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import type { CommandResult, CommandRunner } from "../src/service/exec.js";
import type { SchedulerBackend } from "../src/service/backend.js";
import { runSteps } from "../src/service/steps.js";
import { SERVICE_LABEL, SYNC_INTERVAL_SECONDS, type ServiceSpec } from "../src/service/spec.js";
import { createLaunchdBackend, launchdPlistPath } from "../src/service/launchd.js";
import { createSystemdBackend, serviceUnitName, timerUnitName } from "../src/service/systemd.js";
import { createSchtasksBackend } from "../src/service/schtasks.js";
import { runServiceInstall, runServiceStatus, runServiceUninstall, summarizeStatus } from "../src/commands/service.js";

type Reply = Partial<CommandResult> | Error;

// Replays scripted results. A reply is picked by the longest key that prefixes "file arg arg…";
// unscripted commands succeed with empty output.
function fakeRunner(replies: Record<string, Reply> = {}) {
  const calls: string[] = [];
  const run: CommandRunner = async (file, args) => {
    const cmd = [file, ...args].join(" ");
    calls.push(cmd);
    const key = Object.keys(replies)
      .filter((k) => cmd.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    const reply = key === undefined ? {} : replies[key]!;
    if (reply instanceof Error) throw reply;
    return { code: 0, stdout: "", stderr: "", ...reply };
  };
  return { run, calls };
}

// Captures the CLI's own lines (they start with two spaces) and its exit code, passing anything else
// (the test reporter) through untouched.
async function runCli(fn: () => Promise<void>): Promise<{ text: string; exitCode: number }> {
  const lines: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string" && chunk.startsWith("  ")) {
      lines.push(chunk);
      return true;
    }
    return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  process.exitCode = undefined;
  try {
    await fn();
  } finally {
    process.stdout.write = write;
  }
  const exitCode = Number(process.exitCode ?? 0);
  process.exitCode = undefined;
  return { text: lines.join(""), exitCode };
}

let sandbox: string;
let spec: ServiceSpec;
const savedHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "tb-service-"));
  // Backends resolve ~/Library/LaunchAgents and ~/.config/systemd/user from HOME at call time.
  process.env.HOME = sandbox;
  process.env.USERPROFILE = sandbox;
  spec = {
    label: SERVICE_LABEL,
    nodePath: "/usr/local/bin/node",
    cliEntry: "/opt/tokenboard/dist/cli.js",
    args: ["sync"],
    intervalSeconds: SYNC_INTERVAL_SECONDS,
    // A config folder that doesn't exist yet, like a fresh machine before `tokenboard claim`.
    logPath: join(sandbox, "fresh-config", "tokenboard", "service.log"),
  };
});

afterEach(async () => {
  process.env.HOME = savedHome.HOME;
  process.env.USERPROFILE = savedHome.USERPROFILE;
  await rm(sandbox, { recursive: true, force: true });
});

const statuses = (steps: Array<{ step: string; status: string }>) => steps.map((s) => `${s.step}=${s.status}`);

test("runSteps turns a thrown error into a failed step and stops there", async () => {
  let ranAfter = false;
  const steps = await runSteps([
    ["first", async () => ({ status: "done", detail: "" })],
    ["boom", async () => { throw new Error("EACCES"); }],
    ["after", async () => { ranAfter = true; return { status: "done", detail: "" }; }],
  ]);
  assert.deepEqual(statuses(steps), ["first=done", "boom=failed"]);
  assert.equal(steps[1]!.detail, "EACCES");
  assert.equal(ranAfter, false);
});

test("summarizeStatus never calls an unreadable state active", () => {
  assert.equal(summarizeStatus([]), "unknown");
  assert.equal(summarizeStatus([{ step: "a", status: "done", detail: "" }, { step: "b", status: "unknown", detail: "" }]), "unknown");
  assert.equal(summarizeStatus([{ step: "a", status: "failed", detail: "" }]), "not installed");
  assert.equal(summarizeStatus([{ step: "a", status: "done", detail: "" }, { step: "b", status: "failed", detail: "" }]), "inactive");
  assert.equal(summarizeStatus([{ step: "a", status: "done", detail: "" }]), "active");
});

// ---- launchd ----

const LAUNCHD_NOT_LOADED = { code: 3, stderr: "Boot-out failed: 3: No such process" };

test("launchd install: happy path on a fresh machine creates the log folder and reports installed", async () => {
  const fake = fakeRunner({ "launchctl bootout": LAUNCHD_NOT_LOADED });
  const backend = createLaunchdBackend(fake.run);
  const { text, exitCode } = await runCli(() => runServiceInstall(backend, spec));

  assert.ok(existsSync(dirname(spec.logPath)), "log folder created");
  assert.ok(existsSync(launchdPlistPath(spec.label)), "plist written");
  assert.deepEqual(
    fake.calls.map((c) => c.split(" ").slice(0, 2).join(" ")),
    ["launchctl bootout", "launchctl bootstrap", "launchctl kickstart"],
  );
  assert.match(text, /\[ok\] create log folder/);
  assert.match(text, /\[skipped\] unload previous job: not loaded/);
  assert.match(text, /installed\. Syncing daily via launchd/);
  assert.equal(exitCode, 0);
});

test("launchd install: a failed kickstart is reported and the CLI does not claim installed", async () => {
  const fake = fakeRunner({
    "launchctl bootout": LAUNCHD_NOT_LOADED,
    "launchctl kickstart": { code: 113, stderr: 'Could not find service "sh.tokenboard.sync"' },
  });
  const { text, exitCode } = await runCli(() => runServiceInstall(createLaunchdBackend(fake.run), spec));

  assert.match(text, /\[FAILED\] start first sync: launchctl kickstart: Could not find service/);
  assert.doesNotMatch(text, /installed\. Syncing/);
  assert.match(text, /install incomplete, "start first sync" failed/);
  assert.equal(exitCode, 1);
});

test("launchd uninstall: a failed bootout keeps the plist and the CLI does not claim uninstalled", async () => {
  await mkdir(dirname(launchdPlistPath(spec.label)), { recursive: true });
  await writeFile(launchdPlistPath(spec.label), "<plist/>");
  const fake = fakeRunner({ "launchctl bootout": { code: 5, stderr: "Boot-out failed: 5: Input/output error" } });
  const { text, exitCode } = await runCli(() => runServiceUninstall(createLaunchdBackend(fake.run), spec));

  assert.ok(existsSync(launchdPlistPath(spec.label)), "plist must stay while the job may still be loaded");
  assert.match(text, /\[FAILED\] unload job: launchctl bootout: Boot-out failed: 5/);
  assert.doesNotMatch(text, /uninstalled from/);
  assert.equal(exitCode, 1);
});

test("launchd uninstall: a job that isn't loaded is skipped and the plist is removed", async () => {
  await mkdir(dirname(launchdPlistPath(spec.label)), { recursive: true });
  await writeFile(launchdPlistPath(spec.label), "<plist/>");
  const fake = fakeRunner({ "launchctl bootout": LAUNCHD_NOT_LOADED });
  const { text, exitCode } = await runCli(() => runServiceUninstall(createLaunchdBackend(fake.run), spec));

  assert.equal(existsSync(launchdPlistPath(spec.label)), false);
  assert.deepEqual(fake.calls, [`launchctl bootout gui/${process.getuid?.() ?? 0}/${spec.label}`]);
  assert.match(text, /uninstalled from launchd/);
  assert.equal(exitCode, 0);
});

test("launchd status: empty or unparseable launchctl output is unknown, never active", async () => {
  for (const stdout of ["", "garbage without a state line"]) {
    const fake = fakeRunner({ "launchctl print": { code: 0, stdout } });
    const { text, exitCode } = await runCli(() => runServiceStatus(createLaunchdBackend(fake.run), spec));
    assert.match(text, /tokenboard service: unknown \(launchd\)/, `stdout=${JSON.stringify(stdout)}`);
    assert.doesNotMatch(text, /: active/);
    assert.equal(exitCode, 1);
  }
});

test("launchd status: a thrown runner error is unknown; a parsed state is active; not found is not installed", async () => {
  const thrown = fakeRunner({ "launchctl print": new Error("spawn launchctl ENOENT") });
  assert.deepEqual(statuses(await createLaunchdBackend(thrown.run).status(spec)), ["registered with launchd=unknown"]);

  const ok = fakeRunner({ "launchctl print": { code: 0, stdout: "\tstate = not running\n" } });
  assert.equal(summarizeStatus(await createLaunchdBackend(ok.run).status(spec)), "active");

  const missing = fakeRunner({ "launchctl print": { code: 113, stderr: 'Could not find service "sh.tokenboard.sync"' } });
  assert.equal(summarizeStatus(await createLaunchdBackend(missing.run).status(spec)), "not installed");
});

// ---- systemd ----

const withSystemd = (run: CommandRunner): SchedulerBackend => createSystemdBackend(run, () => true);
const unitFile = (name: string) => join(sandbox, ".config", "systemd", "user", name);

test("systemd install: happy path on a fresh machine creates the log folder and reports installed", async () => {
  const fake = fakeRunner();
  const { text, exitCode } = await runCli(() => runServiceInstall(withSystemd(fake.run), spec));

  assert.ok(existsSync(dirname(spec.logPath)), "log folder created");
  assert.ok(existsSync(unitFile(timerUnitName(spec.label))));
  assert.deepEqual(fake.calls, [
    "systemctl --user daemon-reload",
    `systemctl --user enable --now ${timerUnitName(spec.label)}`,
    `systemctl --user start ${serviceUnitName(spec.label)}`,
  ]);
  assert.match(text, /installed\. Syncing daily via systemd/);
  assert.equal(exitCode, 0);
});

test("systemd install: a failed first start is reported and the CLI does not claim installed", async () => {
  const fake = fakeRunner({ "systemctl --user start": { code: 1, stderr: "Job for sh-tokenboard-sync.service failed." } });
  const { text, exitCode } = await runCli(() => runServiceInstall(withSystemd(fake.run), spec));

  assert.match(text, /\[FAILED\] start first sync: systemctl --user start: Job for/);
  assert.doesNotMatch(text, /installed\. Syncing/);
  assert.equal(exitCode, 1);
});

test("systemd install: no systemd fails the first step and runs nothing", async () => {
  const fake = fakeRunner();
  const steps = await createSystemdBackend(fake.run, () => false).install(spec);
  assert.deepEqual(statuses(steps), ["find systemd=failed"]);
  assert.deepEqual(fake.calls, []);
});

test("systemd uninstall: a failed disable keeps the unit files and the CLI does not claim uninstalled", async () => {
  await withSystemd(fakeRunner().run).install(spec);
  const fake = fakeRunner({ "systemctl --user disable": { code: 1, stderr: "Failed to connect to bus: No medium found" } });
  const { text, exitCode } = await runCli(() => runServiceUninstall(withSystemd(fake.run), spec));

  assert.ok(existsSync(unitFile(timerUnitName(spec.label))), "timer unit must stay while it may still be active");
  assert.ok(existsSync(unitFile(serviceUnitName(spec.label))));
  assert.deepEqual(fake.calls, [`systemctl --user disable --now ${timerUnitName(spec.label)}`]);
  assert.doesNotMatch(text, /uninstalled from/);
  assert.equal(exitCode, 1);
});

test("systemd uninstall: happy path removes the units and reloads", async () => {
  await withSystemd(fakeRunner().run).install(spec);
  const fake = fakeRunner();
  const { text, exitCode } = await runCli(() => runServiceUninstall(withSystemd(fake.run), spec));
  assert.equal(existsSync(unitFile(timerUnitName(spec.label))), false);
  assert.equal(fake.calls.at(-1), "systemctl --user daemon-reload");
  assert.match(text, /uninstalled from systemd/);
  assert.equal(exitCode, 0);
});

test("systemd status: empty is-active output or an unreachable user bus is unknown, never active or not installed", async () => {
  const empty = fakeRunner({ "systemctl --user is-enabled": { code: 0, stdout: "enabled\n" }, "systemctl --user is-active": { stdout: "" } });
  const { text, exitCode } = await runCli(() => runServiceStatus(withSystemd(empty.run), spec));
  assert.match(text, /tokenboard service: unknown \(systemd\)/);
  assert.equal(exitCode, 1);

  const noBus = fakeRunner({ "systemctl --user is-enabled": { code: 1, stderr: "Failed to connect to bus: No medium found" } });
  assert.equal(summarizeStatus(await withSystemd(noBus.run).status(spec)), "unknown");

  const active = fakeRunner({ "systemctl --user is-enabled": { stdout: "enabled\n" }, "systemctl --user is-active": { stdout: "active\n" } });
  assert.equal(summarizeStatus(await withSystemd(active.run).status(spec)), "active");
});

// ---- Task Scheduler ----

test("schtasks install: happy path on a fresh machine creates the log folder and reports installed", async () => {
  const fake = fakeRunner();
  const { text, exitCode } = await runCli(() => runServiceInstall(createSchtasksBackend(fake.run), spec));

  assert.ok(existsSync(dirname(spec.logPath)), "log folder created");
  assert.deepEqual(fake.calls.map((c) => c.split(" ").slice(0, 2).join(" ")), ["schtasks /Create", "schtasks /Run"]);
  assert.match(text, /installed\. Syncing daily via Task Scheduler/);
  assert.equal(exitCode, 0);
});

test("schtasks install: a failed /Run is reported and the CLI does not claim installed", async () => {
  const fake = fakeRunner({ "schtasks /Run": { code: 1, stderr: "ERROR: Access is denied." } });
  const { text, exitCode } = await runCli(() => runServiceInstall(createSchtasksBackend(fake.run), spec));

  assert.match(text, /\[FAILED\] start first sync: schtasks \/Run: ERROR: Access is denied\./);
  assert.doesNotMatch(text, /installed\. Syncing/);
  assert.equal(exitCode, 1);
});

test("schtasks uninstall: a failed /Delete is reported and the CLI does not claim uninstalled", async () => {
  const fake = fakeRunner({ "schtasks /Delete": { code: 1, stderr: "ERROR: Access is denied." } });
  const { text, exitCode } = await runCli(() => runServiceUninstall(createSchtasksBackend(fake.run), spec));

  assert.match(text, /\[FAILED\] delete task/);
  assert.doesNotMatch(text, /uninstalled from/);
  assert.equal(exitCode, 1);

  const missing = fakeRunner({ "schtasks /Delete": { code: 1, stderr: "ERROR: The system cannot find the file specified." } });
  const after = await runCli(() => runServiceUninstall(createSchtasksBackend(missing.run), spec));
  assert.match(after.text, /uninstalled from Task Scheduler/);
});

test("schtasks status: empty /Query output is unknown, never active", async () => {
  const fake = fakeRunner({ "schtasks /Query": { code: 0, stdout: "" } });
  const { text, exitCode } = await runCli(() => runServiceStatus(createSchtasksBackend(fake.run), spec));
  assert.match(text, /tokenboard service: unknown \(Task Scheduler\)/);
  assert.equal(exitCode, 1);

  const denied = fakeRunner({ "schtasks /Query": { code: 1, stderr: "ERROR: Access is denied." } });
  assert.equal(summarizeStatus(await createSchtasksBackend(denied.run).status(spec)), "unknown");

  const ready = fakeRunner({ "schtasks /Query": { stdout: "Status: Ready\nScheduled Task State: Enabled\n" } });
  assert.equal(summarizeStatus(await createSchtasksBackend(ready.run).status(spec)), "active");
});
