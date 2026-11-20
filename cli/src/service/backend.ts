import { platform } from "node:os";
import type { ServiceSpec } from "./spec.js";
import { runCommand, type CommandRunner } from "./exec.js";
import { createLaunchdBackend } from "./launchd.js";
import { createSystemdBackend } from "./systemd.js";
import { createSchtasksBackend } from "./schtasks.js";

export interface ServiceStatus {
  installed: boolean;
  loaded: boolean;
  detail: string;
}

export interface InstallResult {
  firstRunStarted: boolean;
  firstRunDetail?: string;
}

export interface SchedulerBackend {
  readonly name: string;
  install(spec: ServiceSpec): Promise<InstallResult>;
  uninstall(spec: ServiceSpec): Promise<void>;
  status(spec: ServiceSpec): Promise<ServiceStatus>;
}

export function selectBackend(os: NodeJS.Platform = platform(), run: CommandRunner = runCommand): SchedulerBackend {
  switch (os) {
    case "darwin":
      return createLaunchdBackend(run);
    case "linux":
      return createSystemdBackend(run);
    case "win32":
      return createSchtasksBackend(run);
    default:
      throw new Error(`background sync is not supported on this platform (${os}). Run \`tokenboard sync\` manually or from your own scheduler.`);
  }
}
