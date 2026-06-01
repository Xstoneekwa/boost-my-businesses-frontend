import { createSupabaseClient } from "@/lib/supabase";
import { readString, type SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";
import { readScheduleSlot } from "@/lib/instagram-dashboard/schedule";

function readRpcObject(value: unknown): SupabaseRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as SupabaseRecord;
  }
  return {};
}

export async function tryAutoAssignOnboardingSchedule(accountId: string) {
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

  const { data: slotCatalog, error: slotError } = await supabase.rpc("list_available_assignment_slots", {
    p_account_id: accountId,
  });
  if (slotError) {
    return { assigned: false, reason: "slot_catalog_unavailable" };
  }

  const slotPayload = readRpcObject(slotCatalog);
  const deviceId = readString(slotPayload.device_id, "");
  const slots = Array.isArray(slotPayload.slots)
    ? slotPayload.slots.map((row) => readScheduleSlot(row as SupabaseRecord))
    : [];
  const firstAvailable = slots.find((slot) => slot.available);
  if (!deviceId || !firstAvailable) {
    return { assigned: false, reason: "no_available_slot" };
  }

  const { data: assignResult, error: assignError } = await supabase.rpc("assign_account_slot", {
    p_account_id: accountId,
    p_device_id: deviceId,
    p_starts_at: firstAvailable.starts_at,
    p_ends_at: firstAvailable.ends_at,
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
