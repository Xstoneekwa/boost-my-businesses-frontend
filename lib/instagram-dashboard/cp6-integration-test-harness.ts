import { randomUUID } from "node:crypto";
import {
  CLIENT_PROVISIONING_SLOT_ACTIVE_STATUSES,
  CLIENT_PROVISIONING_SLOT_WINDOW_MS,
} from "./client-provisioning-slot-constants.ts";

export type Row = Record<string, unknown>;
export type TableFixtures = Record<string, Row[]>;

export const CP6_TEST_IDS = {
  clientId: "55555555-5555-5555-5555-555555555555",
  accountA: "11111111-1111-1111-1111-111111111111",
  accountB: "22222222-2222-2222-2222-222222222222",
  clientInstagramA: "33333333-3333-3333-3333-333333333333",
  clientInstagramB: "44444444-4444-4444-4444-444444444444",
  assignmentA: "66666666-6666-6666-6666-666666666666",
  assignmentB: "77777777-7777-7777-7777-777777777777",
  deviceA: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  deviceB: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  appX: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  appY: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  packageX: "com.instagram.android.clonex",
} as const;

const ACTIVE_RESERVATION_STATUSES = new Set(CLIENT_PROVISIONING_SLOT_ACTIVE_STATUSES);

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

/** Mirrors PostgreSQL tstzrange [start, end) overlap used by the GIST exclusion constraint. */
export function tstzRangeHalfOpenOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
) {
  const a0 = Date.parse(startA);
  const a1 = Date.parse(endA);
  const b0 = Date.parse(startB);
  const b1 = Date.parse(endB);
  if (![a0, a1, b0, b1].every(Number.isFinite)) return false;
  return a0 < b1 && b0 < a1;
}

export type InMemoryReservationRow = {
  id: string;
  created_at: string;
  updated_at: string;
  client_id: string;
  client_instagram_account_id: string;
  ig_account_id: string;
  assignment_id: string;
  device_id: string;
  app_instance_id: string;
  expected_package: string;
  window_start_utc: string;
  window_end_utc: string;
  expires_at: string;
  status: string;
  reservation_source: string;
  assisted_connect_requested_at: string | null;
  dedupe_key: string;
  safe_metadata: Record<string, unknown>;
};

