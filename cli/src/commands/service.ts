import { open, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { readAuthFile, resolveConfigDir } from "../config/auth-store.js";
import { resolveApiBase } from "../claim/api-base.js";
import { selectBackend, serviceSupported } from "../service/backend.js";
import { buildServiceSpec, SYNC_INTERVAL_SECONDS } from "../service/spec.js";

const out = (line: string) => process.stdout.write(`${line}\n`);

const LOG_TAIL_BYTES = 64 * 1024;

export async function readLastRun(logPath: string): Promise<{ at: Date; line: string } | null> {
  let handle;
  try {
    handle = await open(logPath, "r");
    const info = await handle.stat();
    const start = Math.max(0, info.size - LOG_TAIL_BYTES);
    const length = info.size - start;
    const buffer = Buffer.alloc(length);
    if (length > 0) await handle.read(buffer, 0, length, start);
    const lastLine = buffer.toString("utf8").split("\n").map((l) => l.trim()).filter(Boolean).at(-1);
    return { at: info.mtime, line: lastLine ?? "(no output yet)" };
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

  out(`  tokenboard service — installed. Syncing every ${SYNC_INTERVAL_SECONDS / 60} min via ${backend.name}.`);
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
    out("  Run `tokenboard service install` to start syncing hourly in the background.");
  }
}

type CheckStatus = "ok" | "warn" | "fail";
interface DoctorCheck {
  label: string;
  status: CheckStatus;
  note: string;
}

async function checkConfigWritable(): Promise<DoctorCheck> {
  const dir = resolveConfigDir();
  try {
    await access(dir, constants.W_OK);
    return { label: "config dir writable", status: "ok", note: dir };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      return { label: "config dir writable", status: "fail", note: `${dir} — ${(err as Error).message}` };
    }
    const parent = dirname(dir);
    try {
      await access(parent, constants.W_OK);
      return { label: "config dir writable", status: "ok", note: `${dir} (created on first claim)` };
    } catch (parentErr) {
      return { label: "config dir writable", status: "fail", note: `${parent} — ${(parentErr as Error).message}` };
    }
  }
}

async function checkBackground(spec: ReturnType<typeof buildServiceSpec>): Promise<DoctorCheck> {
  if (!serviceSupported()) {
    return { label: "background sync", status: "warn", note: `no background scheduler on ${process.platform}` };
  }
  const backend = selectBackend();
  const status = await backend.status(spec);
  if (status.loaded) return { label: "background sync", status: "ok", note: `${backend.name}: ${status.detail}` };
  if (status.installed) return { label: "background sync", status: "warn", note: `installed but inactive — ${status.detail}` };
  return { label: "background sync", status: "warn", note: "not installed — run `tokenboard service install`" };
}

async function checkServerReachable(): Promise<DoctorCheck> {
  const base = resolveApiBase();
  try {
    const res = await fetch(new URL(`${base}/api/v1/board?limit=1`), { signal: AbortSignal.timeout(8_000) });
    return { label: "server reachable", status: res.ok ? "ok" : "warn", note: `${base} (HTTP ${res.status})` };
  } catch (err) {
    return { label: "server reachable", status: "warn", note: `${base} — ${(err as Error).message}` };
  }
}

export async function runServiceDoctor(): Promise<void> {
  const spec = buildServiceSpec();
  const auth = await readAuthFile();

  const checks: DoctorCheck[] = [
    auth
      ? { label: "signed in", status: "ok", note: `@${auth.handle}` }
      : { label: "signed in", status: "fail", note: "run `tokenboard claim`" },
    await checkConfigWritable(),
    await checkBackground(spec),
  ];

  const lastRun = await readLastRun(spec.logPath);
  if (lastRun) {
    const looksWrong = /error|rejected|not signed in/i.test(lastRun.line);
    checks.push({ label: "last run", status: looksWrong ? "warn" : "ok", note: `${lastRun.at.toISOString()} — ${lastRun.line}` });
  } else {
    checks.push({ label: "last run", status: "warn", note: "no background runs recorded yet" });
  }

  checks.push(await checkServerReachable());

  out("  tokenboard service doctor");
  for (const check of checks) {
    const tag = check.status === "ok" ? "[ok]  " : check.status === "warn" ? "[warn]" : "[fail]";
    out(`  ${tag} ${check.label} — ${check.note}`);
  }

  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  if (fails > 0) {
    out(`  ${fails} problem${fails === 1 ? "" : "s"} to fix${warns > 0 ? `, ${warns} warning${warns === 1 ? "" : "s"}` : ""}.`);
    process.exitCode = 1;
  } else if (warns > 0) {
    out(`  ${warns} warning${warns === 1 ? "" : "s"}, nothing blocking.`);
  } else {
    out("  all good.");
  }
}
