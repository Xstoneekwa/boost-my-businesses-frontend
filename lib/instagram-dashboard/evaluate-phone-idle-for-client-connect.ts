import {
  ASSIGNMENT_HEARTBEAT_STALE_MS,
  isPhysicalPhoneDevice,
} from "./assignment-live-capacity.ts";
import {
  CLIENT_PROVISIONING_SLOT_WINDOW_MS,
} from "./client-provisioning-slot-constants.ts";
import {
  deriveSessionTransitionTimestamps,
  isBusinessActionsAllowed,
  isWithinPreflightWindow,
  isSessionOpen,
} from "./session-transition-buffer.ts";
import {
  getActiveDeviceSessionLock,
} from "./device-session-lock.ts";
import {
  getActiveOperatorStopSuppression,
} from "./operator-stop-suppression.ts";

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
};

type Row = Record<string, unknown>;

const ACTIVE_REQUEST_STATUSES = ["queued", "claimed", "starting", "running"] as const;
const ACTIVE_RUN_STATUSES = ["queued", "starting", "running", "stopping"] as const;
const ACTIVE_PREFLIGHT_STATUSES = ["preflight_due", "preflight_running", "preflight_ready"] as const;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function readRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}

function firstRow(value: unknown) {
  return readRows(value)[0] ?? null;
}

export type PhoneIdleEvaluation = {
  idle: boolean;
  reason: string;
  blockers: string[];
};

export type PhoneIdleEvaluationInput = {
  accountId: string;
  assignmentId: string;
  deviceId: string;
  appInstanceId: string;
  now?: Date;
  /** When validating a future reservation window, pass the full interval. */
  windowStart?: string | null;
  windowEnd?: string | null;
};

async function query(supabase: SupabaseLike, table: string) {
  return supabase.from(table) as {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        in?: (col: string, values: string[]) => unknown;
        limit: (n: number) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
        maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }>;
      };
      in: (col: string, values: string[]) => {
        limit: (n: number) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
      };
      gt: (col: string, value: string) => {
        lt: (col: string, value: string) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
      };
    };
  };
}

async function loadPhoneAndApp(supabase: SupabaseLike, deviceId: string, appInstanceId: string) {
  const [phoneResult, appResult] = await Promise.all([
    (await query(supabase, "phone_devices")).select("id,status,device_kind,last_seen_at").eq("id", deviceId).limit(1),
    (await query(supabase, "phone_app_instances")).select("id,device_id,status,usable_for_auto_login,is_launchable").eq("id", appInstanceId).limit(1),
  ]);
  if (phoneResult.error) throw new Error(phoneResult.error.message || "phone_unavailable");
  if (appResult.error) throw new Error(appResult.error.message || "app_instance_unavailable");
  return { phone: firstRow(phoneResult.data), app: firstRow(appResult.data) };
}

async function listPeerAccountIds(supabase: SupabaseLike, input: PhoneIdleEvaluationInput) {
  const result = await (supabase.from("account_assignments") as {
    select: (cols: string) => {
      in: (col: string, values: string[]) => { limit: (n: number) => Promise<{ data?: unknown; error?: { message?: string } | null }> };
    };
  })
    .select("account_id,device_id,app_instance_id,status")
    .in("status", ["reserved", "active"])
    .limit(500);
  if (result.error) throw new Error(result.error.message || "peer_assignments_unavailable");
  return [...new Set(readRows(result.data)
    .filter((row) => readString(row.account_id) !== input.accountId)
    .filter((row) => readString(row.device_id) === input.deviceId || readString(row.app_instance_id) === input.appInstanceId)
    .map((row) => readString(row.account_id))
    .filter(Boolean))];
}

async function listActiveRequestsForAccounts(supabase: SupabaseLike, accountIds: string[]) {
  if (!accountIds.length) return [];
  const result = await (supabase.from("account_run_requests") as {
    select: (cols: string) => {
      in: (col: string, values: string[]) => { in: (col2: string, values2: string[]) => { limit: (n: number) => Promise<{ data?: unknown; error?: { message?: string } | null }> } };
    };
  })
    .select("id,account_id,status,requested_run_type")
    .in("account_id", accountIds)
    .in("status", [...ACTIVE_REQUEST_STATUSES])
    .limit(accountIds.length * 5);
  if (result.error) throw new Error(result.error.message || "active_requests_unavailable");
  return readRows(result.data);
}