export function createInMemoryProvisioningReservationStore(now = new Date()) {
  const rows: InMemoryReservationRow[] = [];

  function findActiveForClientInstagramAccount(clientInstagramAccountId: string) {
    return rows
      .filter((row) => row.client_instagram_account_id === clientInstagramAccountId)
      .filter((row) => ACTIVE_RESERVATION_STATUSES.has(row.status as typeof CLIENT_PROVISIONING_SLOT_ACTIVE_STATUSES[number]))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null;
  }

  function hasDeviceOverlap(deviceId: string, windowStart: string, windowEnd: string, excludeId?: string) {
    return rows.some((row) => {
      if (excludeId && row.id === excludeId) return false;
      if (!ACTIVE_RESERVATION_STATUSES.has(row.status as typeof CLIENT_PROVISIONING_SLOT_ACTIVE_STATUSES[number])) {
        return false;
      }
      if (row.device_id !== deviceId) return false;
      return tstzRangeHalfOpenOverlap(windowStart, windowEnd, row.window_start_utc, row.window_end_utc);
    });
  }

  function expire(p_now: string) {
    const nowMs = Date.parse(p_now);
    let expiredCount = 0;
    for (const row of rows) {
      if (!ACTIVE_RESERVATION_STATUSES.has(row.status as typeof CLIENT_PROVISIONING_SLOT_ACTIVE_STATUSES[number])) continue;
      if (Date.parse(row.expires_at) <= nowMs) {
        row.status = "expired";
        row.updated_at = p_now;
        expiredCount += 1;
      }
    }
    return { ok: true, expired_count: expiredCount };
  }

  function reserve(args: Record<string, unknown>) {
    const p_now = new Date().toISOString();
    expire(p_now);

    const clientInstagramAccountId = readString(args.p_client_instagram_account_id);
    const existing = findActiveForClientInstagramAccount(clientInstagramAccountId);
    if (existing) return { data: existing, error: null };

    const windowStart = readString(args.p_window_start_utc);
    const windowEnd = new Date(Date.parse(windowStart) + CLIENT_PROVISIONING_SLOT_WINDOW_MS).toISOString();
    const deviceId = readString(args.p_device_id);

    if (hasDeviceOverlap(deviceId, windowStart, windowEnd)) {
      return {
        data: null,
        error: { message: "provisioning_slot_device_overlap" },
      };
    }

    const row: InMemoryReservationRow = {
      id: randomUUID(),
      created_at: p_now,
      updated_at: p_now,
      client_id: readString(args.p_client_id),
      client_instagram_account_id: clientInstagramAccountId,
      ig_account_id: readString(args.p_ig_account_id),
      assignment_id: readString(args.p_assignment_id),
      device_id: deviceId,
      app_instance_id: readString(args.p_app_instance_id),
      expected_package: readString(args.p_expected_package),
      window_start_utc: windowStart,
      window_end_utc: windowEnd,
      expires_at: windowEnd,
      status: Date.parse(windowStart) <= Date.parse(p_now) ? "window_open" : "reserved",
      reservation_source: readString(args.p_reservation_source, "client_connect"),
      assisted_connect_requested_at: null,
      dedupe_key: readString(args.p_dedupe_key) || `client_provisioning:${clientInstagramAccountId}`,
      safe_metadata: (args.p_safe_metadata && typeof args.p_safe_metadata === "object" && !Array.isArray(args.p_safe_metadata))
        ? args.p_safe_metadata as Record<string, unknown>
        : {},
    };
    rows.push(row);
    return { data: row, error: null };
  }

  function consume(args: Record<string, unknown>) {
    const reservationId = readString(args.p_reservation_id);
    const igAccountId = readString(args.p_ig_account_id);
    const row = rows.find((item) => item.id === reservationId && item.ig_account_id === igAccountId) ?? null;
    if (!row || !ACTIVE_RESERVATION_STATUSES.has(row.status as typeof CLIENT_PROVISIONING_SLOT_ACTIVE_STATUSES[number])) {
      return { data: null, error: { message: "provisioning_slot_reservation_not_consumable" } };
    }
    row.status = "consumed";
    row.updated_at = new Date().toISOString();
    return { data: row, error: null };
  }

  function markAssisted(args: Record<string, unknown>) {
    const reservationId = readString(args.p_reservation_id);
    const igAccountId = readString(args.p_ig_account_id);
    const row = rows.find((item) => item.id === reservationId && item.ig_account_id === igAccountId) ?? null;
    if (!row || !ACTIVE_RESERVATION_STATUSES.has(row.status as typeof CLIENT_PROVISIONING_SLOT_ACTIVE_STATUSES[number])) {
      return { data: null, error: { message: "provisioning_slot_reservation_not_assistable" } };
    }
    row.status = "assisted_requested";
    row.assisted_connect_requested_at = row.assisted_connect_requested_at ?? new Date().toISOString();
    row.updated_at = new Date().toISOString();
    return { data: row, error: null };
  }

  return {
    rows,
    expire,
    reserve,
    consume,
    markAssisted,
    hasDeviceOverlap,
  };
}

export function makeFilterableQuery(rows: Row[]) {
  const filters: Array<(row: Row) => boolean> = [];
  let orderField: string | null = null;
  let orderAsc = true;
  let maxRows = rows.length;

  const buildResult = () => {
    let filtered = rows.filter((row) => filters.every((filter) => filter(row)));
    if (orderField) {
      filtered = [...filtered].sort((a, b) => {
        const left = Date.parse(readString(a[orderField!])) || readString(a[orderField!]).localeCompare(readString(b[orderField!]));
        const right = Date.parse(readString(b[orderField!])) || 0;
        if (typeof left === "number" && typeof right === "number") {
          return orderAsc ? left - right : right - left;
        }
        return orderAsc
          ? readString(a[orderField!]).localeCompare(readString(b[orderField!]))
          : readString(b[orderField!]).localeCompare(readString(a[orderField!]));
      });
    }
    return { data: filtered.slice(0, maxRows), error: null };
  };

  const query = {
    select: () => query,
    eq: (field: string, value: unknown) => {
      filters.push((row) => row[field] === value);
      return query;
    },
    in: (field: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[field]));
      return query;
    },
    gt: (field: string, value: unknown) => {
      filters.push((row) => readString(row[field]) > readString(value));
      return query;
    },
    gte: () => query,
    lte: () => query,
    or: () => query,
    order: (field: string, opts?: { ascending?: boolean }) => {
      orderField = field;
      orderAsc = opts?.ascending !== false;
      return query;
    },
    limit: (limit: number) => {
      maxRows = limit;
      const result = buildResult();
      const promise = Promise.resolve(result);
      return Object.assign(promise, {
        maybeSingle: () => Promise.resolve({ data: result.data[0] ?? null, error: null }),
      });
    },
    maybeSingle: () => Promise.resolve({ data: buildResult().data[0] ?? null, error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve(buildResult()).then(resolve),
  };
  return query;
}

