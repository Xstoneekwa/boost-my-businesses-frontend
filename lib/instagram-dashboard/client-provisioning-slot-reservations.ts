import {
  CLIENT_PROVISIONING_SLOT_ACTIVE_STATUSES,
  CLIENT_PROVISIONING_SLOT_SCAN_STEP_MS,
} from "./client-provisioning-slot-constants.ts";
import {
  type ClientProvisioningSlotReservationRow,
} from "./client-provisioning-slot-presentation.ts";
import { findNextSafeProvisioningSlot } from "./provisioning-slot-scheduler.ts";

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
};

type Row = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function readRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}

export type { ClientProvisioningSlotReservationRow } from "./client-provisioning-slot-presentation.ts";
export { formatProvisioningSlotFranceTime } from "./client-provisioning-slot-presentation.ts";

export function mapReservationRow(row: Row | null | undefined): ClientProvisioningSlotReservationRow | null {
  if (!row) return null;
  const id = readString(row.id);
  if (!id) return null;
  const metadata = row.safe_metadata && typeof row.safe_metadata === "object" && !Array.isArray(row.safe_metadata)
    ? row.safe_metadata as Record<string, unknown>
    : {};
  return {
    id,
    client_id: readString(row.client_id),
    client_instagram_account_id: readString(row.client_instagram_account_id),
    ig_account_id: readString(row.ig_account_id),
    assignment_id: readString(row.assignment_id),
    device_id: readString(row.device_id),
    app_instance_id: readString(row.app_instance_id),
    expected_package: readString(row.expected_package),
    window_start_utc: readString(row.window_start_utc),
    window_end_utc: readString(row.window_end_utc),
    expires_at: readString(row.expires_at),
    status: readString(row.status, "reserved"),
    reservation_source: readString(row.reservation_source, "client_connect"),
    assisted_connect_requested_at: readString(row.assisted_connect_requested_at) || null,
    dedupe_key: readString(row.dedupe_key),
    safe_metadata: metadata,
    created_at: readString(row.created_at),
    updated_at: readString(row.updated_at),
  };
}

export function reservationDedupeKey(clientInstagramAccountId: string) {
  return `client_provisioning:${clientInstagramAccountId}`;
}

export function normalizeReservationStatusForNow(
  row: ClientProvisioningSlotReservationRow,
  now = new Date(),
): ClientProvisioningSlotReservationRow {
  const expiresMs = Date.parse(row.expires_at);
  if (Number.isFinite(expiresMs) && expiresMs <= now.getTime()) {
    return { ...row, status: "expired" };
  }
  const startMs = Date.parse(row.window_start_utc);
  if (
    row.status === "reserved"
    && Number.isFinite(startMs)
    && startMs <= now.getTime()
  ) {
    return { ...row, status: "window_open" };
  }
  return row;
}

export async function expireProvisioningSlotReservations(supabase: SupabaseLike, now = new Date()) {
  const { data, error } = await supabase.rpc("expire_client_provisioning_slot_reservations", {
    p_now: now.toISOString(),
  });
  if (error) throw new Error(error.message || "expire_provisioning_reservations_failed");
  return data;
}

export async function loadActiveProvisioningReservationForAccount(
  supabase: SupabaseLike,
  igAccountId: string,
  now = new Date(),
) {
  await expireProvisioningSlotReservations(supabase, now);
  const result = await (supabase.from("client_provisioning_slot_reservations") as {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        in: (col2: string, values: string[]) => {
          order: (col3: string, opts: { ascending: boolean }) => {
            limit: (n: number) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
          };
        };
      };
    };
  })
    .select("*")
    .eq("ig_account_id", igAccountId)
    .in("status", [...CLIENT_PROVISIONING_SLOT_ACTIVE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1);
  if (result.error) throw new Error(result.error.message || "provisioning_reservation_unavailable");
  const row = mapReservationRow(readRows(result.data)[0] ?? null);
  return row ? normalizeReservationStatusForNow(row, now) : null;
}

async function loadClientInstagramAccountContext(
  supabase: SupabaseLike,
  igAccountId: string,
  clientId: string,
) {
  const result = await (supabase.from("client_instagram_accounts") as {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        eq: (col2: string, value2: string) => {
          limit: (n: number) => {
            maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }>;
          };
        };
      };
    };
  })
    .select("id,client_id,account_id")
    .eq("account_id", igAccountId)
    .eq("client_id", clientId)
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "client_instagram_account_unavailable");
  const row = result.data as Row | null;
  if (!row?.id) return null;
  return {
    clientInstagramAccountId: readString(row.id),
    clientId: readString(row.client_id),
    igAccountId: readString(row.account_id),
  };
}

async function loadExpectedPackage(
  supabase: SupabaseLike,
  igAccountId: string,
  appInstanceId: string,
) {
  const [packageResult, appResult] = await Promise.all([
    (supabase.from("account_commercial_packages") as {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          limit: (n: number) => { maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }> };
        };
      };
    })
      .select("commercial_package_code")
      .eq("account_id", igAccountId)
      .limit(1)
      .maybeSingle(),
    (supabase.from("phone_app_instances") as {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          limit: (n: number) => { maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }> };
        };
      };
    })
      .select("package_name")
      .eq("id", appInstanceId)
      .limit(1)
      .maybeSingle(),
  ]);
  return readString((packageResult.data as Row | null)?.commercial_package_code)
    || readString((appResult.data as Row | null)?.package_name);
}

export type ReserveProvisioningSlotInput = {
  clientId: string;
  igAccountId: string;
  assignmentId: string;
  deviceId: string;
  appInstanceId: string;
  now?: Date;
};

