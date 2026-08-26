export const EXECUTION_PHASES = [
  "QUEUED",
  "PREPARING",
  "RECOVERING",
  "STARTING_DEVICE",
  "STARTING_INSTAGRAM",
  "ACTIVE",
  "TERMINAL",
] as const;

export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

type Row = Record<string, unknown> | null | undefined;

function value(row: Row, key: string) {
  return String(row?.[key] ?? "").trim();
}

export function projectExecutionPhase(args: {
  activeRequest?: Row;
  activeRun?: Row;
  capsule?: Row;
  latestRun?: Row;
}): ExecutionPhase {
  const { activeRequest, activeRun, capsule } = args;
  if (!activeRequest && !activeRun) return "TERMINAL";

  const irreversible = value(capsule, "irreversible_work_state").toUpperCase();
  const foregroundVerifiedAt = value(capsule, "instagram_foreground_verified_at");
  const deviceConnectedAt = value(capsule, "device_connected_at");
  const resumeState = value(capsule, "resume_state").toLowerCase();
  const requestStatus = value(activeRequest, "status").toLowerCase();

  if (irreversible === "STARTED_OR_AMBIGUOUS" && deviceConnectedAt && foregroundVerifiedAt) {
    return "ACTIVE";
  }
  if (irreversible === "STARTED_OR_AMBIGUOUS" && deviceConnectedAt) {
    return "STARTING_INSTAGRAM";
  }
  if (irreversible === "STARTED_OR_AMBIGUOUS") {
    return "STARTING_DEVICE";
  }
  if (["pre_device_stopped", "recovery_enqueued", "resume_requested"].includes(resumeState)) {
    return "RECOVERING";
  }
  if (["pending", "queued"].includes(requestStatus)) return "QUEUED";
  return "PREPARING";
}

export function executionPhaseIsActive(phase: ExecutionPhase) {
  return phase === "ACTIVE";
}
