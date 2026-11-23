export type StepStatus = "done" | "failed" | "skipped" | "unknown";

export interface StepResult {
  step: string;
  status: StepStatus;
  detail: string;
}

export type StepOutcome = Omit<StepResult, "step">;

// Runs steps in order and stops at the first one that isn't done/skipped, so a later step never acts on
// a state an earlier failure left unknown (e.g. deleting a unit file while its job is still loaded).
// A thrown error becomes `onError` instead of escaping past the steps already recorded.
export async function runSteps(
  plan: Array<[step: string, action: () => Promise<StepOutcome>]>,
  onError: "failed" | "unknown" = "failed",
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const [step, action] of plan) {
    let outcome: StepOutcome;
    try {
      outcome = await action();
    } catch (err) {
      outcome = { status: onError, detail: err instanceof Error ? err.message : String(err) };
    }
    results.push({ step, ...outcome });
    if (outcome.status !== "done" && outcome.status !== "skipped") break;
  }
  return results;
}
