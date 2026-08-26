export const RESUME_STATE_CONTRACT_VERSION = "golden_resume_plan_contract_v1";

export const DB_ALLOWED_RESUME_STATES = [
  "run_active",
  "pre_device_stopped",
  "recovery_enqueued",
  "awaiting_human_resume_authorization",
  "resume_requested",
  "resume_succeeded",
  "not_recoverable",
  "completed",
] as const;

export type CanonicalResumeState = (typeof DB_ALLOWED_RESUME_STATES)[number];

export const STALE_RESUME_PLAN_STATE = "STALE_RESUME_PLAN_STATE";

const ACTIVE_RUN_STATES = new Set(["pending", "running"]);
const ACTIVE_REQUEST_STATES = new Set(["pending", "claimed", "starting", "running"]);

export function resolveRunActiveProof(input: {
  resumeState: string;
  sourceRunStatus: string;
  sourceRequestStatus: string;
  activeRunExists: boolean;
  activeRequestExists: boolean;
  liveDeviceLockExists: boolean;
}) {
  if (input.resumeState.trim().toLowerCase() !== "run_active") {
    return { proven: true, reason: "resume_state_not_run_active" } as const;
  }
  const sourceRunActive = ACTIVE_RUN_STATES.has(input.sourceRunStatus.trim().toLowerCase());
  const sourceRequestActive = ACTIVE_REQUEST_STATES.has(input.sourceRequestStatus.trim().toLowerCase());
  const activeRunProof = sourceRunActive && input.activeRunExists;
  const activeRequestProof = sourceRequestActive && input.activeRequestExists;
  if (activeRunProof || activeRequestProof || input.liveDeviceLockExists) {
    return { proven: true, reason: "run_active_live_proof" } as const;
  }
  return { proven: false, reason: STALE_RESUME_PLAN_STATE } as const;
}

export function backendUnderstandsEveryDbResumeState(states: readonly string[]) {
  const understood = new Set<string>(DB_ALLOWED_RESUME_STATES);
  return states.every((state) => understood.has(state));
}
