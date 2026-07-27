import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTrustedDispatcherIdentity,
  assertTrustedDispatcherWorkerId,
  DISPATCHER_TRUST_FAILURE,
  MANUAL_RESTART_AUDIT_ACTOR,
  phoneDeviceAuthorizedForDispatcher,
  resolveTrustedDispatcherWorkerForPhoneDevice,
} from "./dispatcher-trust.ts";

type SupabaseState = {
  heartbeat?: Record<string, unknown> | null;
  heartbeats?: Record<string, unknown>[];
  phoneDevices?: Record<string, unknown>[];
};

function makeSupabase(state: SupabaseState, options: { trackTables?: string[] } = {}) {
  const queriedTables: string[] = options.trackTables ?? [];
  return {
    queriedTables,
    from(table: string) {
      if (options.trackTables) {
        queriedTables.push(table);
      }
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        limit: async () => table === "worker_heartbeats"
          ? { data: state.heartbeats ?? (state.heartbeat ? [state.heartbeat] : []), error: null }
          : { data: [], error: null },
        maybeSingle: async () => {
          if (table === "worker_heartbeats") {
            return { data: state.heartbeat ?? null, error: null };
          }
          return { data: null, error: null };
        },
      };
      if (table === "phone_devices") {
        return {
          select: () => ({
            in: () => ({
              limit: async () => ({
                data: state.phoneDevices ?? [],
                error: null,
              }),
            }),
          }),
        };
      }
      return query;
    },
  };
}

function freshHeartbeat(overrides: Record<string, unknown> = {}) {
  return {
    worker_id: "run-dispatcher:mac-a",
    status: "idle",
    last_seen_at: new Date().toISOString(),
    host_machine: "mac-a",
    metadata: { launch_enabled: true },
    ...overrides,
  };
}

test("prefix-only worker id is not enough without heartbeat", async () => {
  const supabase = makeSupabase({ heartbeat: null });
  const result = await assertTrustedDispatcherIdentity(supabase as never, "run-dispatcher:mac-a");
  assert.equal(result.ok, false);
  assert.equal(result.reason, DISPATCHER_TRUST_FAILURE);
});