export function defaultCp6IdleTables(now: Date, overrides: TableFixtures = {}): TableFixtures {
  const heartbeatAt = new Date(now.getTime() - 30_000).toISOString();
  return {
    client_instagram_accounts: [
      {
        id: CP6_TEST_IDS.clientInstagramA,
        client_id: CP6_TEST_IDS.clientId,
        account_id: CP6_TEST_IDS.accountA,
        login_status: "unknown",
        provisioning_status: "not_started",
        onboarding_status: "pending",
      },
      {
        id: CP6_TEST_IDS.clientInstagramB,
        client_id: CP6_TEST_IDS.clientId,
        account_id: CP6_TEST_IDS.accountB,
        login_status: "unknown",
        provisioning_status: "not_started",
        onboarding_status: "pending",
      },
    ],
    account_commercial_packages: [
      { account_id: CP6_TEST_IDS.accountA, commercial_package_code: CP6_TEST_IDS.packageX },
      { account_id: CP6_TEST_IDS.accountB, commercial_package_code: CP6_TEST_IDS.packageX },
    ],
    account_assignments: [
      {
        id: CP6_TEST_IDS.assignmentA,
        account_id: CP6_TEST_IDS.accountA,
        device_id: CP6_TEST_IDS.deviceA,
        app_instance_id: CP6_TEST_IDS.appX,
        starts_at: "2026-07-08T18:00:00.000Z",
        ends_at: "2026-07-08T18:30:00.000Z",
        status: "active",
      },
      {
        id: CP6_TEST_IDS.assignmentB,
        account_id: CP6_TEST_IDS.accountB,
        device_id: CP6_TEST_IDS.deviceB,
        app_instance_id: CP6_TEST_IDS.appY,
        starts_at: "2026-07-08T18:00:00.000Z",
        ends_at: "2026-07-08T18:30:00.000Z",
        status: "active",
      },
    ],
    phone_devices: [
      {
        id: CP6_TEST_IDS.deviceA,
        status: "online",
        device_kind: "physical_phone",
        last_seen_at: heartbeatAt,
      },
      {
        id: CP6_TEST_IDS.deviceB,
        status: "online",
        device_kind: "physical_phone",
        last_seen_at: heartbeatAt,
      },
    ],
    phone_app_instances: [
      {
        id: CP6_TEST_IDS.appX,
        device_id: CP6_TEST_IDS.deviceA,
        status: "available",
        usable_for_auto_login: true,
        is_launchable: true,
        package_name: CP6_TEST_IDS.packageX,
      },
      {
        id: CP6_TEST_IDS.appY,
        device_id: CP6_TEST_IDS.deviceB,
        status: "available",
        usable_for_auto_login: true,
        is_launchable: true,
        package_name: CP6_TEST_IDS.packageX,
      },
    ],
    account_run_requests: [],
    ig_runs: [],
    auto_restart_device_locks: [],
    scheduled_session_preflights: [],
    client_provisioning_slot_reservations: [],
    ig_accounts: [
      { id: CP6_TEST_IDS.accountA, username: "client_a", status: "active", admin_lifecycle_status: "active" },
      { id: CP6_TEST_IDS.accountB, username: "client_b", status: "active", admin_lifecycle_status: "active" },
    ],
    account_credentials: [
      { account_id: CP6_TEST_IDS.accountA, status: "active", reauth_required: true, reauth_reason: "awaiting_login_verification" },
      { account_id: CP6_TEST_IDS.accountB, status: "active", reauth_required: true, reauth_reason: "awaiting_login_verification" },
    ],
    client_instagram_accounts_status: [],
    account_package_summary: [
      {
        account_id: CP6_TEST_IDS.accountA,
        runtime_profiles: ["full_cycle"],
        package_caps: { follow_day: 20, follow_session: 20 },
        entitlements: [],
      },
      {
        account_id: CP6_TEST_IDS.accountB,
        runtime_profiles: ["full_cycle"],
        package_caps: { follow_day: 20, follow_session: 20 },
        entitlements: [],
      },
    ],
    ig_account_settings: [
      { account_id: CP6_TEST_IDS.accountA },
      { account_id: CP6_TEST_IDS.accountB },
    ],
    ig_account_filters: [
      { account_id: CP6_TEST_IDS.accountA },
      { account_id: CP6_TEST_IDS.accountB },
    ],
    ig_account_dm_settings: [
      { account_id: CP6_TEST_IDS.accountA },
      { account_id: CP6_TEST_IDS.accountB },
    ],
    ig_targets: [
      { account_id: CP6_TEST_IDS.accountA, status: "valid", quality_status: "eligible", verification_status: "found" },
      { account_id: CP6_TEST_IDS.accountB, status: "valid", quality_status: "eligible", verification_status: "found" },
    ],
    account_dashboard_actions: [
      {
        account_id: CP6_TEST_IDS.accountA,
        status: "pending_verification",
        blocking_campaign: true,
        action_type: "submit_instagram_credentials",
      },
      {
        account_id: CP6_TEST_IDS.accountB,
        status: "pending_verification",
        blocking_campaign: true,
        action_type: "submit_instagram_credentials",
      },
    ],
    ...overrides,
  };
}

