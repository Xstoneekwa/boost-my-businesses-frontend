export const CLIENT_ONBOARDING_STEPS = [
  "connection",
  "analysis",
  "protection_lists",
  "targeting",
  "targets",
  "complete",
] as const;

export type ClientOnboardingRenderStep = typeof CLIENT_ONBOARDING_STEPS[number];
export type ClientOnboardingRenderIssue =
  | "onboarding_payload_incomplete"
  | "onboarding_step_render_failed";

type SessionLike = {
  accountId?: unknown;
  canRestart?: unknown;
  currentStep?: unknown;
  publicAnalysis?: unknown;
};

type ResumeRowLike = {
  failure_reason?: unknown;
  status?: unknown;
};

const ACCOUNT_REQUIRED_STEPS = new Set<ClientOnboardingRenderStep>([
  "protection_lists",
  "targeting",
  "targets",
  "complete",
]);

export function isClientOnboardingRenderStep(value: unknown): value is ClientOnboardingRenderStep {
  return typeof value === "string"
    && CLIENT_ONBOARDING_STEPS.includes(value as ClientOnboardingRenderStep);
}

export function resolveClientOnboardingRenderIssue(
  session: SessionLike | null,
): ClientOnboardingRenderIssue | null {
  if (!session || session.canRestart === true) return null;
  if (!isClientOnboardingRenderStep(session.currentStep)) return "onboarding_step_render_failed";
  if (session.currentStep === "analysis" && !session.publicAnalysis) return "onboarding_payload_incomplete";
  if (ACCOUNT_REQUIRED_STEPS.has(session.currentStep)
    && (typeof session.accountId !== "string" || !session.accountId.trim())) {
    return "onboarding_payload_incomplete";
  }
  return null;
}

export function clientOnboardingProgressIndex(step: unknown) {
  if (step === "analysis") return 1;
  if (step === "protection_lists" || step === "targeting") return 2;
  if (step === "targets") return 3;
  if (step === "complete") return 4;
  return 0;
}

const RESUMABLE_ONBOARDING_STATUSES = new Set([
  "active",
  "creating",
  "failed_retryable",
  "expired",
  "abandoned",
]);

export function isClientOnboardingResumeCandidate(row: ResumeRowLike) {
  const status = typeof row.status === "string" ? row.status.trim().toLowerCase() : "";
  const failureReason = typeof row.failure_reason === "string"
    ? row.failure_reason.trim().toLowerCase()
    : "";
  if (!RESUMABLE_ONBOARDING_STATUSES.has(status)) return false;
  if (failureReason.includes("rollback") || failureReason.includes("rolled_back")) return false;
  return true;
}
