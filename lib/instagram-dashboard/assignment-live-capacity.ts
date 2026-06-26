import { readString, type SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";
import {
  assignmentWindowContainsNow,
  readScheduleSlot,
  type ScheduleSlotProjection,
} from "@/lib/instagram-dashboard/schedule";
import type { createSupabaseClient } from "@/lib/supabase";

type SupabaseClient = ReturnType<typeof createSupabaseClient>;

export const ASSIGNMENT_HEARTBEAT_STALE_MS = 15 * 60 * 1000;

export type AssignmentDeviceKindPolicy = "physical_phone_only" | "any_eligible";

/** Onboarding reserves device+clone outside the active window; run gates enforce the window later. */
export type AssignmentReservationMode = "onboarding" | "immediate";

const PHYSICAL_PHONE_DEVICE_KIND = "physical_phone";
const EMULATOR_DEVICE_KIND = "emulator";

const DISALLOWED_DEVICE_STATUSES = new Set([
  "disabled",
  "maintenance",
  "offline",
  "unavailable",
  "resting",
  "cooldown",
  "retired",
  "archived",
]);

export type LiveAssignmentTarget = {
  deviceId: string;
  startsAt: string;
  endsAt: string;
  appInstanceId: string | null;
};

export type LiveAssignmentResolution =
  | { ok: true; target: LiveAssignmentTarget; reason: string }
  | { ok: false; reason: string };

type HeartbeatRow = {
  device_id?: unknown;
  status?: unknown;
  last_seen_at?: unknown;
};

type AppInstanceRow = {
  id?: unknown;
  device_id?: unknown;
  status?: unknown;
  current_account_id?: unknown;
  usable_for_auto_login?: unknown;
  is_launchable?: unknown;
};

function readRpcObject(value: unknown): SupabaseRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as SupabaseRecord;
  }
  return {};
}

function readAppInstanceSummary(value: unknown) {
  const summary = readRpcObject(value);
  return {
    available: Number(summary.available ?? 0),
    total: Number(summary.total ?? 0),
  };
}

type DeviceRow = {
  id?: unknown;
  status?: unknown;
  pool_type?: unknown;
  timezone?: unknown;
  device_kind?: unknown;
};

export function normalizeDeviceKind(value: unknown) {
  return readString(value, "").toLowerCase();
}

/** Canonical inventory discriminator: phone_devices.device_kind */
export function isPhysicalPhoneDevice(device: Pick<DeviceRow, "device_kind"> | null | undefined) {
  return normalizeDeviceKind(device?.device_kind) === PHYSICAL_PHONE_DEVICE_KIND;
}

export function isEmulatorDevice(device: Pick<DeviceRow, "device_kind"> | null | undefined) {
  return normalizeDeviceKind(device?.device_kind) === EMULATOR_DEVICE_KIND;
}

export function isAutoAssignmentDeviceKindEligible(
  device: Pick<DeviceRow, "device_kind"> | null | undefined,
  policy: AssignmentDeviceKindPolicy = "physical_phone_only",
) {
  const kind = normalizeDeviceKind(device?.device_kind);
  if (policy === "physical_phone_only") {
    return kind === PHYSICAL_PHONE_DEVICE_KIND;
  }
  return kind === PHYSICAL_PHONE_DEVICE_KIND || kind === EMULATOR_DEVICE_KIND;
}

export function isAssignmentHeartbeatLive(
  heartbeat: HeartbeatRow | null | undefined,
  now = new Date(),
) {
  if (!heartbeat) return false;
  const status = readString(heartbeat.status, "").toLowerCase();
  if (status !== "online") return false;
  const lastSeenAt = readString(heartbeat.last_seen_at, "");
  if (!lastSeenAt) return false;
  const lastSeenMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) return false;
  return now.getTime() - lastSeenMs <= ASSIGNMENT_HEARTBEAT_STALE_MS;
}

export function isDeviceInventoryEligible(status: string) {
  const normalized = readString(status, "").toLowerCase();
  if (!normalized || DISALLOWED_DEVICE_STATUSES.has(normalized)) return false;
  return normalized === "available" || normalized === "active" || normalized === "online";
}