export type ReserveProvisioningSlotResult =
  | { ok: true; reservation: ClientProvisioningSlotReservationRow; idempotent: boolean }
  | { ok: false; reason: string };

export async function reserveOrReturnProvisioningSlot(
  supabase: SupabaseLike,
  input: ReserveProvisioningSlotInput,
): Promise<ReserveProvisioningSlotResult> {
  const now = input.now ?? new Date();
  await expireProvisioningSlotReservations(supabase, now);

  const existing = await loadActiveProvisioningReservationForAccount(supabase, input.igAccountId, now);
  if (existing && CLIENT_PROVISIONING_SLOT_ACTIVE_STATUSES.includes(existing.status as typeof CLIENT_PROVISIONING_SLOT_ACTIVE_STATUSES[number])) {
    return { ok: true, reservation: existing, idempotent: true };
  }

  const clientContext = await loadClientInstagramAccountContext(supabase, input.igAccountId, input.clientId);
  if (!clientContext) {
    return { ok: false, reason: "client_instagram_account_not_found" };
  }

  const slotResult = await findNextSafeProvisioningSlot(supabase, {
    accountId: input.igAccountId,
    assignmentId: input.assignmentId,
    deviceId: input.deviceId,
    appInstanceId: input.appInstanceId,
    now,
  });
  if (!slotResult.ok) {
    return { ok: false, reason: slotResult.reason };
  }

  const expectedPackage = await loadExpectedPackage(supabase, input.igAccountId, input.appInstanceId);
  const maxAttempts = 24;
  let attempt = 0;
  let windowStart = slotResult.slot.windowStartUtc;

  while (attempt < maxAttempts) {
    const { data, error } = await supabase.rpc("reserve_client_provisioning_slot", {
      p_client_id: clientContext.clientId,
      p_client_instagram_account_id: clientContext.clientInstagramAccountId,
      p_ig_account_id: input.igAccountId,
      p_assignment_id: input.assignmentId,
      p_device_id: input.deviceId,
      p_app_instance_id: input.appInstanceId,
      p_expected_package: expectedPackage,
      p_window_start_utc: windowStart,
      p_reservation_source: "client_connect",
      p_dedupe_key: reservationDedupeKey(clientContext.clientInstagramAccountId),
      p_safe_metadata: { source: "cp6_client_connect" },
    });

    if (!error) {
      const reservation = mapReservationRow(data as Row);
      if (!reservation) return { ok: false, reason: "provisioning_reservation_create_failed" };
      return { ok: true, reservation: normalizeReservationStatusForNow(reservation, now), idempotent: false };
    }

    const message = readString(error.message).toLowerCase();
    if (message.includes("provisioning_slot_device_overlap")) {
      const retrySlot = await findNextSafeProvisioningSlot(supabase, {
        accountId: input.igAccountId,
        assignmentId: input.assignmentId,
        deviceId: input.deviceId,
        appInstanceId: input.appInstanceId,
        now: new Date(Date.parse(windowStart) + CLIENT_PROVISIONING_SLOT_SCAN_STEP_MS),
      });
      if (!retrySlot.ok) return { ok: false, reason: retrySlot.reason };
      windowStart = retrySlot.slot.windowStartUtc;
      attempt += 1;
      continue;
    }

    if (message.includes("duplicate") || message.includes("unique")) {
      const raced = await loadActiveProvisioningReservationForAccount(supabase, input.igAccountId, now);
      if (raced) return { ok: true, reservation: raced, idempotent: true };
    }

    return { ok: false, reason: "provisioning_reservation_create_failed" };
  }

  return { ok: false, reason: "provisioning_slot_device_overlap_exhausted" };
}

export function isProvisioningWindowOpen(
  reservation: ClientProvisioningSlotReservationRow,
  now = new Date(),
) {
  const normalized = normalizeReservationStatusForNow(reservation, now);
  if (normalized.status === "expired") return false;
  const startMs = Date.parse(normalized.window_start_utc);
  const endMs = Date.parse(normalized.window_end_utc);
  const nowMs = now.getTime();
  return Number.isFinite(startMs) && Number.isFinite(endMs) && nowMs >= startMs && nowMs < endMs;
}

export function isProvisioningWindowBeforeStart(
  reservation: ClientProvisioningSlotReservationRow,
  now = new Date(),
) {
  const startMs = Date.parse(reservation.window_start_utc);
  return Number.isFinite(startMs) && now.getTime() < startMs;
}

export async function consumeProvisioningReservation(
  supabase: SupabaseLike,
  reservationId: string,
  igAccountId: string,
) {
  const { data, error } = await supabase.rpc("consume_client_provisioning_slot_reservation", {
    p_reservation_id: reservationId,
    p_ig_account_id: igAccountId,
  });
  if (error) throw new Error(error.message || "consume_provisioning_reservation_failed");
  return mapReservationRow(data as Row);
}

export async function markProvisioningAssistedRequested(
  supabase: SupabaseLike,
  reservationId: string,
  igAccountId: string,
) {
  const { data, error } = await supabase.rpc("mark_client_provisioning_assisted_requested", {
    p_reservation_id: reservationId,
    p_ig_account_id: igAccountId,
  });
  if (error) throw new Error(error.message || "mark_provisioning_assisted_failed");
  return mapReservationRow(data as Row);
}

export async function loadProvisioningReservationById(
  supabase: SupabaseLike,
  reservationId: string,
) {
  const result = await (supabase.from("client_provisioning_slot_reservations") as {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        limit: (n: number) => { maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }> };
      };
    };
  })
    .select("*")
    .eq("id", reservationId)
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "provisioning_reservation_unavailable");
  return mapReservationRow(result.data as Row | null);
}
