export type AccountAssignmentHealth = "unassigned" | "assigned" | "requires_attention";

export type AccountAssignmentHealthReason =
  | "no_active_assignment"
  | "assigned"
  | "multiple_active_assignments"
  | "assignment_device_missing"
  | "assignment_app_instance_missing"
  | "app_instance_account_missing"
  | "app_instance_account_mismatch"
  | "app_instance_device_mismatch"
  | "assignment_window_invalid"
  | "assignment_window_expired"
  | "app_instance_without_assignment";

type SupabaseRecord = Record<string, unknown>;

export type AccountCapacityProjection = {
  assignmentHealth: AccountAssignmentHealth;
  assignmentHealthReason: AccountAssignmentHealthReason;
};

function readString(row: SupabaseRecord | null | undefined, key: string) {
  const value = row?.[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readIsoTime(value: string) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isScheduledAssignment(assignment: SupabaseRecord) {
  const scheduleMode = readString(assignment, "schedule_mode");
  const slotKind = readString(assignment, "slot_kind");
  return scheduleMode === "scheduled" || (Boolean(slotKind) && slotKind !== "manual_only");
}

export function projectCanonicalAccountCapacityState(input: {
  accountId: string;
  assignment?: SupabaseRecord | null;
  activeAssignmentCount?: number;
  device?: SupabaseRecord | null;
  appInstance?: SupabaseRecord | null;
  appInstancesPointingToAccount?: SupabaseRecord[];
  now?: Date;
}): AccountCapacityProjection {
  const accountId = input.accountId.trim();
  const assignment = input.assignment ?? null;
  const pointingAppInstances = input.appInstancesPointingToAccount ?? [];

  if (!assignment) {
    return pointingAppInstances.length
      ? { assignmentHealth: "requires_attention", assignmentHealthReason: "app_instance_without_assignment" }
      : { assignmentHealth: "unassigned", assignmentHealthReason: "no_active_assignment" };
  }

  if ((input.activeAssignmentCount ?? 1) > 1) {
    return { assignmentHealth: "requires_attention", assignmentHealthReason: "multiple_active_assignments" };
  }

  const assignmentDeviceId = readString(assignment, "device_id");
  const assignmentAppInstanceId = readString(assignment, "app_instance_id");
  const deviceId = readString(input.device, "id");
  const appInstanceId = readString(input.appInstance, "id");
  if (!assignmentDeviceId || !deviceId) {
    return { assignmentHealth: "requires_attention", assignmentHealthReason: "assignment_device_missing" };
  }
  if (!assignmentAppInstanceId || !appInstanceId) {
    return { assignmentHealth: "requires_attention", assignmentHealthReason: "assignment_app_instance_missing" };
  }

  const appInstanceAccountId = readString(input.appInstance, "current_account_id");
  if (!appInstanceAccountId) {
    return { assignmentHealth: "requires_attention", assignmentHealthReason: "app_instance_account_missing" };
  }
  if (accountId && appInstanceAccountId !== accountId) {
    return { assignmentHealth: "requires_attention", assignmentHealthReason: "app_instance_account_mismatch" };
  }

  const appInstanceDeviceId = readString(input.appInstance, "device_id");
  if (appInstanceDeviceId && appInstanceDeviceId !== assignmentDeviceId) {
    return { assignmentHealth: "requires_attention", assignmentHealthReason: "app_instance_device_mismatch" };
  }

  if (isScheduledAssignment(assignment)) {
    const startsAt = readIsoTime(readString(assignment, "starts_at"));
    const endsAt = readIsoTime(readString(assignment, "ends_at"));
    if (!startsAt || !endsAt || startsAt >= endsAt) {
      return { assignmentHealth: "requires_attention", assignmentHealthReason: "assignment_window_invalid" };
    }
    if (!readString(assignment, "released_at") && endsAt < (input.now ?? new Date()).getTime()) {
      return { assignmentHealth: "requires_attention", assignmentHealthReason: "assignment_window_expired" };
    }
  }

  return { assignmentHealth: "assigned", assignmentHealthReason: "assigned" };
}