export function isAppInstanceEligibleForNewAssignment(instance: AppInstanceRow) {
  return (
    readString(instance.status, "").toLowerCase() === "available"
    && instance.usable_for_auto_login === true
    && instance.is_launchable === true
    && !readString(instance.current_account_id, "")
  );
}

export function chooseLiveAssignmentSlot(
  slots: ScheduleSlotProjection[],
  options: { requireCurrentWindow?: boolean; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const available = slots.filter((slot) => slot.available === true);
  if (options.requireCurrentWindow) {
    return available.find((slot) => assignmentWindowContainsNow(slot.starts_at, slot.ends_at, now)) ?? null;
  }
  return available[0] ?? null;
}

async function resolveAssignmentType(supabase: SupabaseClient, accountId: string) {
  const { data: subscriptionAccount, error } = await supabase
    .from("client_subscription_accounts")
    .select("subscription_id")
    .eq("account_id", accountId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  if (error || !subscriptionAccount) return null;

  const { data: subscription } = await supabase
    .from("client_subscriptions")
    .select("subscription_type,status")
    .eq("id", readString(subscriptionAccount.subscription_id, ""))
    .eq("status", "active")
    .maybeSingle<SupabaseRecord>();
  const assignmentType = readString(subscription?.subscription_type, "");
  return assignmentType || null;
}

async function loadOpenAssignment(supabase: SupabaseClient, accountId: string) {
  const { data } = await supabase
    .from("account_assignments")
    .select("id,device_id,app_instance_id,starts_at,ends_at,status")
    .eq("account_id", accountId)
    .in("status", ["pending", "reserved", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  return data;
}

async function loadCandidateDevices(
  supabase: SupabaseClient,
  assignmentType: string,
  options: { explicitDeviceId?: string; deviceKindPolicy?: AssignmentDeviceKindPolicy },
) {
  const deviceKindPolicy = options.deviceKindPolicy ?? "physical_phone_only";
  const deviceSelect = "id,status,pool_type,timezone,device_kind";

  if (options.explicitDeviceId) {
    const { data, error } = await supabase
      .from("phone_devices")
      .select(deviceSelect)
      .eq("id", options.explicitDeviceId)
      .limit(1)
      .maybeSingle<SupabaseRecord>();
    if (error || !data) return [];
    return [data];
  }

  let query = supabase
    .from("phone_devices")
    .select(deviceSelect)
    .in("status", ["available", "active", "online"])
    .or(`pool_type.eq.${assignmentType},pool_type.eq.shared`)
    .order("created_at", { ascending: true });
  if (deviceKindPolicy === "physical_phone_only") {
    query = query.eq("device_kind", PHYSICAL_PHONE_DEVICE_KIND);
  }
  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];
  return data as SupabaseRecord[];
}

async function loadHeartbeatMap(supabase: SupabaseClient, deviceIds: string[]) {
  if (!deviceIds.length) return new Map<string, HeartbeatRow>();
  const { data } = await supabase
    .from("device_heartbeats")
    .select("device_id,status,last_seen_at")
    .in("device_id", deviceIds)
    .order("last_seen_at", { ascending: false });
  const map = new Map<string, HeartbeatRow>();
  for (const row of Array.isArray(data) ? data : []) {
    const deviceId = readString((row as HeartbeatRow).device_id, "");
    if (!deviceId || map.has(deviceId)) continue;
    map.set(deviceId, row as HeartbeatRow);
  }
  return map;
}

async function loadAppInstancesForDevice(supabase: SupabaseClient, deviceId: string) {
  const { data, error } = await supabase
    .from("phone_app_instances")
    .select("id,device_id,status,current_account_id,usable_for_auto_login,is_launchable,instance_index")
    .eq("device_id", deviceId)
    .order("instance_index", { ascending: true });
  if (error || !Array.isArray(data)) return [];
  return data as AppInstanceRow[];
}

function deviceMatchesAssignmentPool(device: SupabaseRecord, assignmentType: string) {
  const poolType = readString(device.pool_type, "");
  return poolType === "shared" || poolType === assignmentType;
}

function pickPreferredAppInstance(
  instances: AppInstanceRow[],
  preferredAppInstanceId?: string,
) {
  if (preferredAppInstanceId) {
    const preferred = instances.find((row) => readString(row.id, "") === preferredAppInstanceId);
    if (preferred && isAppInstanceEligibleForNewAssignment(preferred)) {
      return readString(preferred.id, "") || null;
    }
    return null;
  }
  const eligible = instances.find((row) => isAppInstanceEligibleForNewAssignment(row));
  return eligible ? readString(eligible.id, "") || null : null;
}

async function resolveSlotForDevice(
  supabase: SupabaseClient,
  accountId: string,
  deviceId: string,
  options: { requireCurrentWindow?: boolean; now?: Date },
) {
  const { data, error } = await supabase.rpc("list_available_assignment_slots", {
    p_account_id: accountId,
    p_device_id: deviceId,
  });
  if (error) return null;

  const payload = readRpcObject(data);
  const slots = Array.isArray(payload.slots)
    ? payload.slots.map((row) => readScheduleSlot(row as SupabaseRecord))
    : [];
  const slot = chooseLiveAssignmentSlot(slots, options);
  if (!slot) return null;

  const summary = readAppInstanceSummary(payload.app_instance_availability);
  if (summary.available < 1) return null;

  return {
    deviceId: readString(payload.device_id, deviceId),
    startsAt: slot.starts_at,
    endsAt: slot.ends_at,
    timezone: readString(payload.device_timezone, ""),
  };
}

export async function isAssignmentOnPhysicalPhone(
  supabase: SupabaseClient,
  assignment: { device_id?: unknown } | null | undefined,
) {
  const deviceId = readString(assignment?.device_id, "");
  if (!deviceId) return false;
  const { data } = await supabase
    .from("phone_devices")
    .select("device_kind")
    .eq("id", deviceId)
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  return isPhysicalPhoneDevice(data);
}

/**
 * Canonical live assignment capacity resolver shared by onboarding, assign-now and readiness.
 */
function resolveRequireCurrentWindow(options: {
  reservationMode?: AssignmentReservationMode;
  requireCurrentWindow?: boolean;
}) {
  if (options.reservationMode === "onboarding") return false;
  return options.requireCurrentWindow === true;
}

export async function resolveLiveAssignmentTarget(
  supabase: SupabaseClient,
  accountId: string,
  options: {
    explicitDeviceId?: string;
    explicitAppInstanceId?: string;
    explicitStartsAt?: string;
    explicitEndsAt?: string;
    requireCurrentWindow?: boolean;
    requireScheduleSlot?: boolean;
    reservationMode?: AssignmentReservationMode;
    deviceKindPolicy?: AssignmentDeviceKindPolicy;
    now?: Date;
    skipIfAssigned?: boolean;
  } = {},
): Promise<LiveAssignmentResolution> {
  const now = options.now ?? new Date();
  const deviceKindPolicy = options.deviceKindPolicy ?? "physical_phone_only";
  const requireCurrentWindow = resolveRequireCurrentWindow(options);

  if (options.skipIfAssigned !== false) {
    const existing = await loadOpenAssignment(supabase, accountId);
    if (existing?.id) {
      if (deviceKindPolicy === "physical_phone_only") {
        const onPhysicalPhone = await isAssignmentOnPhysicalPhone(supabase, existing);
        if (!onPhysicalPhone) {
          // Emulator or ineligible assignments must not block onboarding physical reservation.
        } else {
          return { ok: false, reason: "already_assigned" };
        }
      } else {
        return { ok: false, reason: "already_assigned" };
      }
    }
  }

  const assignmentType = await resolveAssignmentType(supabase, accountId);
  if (!assignmentType) {
    return { ok: false, reason: "subscription_account_missing" };
  }

  const explicitDeviceId = readString(options.explicitDeviceId, "");
  const explicitAppInstanceId = readString(options.explicitAppInstanceId, "");
  const explicitStartsAt = readString(options.explicitStartsAt, "");
  const explicitEndsAt = readString(options.explicitEndsAt, "");
  const requireScheduleSlot = options.requireScheduleSlot !== false;

  if (explicitDeviceId && (!requireScheduleSlot || (explicitStartsAt && explicitEndsAt))) {
    const { data: device, error: deviceError } = await supabase
      .from("phone_devices")
      .select("id,status,pool_type,timezone,device_kind")
      .eq("id", explicitDeviceId)
      .limit(1)
      .maybeSingle<SupabaseRecord>();
    if (deviceError || !device) return { ok: false, reason: "device_unavailable" };
    if (!isAutoAssignmentDeviceKindEligible(device, deviceKindPolicy)) {
      return { ok: false, reason: deviceKindPolicy === "physical_phone_only" ? "physical_phone_unavailable" : "device_unavailable" };
    }
    if (!isDeviceInventoryEligible(readString(device.status, ""))) {
      return { ok: false, reason: "device_unavailable" };
    }
    if (!deviceMatchesAssignmentPool(device, assignmentType)) {
      return { ok: false, reason: "outside_policy" };
    }

    const heartbeatMap = await loadHeartbeatMap(supabase, [explicitDeviceId]);
    if (!isAssignmentHeartbeatLive(heartbeatMap.get(explicitDeviceId), now)) {
      return { ok: false, reason: "live_device_unavailable" };
    }

    const instances = await loadAppInstancesForDevice(supabase, explicitDeviceId);
    const appInstanceId = pickPreferredAppInstance(instances, explicitAppInstanceId || undefined);
    if (!appInstanceId) {
      return { ok: false, reason: "no_available_clone" };
    }

    return {
      ok: true,
      reason: requireScheduleSlot ? "explicit_live_target" : "explicit_live_manual_target",
      target: {
        deviceId: explicitDeviceId,
        startsAt: explicitStartsAt,
        endsAt: explicitEndsAt,
        appInstanceId,
      },
    };
  }

  const devices = await loadCandidateDevices(supabase, assignmentType, {
    explicitDeviceId: explicitDeviceId || undefined,
    deviceKindPolicy,
  });
  const eligibleDevices = devices.filter((device) => {
    if (!isAutoAssignmentDeviceKindEligible(device, deviceKindPolicy)) return false;
    if (!isDeviceInventoryEligible(readString(device.status, ""))) return false;
    if (!readString(device.timezone, "")) return false;
    return deviceMatchesAssignmentPool(device, assignmentType);
  });
  if (!eligibleDevices.length) {
    return {
      ok: false,
      reason: deviceKindPolicy === "physical_phone_only" ? "physical_phone_unavailable" : "device_unavailable",
    };
  }

  const heartbeatMap = await loadHeartbeatMap(
    supabase,
    eligibleDevices.map((device) => readString(device.id, "")).filter(Boolean),
  );

  for (const device of eligibleDevices) {
    const deviceId = readString(device.id, "");
    if (!deviceId) continue;
    if (!isAssignmentHeartbeatLive(heartbeatMap.get(deviceId), now)) continue;

    const instances = await loadAppInstancesForDevice(supabase, deviceId);
    const appInstanceId = pickPreferredAppInstance(instances, explicitAppInstanceId || undefined);
    if (!appInstanceId) continue;

    const slot = await resolveSlotForDevice(supabase, accountId, deviceId, {
      requireCurrentWindow,
      now,
    });
    if (!slot?.startsAt || !slot.endsAt) continue;

    return {
      ok: true,
      reason: "live_capacity_selected",
      target: {
        deviceId: slot.deviceId || deviceId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        appInstanceId,
      },
    };
  }

  const anyLiveDevice = eligibleDevices.some((device) => {
    const deviceId = readString(device.id, "");
    return deviceId && isAssignmentHeartbeatLive(heartbeatMap.get(deviceId), now);
  });
  if (!anyLiveDevice) {
    return { ok: false, reason: "live_device_unavailable" };
  }

  return { ok: false, reason: "no_available_slot" };
}

export async function hasLiveAssignmentCapacity(
  supabase: SupabaseClient,
  accountId: string,
  options: { requireCurrentWindow?: boolean; now?: Date; deviceKindPolicy?: AssignmentDeviceKindPolicy } = {},
) {
  const existing = await loadOpenAssignment(supabase, accountId);
  if (existing?.id) {
    const policy = options.deviceKindPolicy ?? "physical_phone_only";
    if (policy === "physical_phone_only") {
      const onPhysicalPhone = await isAssignmentOnPhysicalPhone(supabase, existing);
      if (!onPhysicalPhone) return false;
    }
    return true;
  }

  const resolution = await resolveLiveAssignmentTarget(supabase, accountId, {
    ...options,
    skipIfAssigned: false,
    deviceKindPolicy: options.deviceKindPolicy ?? "physical_phone_only",
  });
  return resolution.ok;
}
