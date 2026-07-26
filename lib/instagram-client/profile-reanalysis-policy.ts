import type { StoredPublicAnalysisV1 } from "./profile-intelligence";

export const PROFILE_REANALYSIS_COOLDOWN_MS = 60_000;
export const PROFILE_REANALYSIS_LEASE_MS = 30_000;

export type ProfileReanalysisDecision =
  | { action: "allow" }
  | { action: "return_existing" }
  | { action: "reject"; code: string; status: number };

export function evaluateProfileReanalysis(input: {
  status: string;
  currentStep: string;
  expiresAt: string;
  analysis: StoredPublicAnalysisV1;
  requestKey: string;
  now?: Date;
}): ProfileReanalysisDecision {
  const now = input.now ?? new Date();
  if (input.status === "completed") return { action: "reject", code: "onboarding_completed", status: 409 };
  if (input.status === "expired" || input.status === "abandoned" || new Date(input.expiresAt).getTime() <= now.getTime()) {
    return { action: "reject", code: "onboarding_expired", status: 409 };
  }
  if (input.status !== "active" || input.currentStep !== "analysis") {
    return { action: "reject", code: "profile_reanalysis_not_available", status: 409 };
  }

  const reanalysis = input.analysis.reanalysis;
  if (!reanalysis) return { action: "allow" };
  const startedAtMs = new Date(reanalysis.started_at).getTime();
  const completedAtMs = reanalysis.completed_at ? new Date(reanalysis.completed_at).getTime() : 0;

  if (reanalysis.request_key === input.requestKey && reanalysis.status === "completed") {
    return { action: "return_existing" };
  }
  if (reanalysis.status === "running" && Number.isFinite(startedAtMs) && now.getTime() - startedAtMs < PROFILE_REANALYSIS_LEASE_MS) {
    return reanalysis.request_key === input.requestKey
      ? { action: "return_existing" }
      : { action: "reject", code: "profile_reanalysis_in_progress", status: 409 };
  }
  if (
    reanalysis.status === "completed"
    && completedAtMs > 0
    && now.getTime() - completedAtMs < PROFILE_REANALYSIS_COOLDOWN_MS
  ) {
    return { action: "reject", code: "profile_reanalysis_cooldown", status: 429 };
  }
  return { action: "allow" };
}
