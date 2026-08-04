import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { platform } from "node:os";
import { realpathSync } from "node:fs";
import { buildServiceSpec, resolveServiceLogPath, resolveCliEntry, SERVICE_LABEL, SYNC_INTERVAL_SECONDS, type ServiceSpec } from "../src/service/spec.js";
import { selectBackend } from "../src/service/backend.js";
import { buildLaunchdPlist, launchdPlistPath } from "../src/service/launchd.js";
import { buildServiceUnit, buildTimerUnit, serviceUnitName, timerUnitName } from "../src/service/systemd.js";
import { taskName, buildSchtasksRunCommand, scheduleArgs, parseSchtasksState } from "../src/service/schtasks.js";

const spec: ServiceSpec = {
  label: SERVICE_LABEL,
  nodePath: "/opt/node bin/node",
  cliEntry: "/home/devon/.npm/tokenboard/dist/cli.js",
  args: ["sync"],
  intervalSeconds: SYNC_INTERVAL_SECONDS,
  logPath: "/home/devon/.config/tokenboard/service.log",
};

test("the default sync job runs daily", () => {
  assert.equal(SYNC_INTERVAL_SECONDS, 86_400);
  const isWin = platform() === "win32";
  const configRoot = isWin ? "C:\\cfg" : "/cfg";
  const env = (isWin ? { APPDATA: configRoot } : { XDG_CONFIG_HOME: configRoot }) as NodeJS.ProcessEnv;
  const s = buildServiceSpec({ nodePath: "/x/node", cliEntry: "/x/cli.js" }, env);
  assert.equal(s.label, SERVICE_LABEL);
  assert.deepEqual(s.args, ["sync"]);
  assert.equal(s.intervalSeconds, 86_400);
  assert.equal(s.logPath, join(configRoot, "tokenboard", "service.log"));
});

test("resolveServiceLogPath sits beside auth.json in the config dir", () => {
  assert.ok(resolveServiceLogPath().endsWith(join("tokenboard", "service.log")));
});

test("resolveCliEntry resolves the executed script (process.argv[1]) to an absolute path", () => {
  const saved = process.argv[1];
  try {
    const realScript = join(process.cwd(), "package.json");
    process.argv[1] = realScript;
    assert.equal(resolveCliEntry(), realpathSync(realScript));

    process.argv[1] = "relative/cli.js";
    assert.equal(resolveCliEntry(), resolve(process.cwd(), "relative/cli.js"));

    process.argv[1] = "";
    assert.match(resolveCliEntry(), /spec\.(ts|js)$/);
  } finally {
    process.argv[1] = saved;
  }
});

test("selectBackend maps each OS and fails loud on the rest", () => {
  assert.equal(selectBackend("darwin").name, "launchd");
  assert.equal(selectBackend("linux").name, "systemd");
  assert.equal(selectBackend("win32").name, "Task Scheduler");
  assert.throws(() => selectBackend("aix" as NodeJS.Platform), /not supported/);
});

test("launchd plist carries the invocation, daily interval, and log, XML-escaped", () => {
  const plist = buildLaunchdPlist({ ...spec, cliEntry: "/a & b/cli.js" });
  assert.match(plist, /<string>sh\.tokenboard\.sync<\/string>/);
  assert.match(plist, /<string>\/opt\/node bin\/node<\/string>/);
  assert.match(plist, /<string>sync<\/string>/);
  assert.match(plist, /<integer>86400<\/integer>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /\/a &amp; b\/cli\.js/);
});

test("launchdPlistPath lands in ~/Library/LaunchAgents", () => {
  assert.ok(launchdPlistPath(SERVICE_LABEL).endsWith(join("Library", "LaunchAgents", "sh.tokenboard.sync.plist")));
});

test("systemd units run the sync daily and append to the log", () => {
  assert.match(buildServiceUnit(spec), /ExecStart="\/opt\/node bin\/node" \/home\/devon\/\.npm\/tokenboard\/dist\/cli\.js sync/);
  assert.match(buildServiceUnit(spec), /StandardOutput=append:\/home\/devon\/\.config\/tokenboard\/service\.log/);
  assert.match(buildTimerUnit(spec), /OnUnitActiveSec=86400s/);
  assert.match(buildTimerUnit(spec), /Persistent=true/);
  assert.equal(serviceUnitName(SERVICE_LABEL), "sh-tokenboard-sync.service");
  assert.equal(timerUnitName(SERVICE_LABEL), "sh-tokenboard-sync.timer");
});

test("schtasks uses /SC DAILY for a daily interval and redirects to the log", () => {
  assert.equal(taskName(SERVICE_LABEL), "tokenboard-sync");
  assert.deepEqual(scheduleArgs(spec), ["/SC", "DAILY", "/MO", "1"]);
  assert.deepEqual(scheduleArgs({ ...spec, intervalSeconds: 3600 }), ["/SC", "MINUTE", "/MO", "60"]);
  assert.match(buildSchtasksRunCommand(spec), /^cmd \/c "\/opt\/node bin\/node" ".+cli\.js" "sync" >> ".+service\.log" 2>&1$/);
});

test("parseSchtasksState marks a disabled task as not loaded", () => {
  assert.equal(parseSchtasksState("Scheduled Task State: Enabled\nStatus: Ready").loaded, true);
  assert.equal(parseSchtasksState("Scheduled Task State: Disabled").loaded, false);
});
