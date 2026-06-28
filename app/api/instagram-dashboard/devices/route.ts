import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, requireInstagramAdmin, type SupabaseRecord } from "../_utils";
import { compassRelayAuthFailureReason, relayAuthStatus, verifyCompassRelayKey } from "../compass/relay-auth";

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

type AssignmentRow = SupabaseRecord & {
  id?: unknown;
  account_id?: unknown;
  device_id?: unknown;
  app_instance_id?: unknown;
  status?: unknown;
  schedule_mode?: unknown;
  ig_accounts?: SupabaseRecord | SupabaseRecord[] | null;
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

function safeAssignment(row: AssignmentRow | undefined) {
  if (!row) return null;
  const accountValue = Array.isArray(row.ig_accounts) ? row.ig_accounts[0] : row.ig_accounts;
  const account = accountValue && typeof accountValue === "object" ? accountValue : {};
  return {
    assignment_id: readString(row.id, "") || null,
    account_id: readString(row.account_id, "") || null,
    username: readString(account.username, "") || null,
    status: readString(row.status, "unknown"),
    schedule_mode: readString(row.schedule_mode, "scheduled"),
  };
}

function safeAppInstance(row: AppInstanceRow, assignment?: AssignmentRow) {
  const instanceType = readString(row.instance_type, "clone");
  const instanceIndex = readNumber(row.instance_index, 0);
  const occupant = safeAssignment(assignment) ?? (
    readString(row.current_account_id, "")
      ? {
        assignment_id: null,
        account_id: readString(row.current_account_id, ""),
        username: null,
        status: "occupied",
      }
      : null
  );
  const availability = occupant
    ? "occupied"
    : readString(row.status, "unknown") !== "available"
      ? readString(row.status, "unknown")
      : readBoolean(row.usable_for_auto_login, false) && readBoolean(row.is_launchable, false)
        ? "available"
        : "disabled";
  return {
    app_instance_id: readString(row.id, ""),
    device_id: readString(row.device_id, ""),
    instance_type: instanceType,
    instance_index: instanceIndex,
    label: readString(row.visible_label, instanceType === "primary_app" ? "Primary app" : `Clone ${instanceIndex}`),
    package_name: readString(row.package_name, ""),
    status: readString(row.status, "unknown"),
    availability,
    current_account_id: occupant?.account_id || null,
    occupant,
    usable_for_auto_login: readBoolean(row.usable_for_auto_login, false),
    is_launchable: readBoolean(row.is_launchable, false),
    selectable: availability === "available" &&
      readString(row.status, "unknown") === "available" &&
      readBoolean(row.usable_for_auto_login, false) &&
      readBoolean(row.is_launchable, false) &&
      !occupant,
  };
}

export function safePhoneDevice(row: SupabaseRecord, appInstances: AppInstanceRow[], heartbeat?: HeartbeatRow, assignments: AssignmentRow[] = []) {
  const assignmentByAppInstance = new Map(
    assignments
      .filter((assignment) => readString(assignment.device_id, "") === readString(row.id, ""))
      .map((assignment) => [readString(assignment.app_instance_id, ""), assignment]),
  );
  const instances = appInstances
    .filter((app) => readString(app.device_id, "") === readString(row.id, ""))
    .map((app) => safeAppInstance(app, assignmentByAppInstance.get(readString(app.id, ""))))
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

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return jsonError("Devices relay authentication failed.", relayAuthStatus(compassRelayAuthFailureReason(relayAuth)), { reason: compassRelayAuthFailureReason(relayAuth) });
  }
  return requireInstagramAdmin();
}

export async function getDashboardDevices() {
  const supabase = createSupabaseClient();
  const [{ data: phones, error: phoneError }, { data: appInstances, error: appError }, { data: heartbeats }, { data: assignments }] = await Promise.all([
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
  ]);

  if (phoneError || appError) {
    return [localDevice];
  }

  const heartbeatByDevice = new Map(
    ((heartbeats ?? []) as HeartbeatRow[]).map((row) => [readString(row.device_id, ""), row]),
  );
  const devices = ((phones ?? []) as SupabaseRecord[])
    .map((phone) => safePhoneDevice(
      phone,
      (appInstances ?? []) as AppInstanceRow[],
      heartbeatByDevice.get(readString(phone.id, "")),
      (assignments ?? []) as unknown as AssignmentRow[],
    ))
    .filter((phone) => phone.id);
  return devices.length ? devices : [localDevice];
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    return jsonOk(await getDashboardDevices());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load devices.";
    return jsonError(message, 500);
  }
}
