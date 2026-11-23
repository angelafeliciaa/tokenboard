import { fileURLToPath } from "node:url";
import { join, isAbsolute, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { resolveConfigDir } from "../config/auth-store.js";

export const SERVICE_LABEL = "sh.tokenboard.sync";

export const SYNC_INTERVAL_SECONDS = 86_400;

export interface ServiceSpec {
  label: string;
  nodePath: string;
  cliEntry: string;
  args: string[];
  intervalSeconds: number;
  logPath: string;
}

export function resolveServiceLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveConfigDir(env), "service.log");
}

export function resolveCliEntry(): string {
  const entry = process.argv[1];
  if (entry) {
    const abs = isAbsolute(entry) ? entry : resolve(process.cwd(), entry);
    try {
      return realpathSync(abs);
    } catch {
      return abs;
    }
  }
  return fileURLToPath(import.meta.url);
}

export function buildServiceSpec(
  overrides: Partial<ServiceSpec> = {},
  env: NodeJS.ProcessEnv = process.env,
): ServiceSpec {
  return {
    label: SERVICE_LABEL,
    nodePath: process.execPath,
    cliEntry: resolveCliEntry(),
    args: ["sync"],
    intervalSeconds: SYNC_INTERVAL_SECONDS,
    logPath: resolveServiceLogPath(env),
    ...overrides,
  };
}
