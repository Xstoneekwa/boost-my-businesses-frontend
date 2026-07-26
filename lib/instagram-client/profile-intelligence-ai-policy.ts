import {
  PROFILE_INTELLIGENCE_COOLDOWN_MS,
  PROFILE_INTELLIGENCE_LEASE_MS,
  readStoredProfileAiAnalysis,
  type StoredProfileAiAnalysis,
} from "./profile-intelligence-ai.ts";

export type ProfileAiDecision =
  | { action: "allow"; reclaimedLease: boolean }
  | { action: "return_existing" }
  | { action: "reject"; code: string; status: number };

function timestamp(value: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateProfileAiAnalysis(input: {
  sessionStatus: string;
  currentStep: string;
  expiresAt: string;
  requestKey: string;
  aiAnalysis?: StoredProfileAiAnalysis | null;
  now?: Date;
}): ProfileAiDecision {
  const now = input.now ?? new Date();
  if (input.sessionStatus !== "active") {
    return { action: "reject", code: input.sessionStatus === "completed" ? "onboarding_completed" : "onboarding_inactive", status: 409 };
  }
  if (input.currentStep !== "analysis") {
    return { action: "reject", code: "profile_ai_wrong_step", status: 409 };
  }
  const expiresAt = timestamp(input.expiresAt);
  if (expiresAt !== null && expiresAt <= now.getTime()) {
    return { action: "reject", code: "onboarding_expired", status: 410 };
  }

  const analysis = readStoredProfileAiAnalysis(input.aiAnalysis);
  if (analysis.status === "running") {
    const leaseExpiresAt = timestamp(analysis.lease_expires_at)
      ?? ((timestamp(analysis.requested_at) ?? now.getTime()) + PROFILE_INTELLIGENCE_LEASE_MS);
    if (leaseExpiresAt > now.getTime()) {
      return analysis.request_key === input.requestKey
        ? { action: "return_existing" }
        : { action: "reject", code: "profile_ai_in_progress", status: 409 };
    }
    return { action: "allow", reclaimedLease: true };
  }

  if (analysis.request_key === input.requestKey && (analysis.status === "completed" || analysis.status === "failed_retryable")) {
    return { action: "return_existing" };
  }

  if (analysis.status === "completed") {
    const completedAt = timestamp(analysis.completed_at);
    if (completedAt !== null && now.getTime() - completedAt < PROFILE_INTELLIGENCE_COOLDOWN_MS) {
      return { action: "reject", code: "profile_ai_cooldown", status: 429 };
    }
  }

  return { action: "allow", reclaimedLease: false };
}
