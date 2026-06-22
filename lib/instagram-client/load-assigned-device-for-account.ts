import { createSupabaseClient } from "@/lib/supabase";
import { readString } from "./guards";

export type AssignedDeviceForAccount = {
  assignmentId: string;
  deviceId: string;
  adbSerial: string;
  deviceLabel: string;
};

export async function loadAssignedDeviceForAccount(accountId: string): Promise<AssignedDeviceForAccount | null> {
  const supabase = createSupabaseClient();
  const normalizedAccountId = readString(accountId);
  if (!normalizedAccountId) return null;

  const { data: assignmentRows, error: assignmentError } = await supabase
    .from("account_assignments")
    .select("id,account_id,device_id,status")
    .eq("account_id", normalizedAccountId)
    .in("status", ["reserved", "active"])
    .order("starts_at", { ascending: true })
    .limit(1);

  if (assignmentError) return null;
  const assignment = (assignmentRows ?? [])[0] as Record<string, unknown> | undefined;
  const assignmentId = readString(assignment?.id);
  const deviceId = readString(assignment?.device_id);
  if (!assignmentId || !deviceId) return null;

  const { data: phoneRows, error: phoneError } = await supabase
    .from("phone_devices")
    .select("id,name,device_name,adb_serial,status")
    .eq("id", deviceId)
    .limit(1);

  if (phoneError) return null;
  const phone = (phoneRows ?? [])[0] as Record<string, unknown> | undefined;
  const adbSerial = readString(phone?.adb_serial);
  if (!adbSerial) return null;

  const deviceLabel = readString(phone?.device_name, readString(phone?.name, "Assigned phone"));
  return {
    assignmentId,
    deviceId,
    adbSerial,
    deviceLabel,
  };
}
