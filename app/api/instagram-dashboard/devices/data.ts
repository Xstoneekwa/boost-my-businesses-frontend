import { createSupabaseClient } from "@/lib/supabase";
import type { SupabaseRecord } from "../_utils";
import { readString } from "./value-readers";
import {
  safePhoneDevice,
  type AppInstanceRow,
  type AssignmentRow,
  type HeartbeatRow,
} from "./projection";

const localDevice = {
  id: "local-android-emulator",
  device_name: "Local Android Emulator",
  platform: "android",
  status: "available",
  notes: "Local fallback device for setup.",
  app_instances: [],
  app_instances_count: 0,
  app_instances_available_count: 0,
  app_instances_occupied_count: 0,
  heartbeat_status: "unknown",
  heartbeat_warning: "fallback_device",
};

export async function getDashboardDevices() {
  const supabase = createSupabaseClient();
  const [{ data: phones, error: phoneError }, { data: appInstances, error: appError }, { data: heartbeats }, { data: assignments }, { data: deviceLocks }] = await Promise.all([
      supabase
        .from("phone_devices")
        .select("id,device_kind,name,device_name,adb_serial,host_machine,pool_type,max_clones,status,timezone,updated_at")
        .neq("status", "retired")
        .order("name", { ascending: true }),
      supabase
        .from("phone_app_instances")
        .select("id,device_id,instance_type,instance_index,visible_label,package_name,is_launchable,status,current_account_id,usable_for_auto_login,updated_at")
        .order("instance_index", { ascending: true }),
      supabase
        .from("device_heartbeats")
        .select("device_id,adb_serial,status,last_seen_at,current_account_id,current_clone_id")
        .order("last_seen_at", { ascending: false }),
      supabase
        .from("account_assignments")
        .select("id,account_id,device_id,app_instance_id,status,schedule_mode,ig_accounts(username,status)")
        .in("status", ["pending", "reserved", "active"]),
      supabase
        .from("auto_restart_device_locks")
        .select("device_id,account_id,reason,owner_kind,heartbeat_at,lease_expires_at,request_id")
        .limit(500),
  ]);

  if (phoneError || appError) {
    return [localDevice];
  }

  const heartbeatByDevice = new Map(
    ((heartbeats ?? []) as HeartbeatRow[]).map((row) => [readString(row.device_id, ""), row]),
  );
  const nowIso = new Date().toISOString();
  const leaseByDevice = new Map(
    ((deviceLocks ?? []) as SupabaseRecord[])
      .filter((row) => {
        const lease = readString(row.lease_expires_at, "");
        return lease && lease > nowIso;
      })
      .map((row) => [readString(row.device_id, ""), row]),
  );
  const devices = ((phones ?? []) as SupabaseRecord[])
    .map((phone) => {
      const deviceId = readString(phone.id, "");
      const lease = leaseByDevice.get(deviceId);
      const heartbeatAt = readString(lease?.heartbeat_at, "");
      const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : Number.NaN;
      const ageSeconds = Number.isFinite(heartbeatMs)
        ? Math.max(0, Math.round((Date.now() - heartbeatMs) / 1000))
        : null;
      return safePhoneDevice(
        {
          ...phone,
          ui_lease_status: lease ? "active" : "available",
          ui_lease_operator_label: lease ? "Device currently in use" : "Device available",
          ui_lease_current_operation: lease ? readString(lease.reason, "ui_operation").replace(/_/g, " ") : null,
          ui_lease_owner_kind: readString(lease?.owner_kind, "") || null,
          ui_lease_age_seconds: ageSeconds,
          ui_lease_expires_at: readString(lease?.lease_expires_at, "") || null,
        },
        (appInstances ?? []) as AppInstanceRow[],
        heartbeatByDevice.get(deviceId),
        (assignments ?? []) as unknown as AssignmentRow[],
      );
    })
    .filter((phone) => phone.id);
  return devices.length ? devices : [localDevice];
}
