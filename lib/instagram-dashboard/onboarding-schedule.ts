import { createSupabaseClient } from "@/lib/supabase";
import { readString, type SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";
import { readScheduleSlot } from "@/lib/instagram-dashboard/schedule";

function readRpcObject(value: unknown): SupabaseRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as SupabaseRecord;
  }
  return {};
}

export async function tryAutoAssignOnboardingSchedule(
  accountId: string,
  target: { deviceId?: string; appInstanceId?: string; startsAt?: string; endsAt?: string } = {},
) {
  const supabase = createSupabaseClient();
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

  let deviceId = target.deviceId || "";
  let startsAt = target.startsAt || "";
  let endsAt = target.endsAt || "";
  if (!deviceId || !startsAt || !endsAt) {
    const { data: slotCatalog, error: slotError } = await supabase.rpc("list_available_assignment_slots", {
      p_account_id: accountId,
      p_device_id: target.deviceId || null,
    });
    if (slotError) {
      return { assigned: false, reason: "slot_catalog_unavailable" };
    }

    const slotPayload = readRpcObject(slotCatalog);
    deviceId = readString(slotPayload.device_id, "");
    const slots = Array.isArray(slotPayload.slots)
      ? slotPayload.slots.map((row) => readScheduleSlot(row as SupabaseRecord))
      : [];
    const firstAvailable = slots.find((slot) => slot.available);
    if (!deviceId || !firstAvailable) {
      return { assigned: false, reason: "no_available_slot" };
    }
    startsAt = firstAvailable.starts_at;
    endsAt = firstAvailable.ends_at;
  }

  const { data: assignResult, error: assignError } = await supabase.rpc("assign_account_slot", {
    p_account_id: accountId,
    p_device_id: deviceId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_clone_id: target.appInstanceId || null,
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
