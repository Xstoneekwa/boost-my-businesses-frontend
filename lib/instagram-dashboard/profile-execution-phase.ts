export const executionPhases = [
  "QUEUED",
  "PRE_DEVICE",
  "RECOVERING",
  "STARTING_DEVICE",
  "STARTING_INSTAGRAM",
  "ACTIVE",
  "TERMINAL",
] as const;

export type ProfileExecutionPhase = (typeof executionPhases)[number];

type Row = Record<string, unknown> | undefined;

export type ProfileExecutionProjection = {
  executionPhase: ProfileExecutionPhase;
  executionDisplayState: "preparing" | "recovering" | "starting" | "active" | "idle";
  executionPhaseSource: string;
  instagramForegroundVerified: boolean;
  activeForegroundEvidence: string | null;
  executionResumeState: string | null;
  executionIrreversibleWorkState: string | null;
  zeroWorkCertifiedAt: string | null;
  rootBusinessSessionId: string | null;
  executionAttemptNo: number | null;
  retryIndex: number | null;
  maxExecutionAttempts: 3;
};

function text(row: Row, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function integer(row: Row, key: string) {
  const value = row?.[key];
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

function displayState(phase: ProfileExecutionPhase): ProfileExecutionProjection["executionDisplayState"] {
  if (phase === "RECOVERING") return "recovering";
  if (phase === "STARTING_DEVICE" || phase === "STARTING_INSTAGRAM") return "starting";
  if (phase === "ACTIVE") return "active";
  if (phase === "QUEUED" || phase === "PRE_DEVICE") return "preparing";
  return "idle";
}

export function projectProfileExecutionPhase(input: {
  request?: Row;
  run?: Row;
  capsule?: Row;
}): ProfileExecutionProjection {
  const { request, run, capsule } = input;
  const requestStatus = text(request, "status").toLowerCase();
  const runStatus = text(run, "status").toLowerCase();
  const resumeState = text(capsule, "resume_state").toLowerCase();
  const irreversibleState = text(capsule, "irreversible_work_state").toUpperCase();
  const foregroundAt = text(capsule, "instagram_foreground_verified_at");
  const deviceConnectedAt = text(capsule, "device_connected_at");
  const deviceActivityAt = text(capsule, "device_activity_started_at");
  const instagramLaunchAt = text(capsule, "instagram_launch_requested_at");
  const hasCurrentExecution = Boolean(request || run);

  let executionPhase: ProfileExecutionPhase = "TERMINAL";
  let executionPhaseSource = "no_current_execution";

  if (hasCurrentExecution && foregroundAt) {
    executionPhase = "ACTIVE";
    executionPhaseSource = "account_session_resume_plans.instagram_foreground_verified_at";
  } else if (hasCurrentExecution && ["pre_device_stopped", "recovery_enqueued"].includes(resumeState)) {
    executionPhase = "RECOVERING";
    executionPhaseSource = "account_session_resume_plans.resume_state";
  } else if (
    hasCurrentExecution
    && !capsule
    && text(request, "source_surface").toLowerCase() === "control_plane_zero_work_recovery_v1"
  ) {
    executionPhase = "RECOVERING";
    executionPhaseSource = "account_run_requests.source_surface";
  } else if (hasCurrentExecution && instagramLaunchAt) {
    executionPhase = "STARTING_INSTAGRAM";
    executionPhaseSource = "account_session_resume_plans.instagram_launch_requested_at";
  } else if (hasCurrentExecution && (deviceConnectedAt || deviceActivityAt || irreversibleState === "STARTED_OR_AMBIGUOUS")) {
    executionPhase = deviceConnectedAt ? "STARTING_INSTAGRAM" : "STARTING_DEVICE";
    executionPhaseSource = deviceConnectedAt
      ? "account_session_resume_plans.device_connected_at"
      : deviceActivityAt
        ? "account_session_resume_plans.device_activity_started_at"
        : "account_session_resume_plans.irreversible_work_state";
  } else if (hasCurrentExecution && irreversibleState === "PRE_DEVICE") {
    executionPhase = "PRE_DEVICE";
    executionPhaseSource = "account_session_resume_plans.irreversible_work_state";
  } else if (hasCurrentExecution && ["pending", "queued"].includes(requestStatus)) {
    executionPhase = "QUEUED";
    executionPhaseSource = "account_run_requests.status";
  } else if (hasCurrentExecution && (["claimed", "starting", "running"].includes(requestStatus) || ["pending", "running"].includes(runStatus))) {
    // A running row without its authoritative capsule is startup-incomplete,
    // never proof that Instagram reached foreground.
    executionPhase = "PRE_DEVICE";
    executionPhaseSource = "request_or_run_without_foreground_proof";
  }

  return {
    executionPhase,
    executionDisplayState: displayState(executionPhase),
    executionPhaseSource,
    instagramForegroundVerified: executionPhase === "ACTIVE",
    activeForegroundEvidence: executionPhase === "ACTIVE" ? foregroundAt : null,
    executionResumeState: text(capsule, "resume_state") || null,
    executionIrreversibleWorkState: text(capsule, "irreversible_work_state") || null,
    zeroWorkCertifiedAt: text(capsule, "zero_work_certified_at") || null,
    rootBusinessSessionId: text(request, "root_business_session_id") || null,
    executionAttemptNo: integer(request, "execution_attempt_no"),
    retryIndex: integer(request, "retry_index"),
    maxExecutionAttempts: 3,
  };
}
