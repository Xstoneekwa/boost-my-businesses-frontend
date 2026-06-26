import assert from "node:assert/strict";
import test from "node:test";

import { resolveLiveAssignmentTarget } from "./assignment-live-capacity.ts";

type Row = Record<string, unknown>;

const accountId = "account-test-1";
const subscriptionId = "sub-1";
const now = new Date("2026-06-22T03:00:00.000Z");

const physicalNoClone = {
  id: "device-physical-a",
  status: "available",
  pool_type: "full_cycle",
  timezone: "Africa/Johannesburg",
  device_kind: "physical_phone",
  created_at: "2026-06-01T00:00:00.000Z",
};
const physicalWithClone = {
  id: "device-physical-b",
  status: "available",
  pool_type: "full_cycle",
  timezone: "Africa/Johannesburg",
  device_kind: "physical_phone",
  created_at: "2026-06-02T00:00:00.000Z",
};
const emulator = {
  id: "device-emulator",
  status: "available",
  pool_type: "full_cycle",
  timezone: "UTC",
  device_kind: "emulator",
  created_at: "2026-05-01T00:00:00.000Z",
};

const futureSlot = {
  slot_index: 1,
  slot_kind: "full_cycle",
  slot_kind_label: "Morning",
  local_label: "09:00",
  starts_at: "2026-06-22T07:00:00.000Z",
  ends_at: "2026-06-22T13:00:00.000Z",
  available: true,
  reason: "available",
  occupied_by: null,
};

