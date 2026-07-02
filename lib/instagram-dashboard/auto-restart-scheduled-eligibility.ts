function assignmentWindowContainsNow(startsAt: string, endsAt: string, now = new Date()) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const ts = now.getTime();
  return start <= ts && ts < end;
}

export type AutoRestartScheduleGateInput = {
  scheduleMode?: string;
  startsAt?: string;
  endsAt?: string;
  respectSixHourWindow?: boolean;
  hasAssignment?: boolean;
  hasActiveRun?: boolean;
  hasActiveRequest?: boolean;
  hasOpenIncident?: boolean;
  deviceId?: string;
  appInstanceId?: string;
  now?: Date;
};

export function manualOnlyAutoRestartBlockReason(scheduleMode: string | undefined) {
  if (String(scheduleMode || "").trim().toLowerCase() === "manual_only") {
    return "manual_only_requires_manual_trigger";
  }
  return null;
}

export function activeScheduleWindowBlockReason(input: {
  scheduleMode?: string;
  startsAt?: string;
  endsAt?: string;
  respectSixHourWindow?: boolean;
  now?: Date;
}) {
  const manualOnlyReason = manualOnlyAutoRestartBlockReason(input.scheduleMode);
  if (manualOnlyReason) return manualOnlyReason;

  const startsAt = String(input.startsAt || "").trim();
  const endsAt = String(input.endsAt || "").trim();
  if (!startsAt || !endsAt) return "assignment_missing";

  if (input.respectSixHourWindow !== false
    && !assignmentWindowContainsNow(startsAt, endsAt, input.now ?? new Date())) {
    return "assignment_window_closed";
  }

  return null;
}

export function accountHasActiveScheduledSlot(input: AutoRestartScheduleGateInput) {
  return activeScheduleWindowBlockReason(input) === null;
}

export function evaluateAutoRestartScheduleGate(input: AutoRestartScheduleGateInput): string | null {
  const scheduleReason = activeScheduleWindowBlockReason(input);
  if (scheduleReason) return scheduleReason;

  if (!String(input.deviceId || "").trim() || !String(input.appInstanceId || "").trim()) {
    return "assignment_or_device_pending";
  }
  if (input.hasOpenIncident) return "open_incident_blocked";
  if (input.hasActiveRun) return "active_run_exists";
  if (input.hasActiveRequest) return "active_run_request_exists";

  return null;
}