export function createCp6IntegrationSupabase(input: {
  tables?: TableFixtures;
  now?: Date;
}) {
  const now = input.now ?? new Date("2026-07-08T15:00:00.000Z");
  const tables = defaultCp6IdleTables(now, input.tables ?? {});
  const reservationStore = createInMemoryProvisioningReservationStore(now);
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const createdRequests: Row[] = [];

  const supabase = {
    from(table: string) {
      if (table === "client_provisioning_slot_reservations") {
        return makeFilterableQuery([...reservationStore.rows, ...(tables.client_provisioning_slot_reservations ?? [])]);
      }
      return makeFilterableQuery(tables[table] ?? []);
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      rpcCalls.push({ name, args });
      if (name === "expire_client_provisioning_slot_reservations") {
        return { data: reservationStore.expire(readString(args.p_now, now.toISOString())), error: null };
      }
      if (name === "reserve_client_provisioning_slot") {
        return reservationStore.reserve(args);
      }
      if (name === "consume_client_provisioning_slot_reservation") {
        return reservationStore.consume(args);
      }
      if (name === "mark_client_provisioning_assisted_requested") {
        return reservationStore.markAssisted(args);
      }
      if (name === "get_active_operator_stop_suppression") {
        const accountId = readString(args.p_account_id);
        const pNow = Date.parse(readString(args.p_now, now.toISOString()));
        const row = (tables.operator_stop_suppressions ?? []).find((item) => {
          if (readString(item.account_id) !== accountId) return false;
          if (readString(item.status) !== "active") return false;
          const expires = Date.parse(readString(item.expires_at));
          return Number.isFinite(expires) && expires > pNow;
        }) ?? null;
        return { data: row, error: null };
      }
      if (name === "create_account_run_request") {
        const request = {
          id: randomUUID(),
          account_id: readString(args.p_account_id),
          status: "queued",
          requested_run_type: "login_provisioning",
          idempotency_key: readString(args.p_idempotency_key),
          metadata_safe: args.p_metadata_safe ?? {},
        };
        createdRequests.push(request);
        tables.account_run_requests = [...(tables.account_run_requests ?? []), request];
        return { data: request, error: null };
      }
      if (name === "auto_restart_acquire_device_lock") {
        return { data: { ok: true, acquired: true, lease_id: "lease-test-1" }, error: null };
      }
      if (name === "auto_restart_bind_device_lock_to_request") {
        return { data: { ok: true, bound: true }, error: null };
      }
      if (name === "auto_restart_release_device_lock") {
        return { data: { ok: true, released: true }, error: null };
      }
      if (name === "cancel_account_run_request") {
        return { data: { ok: true }, error: null };
      }
      if (name === "reconcile_stale_device_ui_leases") {
        return { data: { ok: true }, error: null };
      }
      if (name === "list_available_assignment_slots") {
        return { data: { ok: true, slots: [] }, error: null };
      }
      return { data: { ok: true }, error: null };
    },
  };

  return {
    supabase,
    tables,
    reservationStore,
    rpcCalls,
    createdRequests,
    now,
  };
}