test("stale dispatcher heartbeat is rejected", async () => {
  const supabase = makeSupabase({
    heartbeat: freshHeartbeat({
      last_seen_at: new Date(Date.now() - 600_000).toISOString(),
    }),
  });
  const result = await assertTrustedDispatcherIdentity(supabase as never, "run-dispatcher:mac-a", {
    maxAgeSeconds: 90,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, DISPATCHER_TRUST_FAILURE);
});

test("fresh dispatcher heartbeat is accepted without device scope", async () => {
  const supabase = makeSupabase({ heartbeat: freshHeartbeat() });
  const result = await assertTrustedDispatcherIdentity(supabase as never, "run-dispatcher:mac-a");
  assert.equal(result.ok, true);
});

test("fresh heartbeat + authorized phone_devices host is accepted", async () => {
  const supabase = makeSupabase({
    heartbeat: freshHeartbeat(),
    phoneDevices: [{
      id: "phone-1",
      host_machine: "mac-a",
      status: "active",
      metadata: {},
    }],
  }, { trackTables: [] });
  const result = await assertTrustedDispatcherIdentity(supabase as never, "run-dispatcher:mac-a", {
    deviceIds: ["phone-1"],
  });
  assert.equal(result.ok, true);
});

test("dispatcher is rejected when phone host differs from worker host", async () => {
  const supabase = makeSupabase({
    heartbeat: freshHeartbeat(),
    phoneDevices: [{
      id: "phone-1",
      host_machine: "mac-b",
      status: "active",
      metadata: {},
    }],
  });
  const result = await assertTrustedDispatcherIdentity(supabase as never, "run-dispatcher:mac-a", {
    deviceIds: ["phone-1"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, DISPATCHER_TRUST_FAILURE);
});

test("dispatcher is rejected when heartbeat host_machine disagrees with worker id host", async () => {
  const supabase = makeSupabase({
    heartbeat: freshHeartbeat({ host_machine: "mac-b" }),
    phoneDevices: [{
      id: "phone-1",
      host_machine: "mac-a",
      status: "active",
      metadata: {},
    }],
  });
  const result = await assertTrustedDispatcherIdentity(supabase as never, "run-dispatcher:mac-a", {
    deviceIds: ["phone-1"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, DISPATCHER_TRUST_FAILURE);
});

test("metadata.dispatcher_host alone cannot authorize a mismatched phone host", async () => {
  const authorized = phoneDeviceAuthorizedForDispatcher(
    { host_machine: "mac-b", metadata: { dispatcher_host: "mac-a" } },
    "mac-a",
    "mac-a",
  );
  assert.equal(authorized, false);
});

test("metadata.dispatcher_host must not contradict host_machine when present", async () => {
  const authorized = phoneDeviceAuthorizedForDispatcher(
    { host_machine: "mac-a", metadata: { dispatcher_host: "mac-b" } },
    "mac-a",
    "mac-a",
  );
  assert.equal(authorized, false);
});

test("phone without host_machine relation is rejected", async () => {
  const supabase = makeSupabase({
    heartbeat: freshHeartbeat(),
    phoneDevices: [{
      id: "phone-1",
      host_machine: "",
      status: "active",
      metadata: { dispatcher_host: "mac-a" },
    }],
  });
  const result = await assertTrustedDispatcherIdentity(supabase as never, "run-dispatcher:mac-a", {
    deviceIds: ["phone-1"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, DISPATCHER_TRUST_FAILURE);
});

test("missing phone_devices row is rejected", async () => {
  const supabase = makeSupabase({
    heartbeat: freshHeartbeat(),
    phoneDevices: [],
  });
  const result = await assertTrustedDispatcherIdentity(supabase as never, "run-dispatcher:mac-a", {
    deviceIds: ["phone-1"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, DISPATCHER_TRUST_FAILURE);
});

test("assertTrustedDispatcherIdentity never queries legacy devices table", async () => {
  const tracked = makeSupabase({
    heartbeat: freshHeartbeat(),
    phoneDevices: [{
      id: "phone-1",
      host_machine: "mac-a",
      status: "active",
      metadata: {},
    }],
  }, { trackTables: [] });
  await assertTrustedDispatcherIdentity(tracked as never, "run-dispatcher:mac-a", {
    deviceIds: ["phone-1"],
  });
  assert.deepEqual(tracked.queriedTables, ["worker_heartbeats", "phone_devices"]);
  assert.equal(tracked.queriedTables.includes("devices"), false);
});

test("invalid worker prefix is rejected", () => {
  const result = assertTrustedDispatcherWorkerId("rogue-worker:mac-a");
  assert.equal(result.ok, false);
  assert.equal(result.reason, DISPATCHER_TRUST_FAILURE);
});

test("botapp-manual-restart is never an execution dispatcher worker id", () => {
  const result = assertTrustedDispatcherWorkerId(MANUAL_RESTART_AUDIT_ACTOR);
  assert.equal(result.ok, false);
  assert.equal(result.reason, DISPATCHER_TRUST_FAILURE);
});

test("botapp manual actor alone cannot satisfy dispatcher attestation", async () => {
  const supabase = makeSupabase({ heartbeat: freshHeartbeat() });
  const result = await assertTrustedDispatcherIdentity(supabase as never, MANUAL_RESTART_AUDIT_ACTOR);
  assert.equal(result.ok, false);
  assert.equal(result.reason, DISPATCHER_TRUST_FAILURE);
});

test("authenticated manual path resolves fresh dispatcher from phone_devices host", async () => {
  const supabase = makeSupabase({
    heartbeat: freshHeartbeat(),
    phoneDevices: [{
      id: "phone-1",
      host_machine: "mac-a",
      status: "active",
      metadata: {},
    }],
  });
  const result = await resolveTrustedDispatcherWorkerForPhoneDevice(supabase as never, "phone-1");
  assert.equal(result.ok, true);
  assert.equal(result.workerId, "run-dispatcher:mac-a");
  assert.ok(result.verifiedAt);
});

test("authenticated manual path resolves a stable host to its configured dispatcher alias", async () => {
  const heartbeat = freshHeartbeat({
    worker_id: "run-dispatcher:mac-admin-01",
    host_machine: "Ekwas-MacBook-Pro-M1-Pro.local",
  });
  const supabase = makeSupabase({
    heartbeat,
    heartbeats: [heartbeat],
    phoneDevices: [{
      id: "phone-1",
      host_machine: "Ekwas-MacBook-Pro-M1-Pro.local",
      status: "active",
      metadata: {},
    }],
  });
  const result = await resolveTrustedDispatcherWorkerForPhoneDevice(supabase as never, "phone-1");
  assert.equal(result.ok, true);
  assert.equal(result.workerId, "run-dispatcher:mac-admin-01");
});

test("dispatcher worker alias is authorized by its fresh heartbeat host", async () => {
  const supabase = makeSupabase({
    heartbeat: freshHeartbeat({
      worker_id: "run-dispatcher:mac-admin-01",
      host_machine: "Ekwas-MacBook-Pro-M1-Pro.local",
    }),
    phoneDevices: [{
      id: "phone-1",
      host_machine: "Ekwas-MacBook-Pro-M1-Pro.local",
      status: "active",
      metadata: {},
    }],
  });
  const result = await assertTrustedDispatcherIdentity(
    supabase as never,
    "run-dispatcher:mac-admin-01",
    { deviceIds: ["phone-1"] },
  );
  assert.equal(result.ok, true);
});

test("dispatcher worker alias still rejects a phone outside its heartbeat host", async () => {
  const supabase = makeSupabase({
    heartbeat: freshHeartbeat({
      worker_id: "run-dispatcher:mac-admin-01",
      host_machine: "Ekwas-MacBook-Pro-M1-Pro.local",
    }),
    phoneDevices: [{
      id: "phone-1",
      host_machine: "other-host.local",
      status: "active",
      metadata: {},
    }],
  });
  const result = await assertTrustedDispatcherIdentity(
    supabase as never,
    "run-dispatcher:mac-admin-01",
    { deviceIds: ["phone-1"] },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, DISPATCHER_TRUST_FAILURE);
});

test("authenticated manual path rejects when no fresh dispatcher exists", async () => {
  const supabase = makeSupabase({
    heartbeat: null,
    phoneDevices: [{
      id: "phone-1",
      host_machine: "mac-a",
      status: "active",
      metadata: {},
    }],
  });
  const result = await resolveTrustedDispatcherWorkerForPhoneDevice(supabase as never, "phone-1");
  assert.equal(result.ok, false);
  assert.equal(result.reason, DISPATCHER_TRUST_FAILURE);
});

test("authenticated manual path rejects dispatcher host mismatch", async () => {
  const supabase = makeSupabase({
    heartbeat: freshHeartbeat({ host_machine: "mac-b" }),
    phoneDevices: [{
      id: "phone-1",
      host_machine: "mac-a",
      status: "active",
      metadata: {},
    }],
  });
  const result = await resolveTrustedDispatcherWorkerForPhoneDevice(supabase as never, "phone-1");
  assert.equal(result.ok, false);
  assert.equal(result.reason, DISPATCHER_TRUST_FAILURE);
});

test("forged run-dispatcher prefix without heartbeat is rejected", async () => {
  const supabase = makeSupabase({ heartbeat: null });
  const result = await assertTrustedDispatcherIdentity(supabase as never, "run-dispatcher:mac-a");
  assert.equal(result.ok, false);
  assert.equal(result.reason, DISPATCHER_TRUST_FAILURE);
});

test("scheduled tick with valid real dispatcher is authorized", async () => {
  const supabase = makeSupabase({ heartbeat: freshHeartbeat() });
  const result = await assertTrustedDispatcherIdentity(supabase as never, "run-dispatcher:mac-a");
  assert.equal(result.ok, true);
});
