import type { AddProfileRuntimeMode } from "@/lib/instagram-dashboard/add-profile-packages";

export type AddProfileAssignmentPolicyStatus =
  | "immediate_assignment"
  | "waiting_scheduled_assignment"
  | "manual_target_required";

export type AddProfileAssignmentPolicy = {
  status: AddProfileAssignmentPolicyStatus;
  shouldAssignNow: boolean;
  readinessStatus: "ready" | "waiting_scheduled_assignment" | "needs_phone_assignment";
  reason: string;
};

export function resolveAddProfileAssignmentPolicy(input: {
  runtimeMode: AddProfileRuntimeMode;
  deviceId?: string | null;
  appInstanceId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  allowScheduledWait?: boolean;
}): AddProfileAssignmentPolicy {
  const hasExplicitTarget = Boolean(input.deviceId?.trim() && input.appInstanceId?.trim());
  const hasExplicitSlot = Boolean(input.startsAt?.trim() && input.endsAt?.trim());

  if (hasExplicitTarget && hasExplicitSlot) {
    return {
      status: "immediate_assignment",
      shouldAssignNow: true,
      readinessStatus: "ready",
      reason: "explicit_phone_app_slot_selected",
    };
  }

  if (input.allowScheduledWait) {
    return {
      status: "waiting_scheduled_assignment",
      shouldAssignNow: false,
      readinessStatus: "waiting_scheduled_assignment",
      reason: "scheduler_capacity_assignment_pending",
    };
  }

  return {
    status: "manual_target_required",
    shouldAssignNow: false,
    readinessStatus: "needs_phone_assignment",
    reason: input.runtimeMode === "safe_setup" ? "safe_setup_requires_initial_target" : "phone_app_slot_required",
  };
}