function makeQuery(rows: Row[]) {
  const filters: Array<(row: Row) => boolean> = [];
  let maxRows = rows.length;

  function buildResult() {
    return {
      data: rows.filter((row) => filters.every((filter) => filter(row))).slice(0, maxRows),
      error: null,
    };
  }

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
    or: () => query,
    order: () => query,
    limit: (limit: number) => {
      maxRows = limit;
      const limited = {
        maybeSingle: () => Promise.resolve({ data: buildResult().data[0] ?? null, error: null }),
        then: (resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(buildResult()).then(resolve, reject),
      };
      return limited;
    },
    maybeSingle: () => Promise.resolve({ data: buildResult().data[0] ?? null, error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(buildResult()).then(resolve, reject),
  };
  return query;
}

function slotRpcForDevice(deviceId: string) {
  return {
    ok: true,
    device_id: deviceId,
    device_timezone: deviceId === physicalWithClone.id ? "Africa/Johannesburg" : "UTC",
    slots: [futureSlot],
    app_instance_availability: { available: 1, total: 4 },
  };
}

function makeSupabase(options: {
  assignments?: Row[];
  slotByDevice?: Record<string, ReturnType<typeof slotRpcForDevice> | null>;
} = {}) {
  const rows: Record<string, Row[]> = {
    client_subscription_accounts: [{
      account_id: accountId,
      subscription_id: subscriptionId,
      status: "active",
    }],
    client_subscriptions: [{
      id: subscriptionId,
      subscription_type: "full_cycle",
      status: "active",
    }],
    account_assignments: options.assignments ?? [],
    phone_devices: [physicalNoClone, physicalWithClone, emulator],
    device_heartbeats: [
      { device_id: physicalNoClone.id, status: "online", last_seen_at: new Date(now.getTime() - 60_000).toISOString() },
      { device_id: physicalWithClone.id, status: "online", last_seen_at: new Date(now.getTime() - 60_000).toISOString() },
      { device_id: emulator.id, status: "online", last_seen_at: new Date(now.getTime() - 60_000).toISOString() },
    ],
    phone_app_instances: [
      { id: "clone-a-1", device_id: physicalNoClone.id, status: "occupied", usable_for_auto_login: true, is_launchable: true, current_account_id: "other", instance_index: 1 },
      { id: "clone-b-1", device_id: physicalWithClone.id, status: "available", usable_for_auto_login: true, is_launchable: true, current_account_id: null, instance_index: 1 },
      { id: "clone-b-2", device_id: physicalWithClone.id, status: "available", usable_for_auto_login: true, is_launchable: true, current_account_id: null, instance_index: 2 },
      { id: "clone-em-1", device_id: emulator.id, status: "available", usable_for_auto_login: true, is_launchable: true, current_account_id: null, instance_index: 1 },
    ],
  };

  const slotByDevice = options.slotByDevice ?? {
    [physicalNoClone.id]: slotRpcForDevice(physicalNoClone.id),
    [physicalWithClone.id]: slotRpcForDevice(physicalWithClone.id),
    [emulator.id]: slotRpcForDevice(emulator.id),
  };

  return {
    from(table: string) {
      return makeQuery(rows[table] ?? []);
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "list_available_assignment_slots") {
        const deviceId = readString(args.p_device_id, "");
        const payload = slotByDevice[deviceId] ?? null;
        return Promise.resolve({ data: payload, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

test("physical phone without free clone is skipped", async () => {
  const supabase = makeSupabase();
  const result = await resolveLiveAssignmentTarget(supabase, accountId, {
    reservationMode: "onboarding",
    now,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.target.deviceId, physicalWithClone.id);
  assert.equal(result.target.appInstanceId, "clone-b-1");
});

test("emulator with free clones is rejected for client auto assignment", async () => {
  const supabase = makeSupabase({
    assignments: [],
    slotByDevice: {
      [emulator.id]: slotRpcForDevice(emulator.id),
    },
  });
  const onlyEmulator = {
    from(table: string) {
      if (table === "phone_devices") return makeQuery([emulator]);
      return makeSupabase().from(table);
    },
    rpc: makeSupabase().rpc,
  };
  const result = await resolveLiveAssignmentTarget(onlyEmulator, accountId, {
    reservationMode: "onboarding",
    now,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "physical_phone_unavailable");
});

test("second physical phone with free clone is chosen automatically", async () => {
  const supabase = makeSupabase();
  const result = await resolveLiveAssignmentTarget(supabase, accountId, {
    reservationMode: "onboarding",
    now,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.target.deviceId, physicalWithClone.id);
  assert.equal(result.reason, "live_capacity_selected");
});

test("onboarding reservation accepts slot outside the active window", async () => {
  const supabase = makeSupabase();
  const result = await resolveLiveAssignmentTarget(supabase, accountId, {
    reservationMode: "onboarding",
    now,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.target.startsAt, futureSlot.starts_at);
  assert.equal(result.target.endsAt, futureSlot.ends_at);
});

test("immediate assignment requires current window", async () => {
  const supabase = makeSupabase();
  const result = await resolveLiveAssignmentTarget(supabase, accountId, {
    reservationMode: "immediate",
    requireCurrentWindow: true,
    now,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "no_available_slot");
});

test("no admissible device returns capacity unavailable", async () => {
  const supabase = {
    from(table: string) {
      if (table === "phone_devices") return makeQuery([]);
      return makeSupabase().from(table);
    },
    rpc: makeSupabase().rpc,
  };
  const result = await resolveLiveAssignmentTarget(supabase, accountId, {
    reservationMode: "onboarding",
    now,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "physical_phone_unavailable");
});

test("existing physical assignment is idempotent", async () => {
  const supabase = makeSupabase({
    assignments: [{
      id: "assign-1",
      account_id: accountId,
      device_id: physicalWithClone.id,
      app_instance_id: "clone-b-1",
      status: "reserved",
      starts_at: futureSlot.starts_at,
      ends_at: futureSlot.ends_at,
    }],
  });
  const result = await resolveLiveAssignmentTarget(supabase, accountId, {
    reservationMode: "onboarding",
    now,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "already_assigned");
});

test("emulator assignment does not block onboarding physical reservation", async () => {
  const supabase = makeSupabase({
    assignments: [{
      id: "assign-em",
      account_id: accountId,
      device_id: emulator.id,
      app_instance_id: "clone-em-1",
      status: "reserved",
      starts_at: futureSlot.starts_at,
      ends_at: futureSlot.ends_at,
    }],
  });
  const result = await resolveLiveAssignmentTarget(supabase, accountId, {
    reservationMode: "onboarding",
    now,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.target.deviceId, physicalWithClone.id);
});