async function listActiveRunsForAccounts(supabase: SupabaseLike, accountIds: string[]) {
  if (!accountIds.length) return [];
  const result = await (supabase.from("ig_runs") as {
    select: (cols: string) => {
      in: (col: string, values: string[]) => { in: (col2: string, values2: string[]) => { limit: (n: number) => Promise<{ data?: unknown; error?: { message?: string } | null }> } };
    };
  })
    .select("account_id,status")
    .in("account_id", accountIds)
    .in("status", [...ACTIVE_RUN_STATUSES])
    .limit(accountIds.length * 5);
  if (result.error) throw new Error(result.error.message || "active_runs_unavailable");
  return readRows(result.data);
}

async function listDeviceAssignments(supabase: SupabaseLike, deviceId: string) {
  const result = await (supabase.from("account_assignments") as {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        in: (col2: string, values: string[]) => { limit: (n: number) => Promise<{ data?: unknown; error?: { message?: string } | null }> };
      };
    };
  })
    .select("account_id,starts_at,ends_at,status")
    .eq("device_id", deviceId)
    .in("status", ["reserved", "active"])
    .limit(100);
  if (result.error) throw new Error(result.error.message || "device_assignments_unavailable");
  return readRows(result.data);
}

async function listDevicePreflights(supabase: SupabaseLike, deviceId: string) {
  const result = await (supabase.from("scheduled_session_preflights") as {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        in: (col2: string, values: string[]) => { limit: (n: number) => Promise<{ data?: unknown; error?: { message?: string } | null }> };
      };
    };
  })
    .select("account_id,status,scheduled_session_start,scheduled_session_end")
    .eq("device_id", deviceId)
    .in("status", [...ACTIVE_PREFLIGHT_STATUSES])
    .limit(50);
  if (result.error) return [];
  return readRows(result.data);
}

function intervalOverlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

function schedulerWindowBlocks(
  now: Date,
  startsAt: string,
  endsAt: string,
  windowStartMs: number,
  windowEndMs: number,
) {
  const timestamps = deriveSessionTransitionTimestamps(startsAt, endsAt);
  if (!timestamps) return false;
  const preflightStart = Date.parse(timestamps.preflight_start);
  const sessionEnd = Date.parse(timestamps.session_end);
  if (!Number.isFinite(preflightStart) || !Number.isFinite(sessionEnd)) return false;
  return intervalOverlaps(windowStartMs, windowEndMs, preflightStart, sessionEnd);
}

function intervalBlocksAtInstant(
  instant: Date,
  startsAt: string,
  endsAt: string,
) {
  const timestamps = deriveSessionTransitionTimestamps(startsAt, endsAt);
  if (!timestamps) return false;
  if (isWithinPreflightWindow(instant, timestamps)) return true;
  if (isSessionOpen(instant, timestamps)) return true;
  if (!isBusinessActionsAllowed(instant, timestamps)) return true;
  return false;
}

async function listActiveReservationsOnDevice(
  supabase: SupabaseLike,
  deviceId: string,
  excludeReservationId?: string | null,
) {
  const result = await (supabase.from("client_provisioning_slot_reservations") as {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        in: (col2: string, values: string[]) => { limit: (n: number) => Promise<{ data?: unknown; error?: { message?: string } | null }> };
      };
    };
  })
    .select("id,window_start_utc,window_end_utc,status")
    .eq("device_id", deviceId)
    .in("status", ["reserved", "window_open", "assisted_requested"])
    .limit(50);
  if (result.error) return [];
  return readRows(result.data).filter((row) => !excludeReservationId || readString(row.id) !== excludeReservationId);
}

