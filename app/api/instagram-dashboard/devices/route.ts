import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, requireInstagramAdmin, type SupabaseRecord } from "../_utils";

export const dynamic = "force-dynamic";

type AppInstanceRow = SupabaseRecord & {
  id?: unknown;
  device_id?: unknown;
  instance_type?: unknown;
  instance_index?: unknown;
  visible_label?: unknown;
  package_name?: unknown;
  is_launchable?: unknown;
  status?: unknown;
  current_account_id?: unknown;
  usable_for_auto_login?: unknown;
};

type HeartbeatRow = SupabaseRecord & {
  device_id?: unknown;
  adb_serial?: unknown;
  status?: unknown;
  last_seen_at?: unknown;
  current_account_id?: unknown;
  current_clone_id?: unknown;
};

const heartbeatStaleMs = 15 * 60 * 1000;
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

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function maskedAdbSerial(value: unknown) {
  const serial = readString(value, "").trim();
  if (!serial) return "";
  if (serial.length <= 4) return serial;
  return `${serial.slice(0, 4)}...${serial.slice(-4)}`;
}

function heartbeatProjection(row: HeartbeatRow | undefined) {
  if (!row) return { heartbeat_status: "unknown", heartbeat_warning: "adb_status_unknown", heartbeat_last_seen_at: "" };
  const status = readString(row.status, "unknown");
  const lastSeenAt = readString(row.last_seen_at, "");
  const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : Number.NaN;
  const stale = Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs > heartbeatStaleMs;
  return {
    heartbeat_status: stale ? "stale" : status,
    heartbeat_warning: stale ? "stale_heartbeat" : status === "online" ? "" : status,
    heartbeat_last_seen_at: lastSeenAt,
    current_account_id: readString(row.current_account_id, "") || null,
    current_clone_id: readString(row.current_clone_id, "") || null,
  };
}

function safeAppInstance(row: AppInstanceRow) {
  const instanceType = readString(row.instance_type, "clone");
  const instanceIndex = readNumber(row.instance_index, 0);
  return {
    app_instance_id: readString(row.id, ""),
    device_id: readString(row.device_id, ""),
    instance_type: instanceType,
    instance_index: instanceIndex,
    label: readString(row.visible_label, instanceType === "primary_app" ? "Primary app" : `Clone ${instanceIndex}`),
    package_name: readString(row.package_name, ""),
    status: readString(row.status, "unknown"),
    current_account_id: readString(row.current_account_id, "") || null,
    usable_for_auto_login: readBoolean(row.usable_for_auto_login, false),
    is_launchable: readBoolean(row.is_launchable, false),
    selectable: readString(row.status, "unknown") === "available" &&
      readBoolean(row.usable_for_auto_login, false) &&
      readBoolean(row.is_launchable, false) &&
      !readString(row.current_account_id, ""),
  };
}

export function safePhoneDevice(row: SupabaseRecord, appInstances: AppInstanceRow[], heartbeat?: HeartbeatRow) {
  const instances = appInstances
    .filter((app) => readString(app.device_id, "") === readString(row.id, ""))
    .map(safeAppInstance)
    .sort((a, b) => a.instance_index - b.instance_index);
  const availableCount = instances.filter((app) => app.status === "available" && app.selectable).length;
  const occupiedCount = instances.filter((app) => app.status === "occupied" || app.current_account_id).length;
  return {
    id: readString(row.id, ""),
    device_name: readString(row.name, readString(row.device_name, "Unknown phone")),
    phone_name: readString(row.name, readString(row.device_name, "Unknown phone")),
    host_name: readString(row.host_machine, ""),
    platform: "android",
    device_kind: readString(row.device_kind, "physical_phone"),
    adb_serial: readString(row.adb_serial, ""),
    adb_serial_display: maskedAdbSerial(row.adb_serial),
    status: readString(row.status, "unknown"),
    pool_type: readString(row.pool_type, ""),
    max_clones: readNumber(row.max_clones, 0),
    timezone: readString(row.timezone, ""),
    app_instances: instances,
    app_instances_count: instances.length,
    app_instances_available_count: availableCount,
    app_instances_occupied_count: occupiedCount,
    phone_wide_availability: availableCount > 0 && readString(row.status, "unknown") === "available" ? "available" : "limited",
    next_window_label: "Next valid schedule slot selected on create",
    notes: "",
    ...heartbeatProjection(heartbeat),
  };
}

export async function GET() {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const supabase = createSupabaseClient();
    const [{ data: phones, error: phoneError }, { data: appInstances, error: appError }, { data: heartbeats }] = await Promise.all([
      supabase
        .from("phone_devices")
        .select("id,device_kind,name,device_name,adb_serial,host_machine,pool_type,max_clones,status,timezone,updated_at")
        .order("name", { ascending: true }),
      supabase
        .from("phone_app_instances")
        .select("id,device_id,instance_type,instance_index,visible_label,package_name,is_launchable,status,current_account_id,usable_for_auto_login,updated_at")
        .order("instance_index", { ascending: true }),
      supabase
        .from("device_heartbeats")
        .select("device_id,adb_serial,status,last_seen_at,current_account_id,current_clone_id")
        .order("last_seen_at", { ascending: false }),
    ]);

    if (phoneError || appError) {
      return jsonOk([localDevice]);
    }

    const heartbeatByDevice = new Map(
      ((heartbeats ?? []) as HeartbeatRow[]).map((row) => [readString(row.device_id, ""), row]),
    );
    const devices = ((phones ?? []) as SupabaseRecord[])
      .map((phone) => safePhoneDevice(phone, (appInstances ?? []) as AppInstanceRow[], heartbeatByDevice.get(readString(phone.id, ""))))
      .filter((phone) => phone.id);
    return jsonOk(devices.length ? devices : [localDevice]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load devices.";
    return jsonError(message, 500);
  }
}
