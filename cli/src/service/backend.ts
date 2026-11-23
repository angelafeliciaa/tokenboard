import { platform } from "node:os";
import type { ServiceSpec } from "./spec.js";
import type { StepResult } from "./steps.js";
import { runCommand, type CommandRunner } from "./exec.js";
import { createLaunchdBackend } from "./launchd.js";
import { createSystemdBackend } from "./systemd.js";
import { createSchtasksBackend } from "./schtasks.js";

export interface SchedulerBackend {
  readonly name: string;
  install(spec: ServiceSpec): Promise<StepResult[]>;
  uninstall(spec: ServiceSpec): Promise<StepResult[]>;
  status(spec: ServiceSpec): Promise<StepResult[]>;
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