export async function evaluatePhoneIdleForClientConnect(
  supabase: SupabaseLike,
  input: PhoneIdleEvaluationInput,
): Promise<PhoneIdleEvaluation> {
  const now = input.now ?? new Date();
  const blockers: string[] = [];
  const windowStartMs = input.windowStart ? Date.parse(input.windowStart) : now.getTime();
  const windowEndMs = input.windowEnd
    ? Date.parse(input.windowEnd)
    : windowStartMs + CLIENT_PROVISIONING_SLOT_WINDOW_MS;

  const { phone, app } = await loadPhoneAndApp(supabase, input.deviceId, input.appInstanceId);
  if (!phone || !app) {
    return { idle: false, reason: "phone_or_app_unavailable", blockers: ["phone_or_app_unavailable"] };
  }

  const phoneStatus = readString(phone.status).toLowerCase();
  if (!["available", "active", "online"].includes(phoneStatus)) {
    blockers.push("phone_unavailable");
  }
  if (!isPhysicalPhoneDevice(phone)) {
    blockers.push("not_physical_phone");
  }
  const lastSeenAt = Date.parse(readString(phone.last_seen_at));
  if (!Number.isFinite(lastSeenAt) || now.getTime() - lastSeenAt > ASSIGNMENT_HEARTBEAT_STALE_MS) {
    blockers.push("stale_device_heartbeat");
  }

  const appStatus = readString(app.status).toLowerCase();
  if (!["available", "occupied"].includes(appStatus) || app.usable_for_auto_login !== true || app.is_launchable !== true) {
    blockers.push("app_instance_unavailable");
  }

  const lock = await getActiveDeviceSessionLock(supabase, input.deviceId);
  if (lock) {
    blockers.push("device_lease_unavailable");
  }

  const peerAccountIds = await listPeerAccountIds(supabase, input);
  const activeAccountIds = [input.accountId, ...peerAccountIds];
  const [activeRequests, activeRuns] = await Promise.all([
    listActiveRequestsForAccounts(supabase, activeAccountIds),
    listActiveRunsForAccounts(supabase, activeAccountIds),
  ]);
  if (activeRequests.some((row) => peerAccountIds.includes(readString(row.account_id)))) {
    blockers.push("skipped_phone_busy");
  }
  if (activeRuns.some((row) => peerAccountIds.includes(readString(row.account_id)))) {
    blockers.push("skipped_phone_busy");
  }
  if (activeRequests.some((row) => readString(row.account_id) === input.accountId)) {
    blockers.push("account_busy");
  }
  if (activeRuns.some((row) => readString(row.account_id) === input.accountId)) {
    blockers.push("account_busy");
  }

  const suppression = await getActiveOperatorStopSuppression(supabase as never, input.accountId, now);
  if (suppression) {
    blockers.push("stop_cleanup_in_progress");
  }

  const deviceAssignments = await listDeviceAssignments(supabase, input.deviceId);
  for (const assignment of deviceAssignments) {
    const startsAt = readString(assignment.starts_at);
    const endsAt = readString(assignment.ends_at);
    if (!startsAt || !endsAt) continue;
    if (schedulerWindowBlocks(now, startsAt, endsAt, windowStartMs, windowEndMs)) {
      blockers.push("scheduler_window_conflict");
    }
    if (!input.windowStart) {
      const instant = now;
      if (intervalBlocksAtInstant(instant, startsAt, endsAt)) {
        blockers.push("scheduler_session_active");
      }
    }
  }

  const preflights = await listDevicePreflights(supabase, input.deviceId);
  for (const preflight of preflights) {
    const start = Date.parse(readString(preflight.scheduled_session_start));
    const end = Date.parse(readString(preflight.scheduled_session_end));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const timestamps = deriveSessionTransitionTimestamps(
      readString(preflight.scheduled_session_start),
      readString(preflight.scheduled_session_end),
    );
    if (!timestamps) continue;
    const blockStart = Date.parse(timestamps.preflight_start);
    const blockEnd = Date.parse(timestamps.session_end);
    if (intervalOverlaps(windowStartMs, windowEndMs, blockStart, blockEnd)) {
      blockers.push("preflight_window_conflict");
    }
  }

  const reservations = await listActiveReservationsOnDevice(supabase, input.deviceId);
  for (const reservation of reservations) {
    const start = Date.parse(readString(reservation.window_start_utc));
    const end = Date.parse(readString(reservation.window_end_utc));
    if (intervalOverlaps(windowStartMs, windowEndMs, start, end)) {
      blockers.push("provisioning_reservation_conflict");
    }
  }

  if (blockers.length) {
    const reason = blockers.includes("skipped_phone_busy")
      ? "skipped_phone_busy"
      : blockers[0];
    return { idle: false, reason, blockers };
  }

  return { idle: true, reason: "phone_idle", blockers: [] };
}

/** True when all physical phones in inventory are busy right now for client connect. */
export async function areAllPhysicalPhonesBusyForClientConnect(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    assignmentId: string;
    deviceId: string;
    appInstanceId: string;
    now?: Date;
  },
): Promise<boolean> {
  const evaluation = await evaluatePhoneIdleForClientConnect(supabase, input);
  return !evaluation.idle;
}
