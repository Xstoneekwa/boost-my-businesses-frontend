import {
  isAssignmentOnPhysicalPhone,
  resolveLiveAssignmentTarget,
} from "@/lib/instagram-dashboard/assignment-live-capacity";
import { createSupabaseClient } from "@/lib/supabase";
import { readString, type SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";

function readRpcObject(value: unknown): SupabaseRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as SupabaseRecord;
  }
  return {};
}

async function releaseIneligibleOnboardingAssignment(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const { data: existing } = await supabase
    .from("account_assignments")
    .select("id,device_id,status")
    .eq("account_id", accountId)
    .in("status", ["pending", "reserved", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  if (!existing?.id) return { released: false };

  const onPhysicalPhone = await isAssignmentOnPhysicalPhone(supabase, existing);
  if (onPhysicalPhone) return { released: false };

  const { data, error } = await supabase.rpc("release_account_schedule_capacity", {
    p_account_id: accountId,
    p_reason: "onboarding_physical_reassignment",
    p_source: "onboarding_auto",
    p_actor_id: null,
  });
  if (error) return { released: false, reason: readString(error.message, "release_failed") };
  const payload = readRpcObject(data);
  return { released: payload.ok === true, reason: readString(payload.reason, "") };
}

export async function tryAutoAssignOnboardingSchedule(
  accountId: string,
  target: { deviceId?: string; appInstanceId?: string; startsAt?: string; endsAt?: string } = {},
) {
  const supabase = createSupabaseClient();
  await releaseIneligibleOnboardingAssignment(supabase, accountId);

  const { data: subscriptionAccount, error: subscriptionError } = await supabase
    .from("client_subscription_accounts")
    .select("id,account_id,status,subscription_id")
    .eq("account_id", accountId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<SupabaseRecord>();

  if (subscriptionError || !subscriptionAccount) {
    return { assigned: false, reason: "subscription_account_missing" };
  }

  const explicitWindowProvided = Boolean(target.startsAt && target.endsAt);
  const resolution = await resolveLiveAssignmentTarget(supabase, accountId, {
    explicitDeviceId: target.deviceId,
    explicitAppInstanceId: target.appInstanceId,
    explicitStartsAt: target.startsAt,
    explicitEndsAt: target.endsAt,
    reservationMode: explicitWindowProvided ? "immediate" : "onboarding",
    requireCurrentWindow: explicitWindowProvided,
    deviceKindPolicy: target.deviceId ? "any_eligible" : "physical_phone_only",
    skipIfAssigned: true,
  });

  if (resolution.reason === "already_assigned") {
    return { assigned: true, reason: "already_assigned", assignment: {} };
  }
  if (!resolution.ok) {
    return { assigned: false, reason: resolution.reason };
  }

  const liveTarget = resolution.target;
  const { data: assignResult, error: assignError } = await supabase.rpc("assign_account_slot", {
    p_account_id: accountId,
    p_device_id: liveTarget.deviceId,
    p_starts_at: liveTarget.startsAt,
    p_ends_at: liveTarget.endsAt,
    p_clone_id: liveTarget.appInstanceId,
    p_assignment_source: "onboarding_auto",
  });

  if (assignError) {
    return { assigned: false, reason: readString(assignError.message, "assign_failed") };
  }

  return {
    assigned: true,
    reason: "onboarding_auto_assigned",
    assignment: readRpcObject(assignResult),
  };
}

export async function tryAssignManualOnlyOnboardingSchedule(
  accountId: string,
  target: { deviceId?: string; appInstanceId?: string } = {},
) {
  if (!target.deviceId || !target.appInstanceId) {
    return { assigned: false, reason: "manual_only_requires_app_instance", assignment: {} };
  }

  const supabase = createSupabaseClient();
  const resolution = await resolveLiveAssignmentTarget(supabase, accountId, {
    explicitDeviceId: target.deviceId,
    explicitAppInstanceId: target.appInstanceId,
    requireScheduleSlot: false,
    deviceKindPolicy: "any_eligible",
    skipIfAssigned: true,
  });
  if (resolution.reason === "already_assigned") {
    return { assigned: true, reason: "already_assigned", assignment: {} };
  }
  if (!resolution.ok) {
    return { assigned: false, reason: resolution.reason, assignment: {} };
  }

  const { data: assignResult, error: assignError } = await supabase.rpc("assign_account_manual_only", {
    p_account_id: accountId,
    p_device_id: target.deviceId,
    p_app_instance_id: target.appInstanceId,
    p_assignment_source: "onboarding_auto",
  });

  if (assignError) {
    return { assigned: false, reason: readString(assignError.message, "assign_failed"), assignment: {} };
  }

  return {
    assigned: true,
    reason: "manual_only_assigned",
    assignment: readRpcObject(assignResult),
  };
}
