import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileStaleDeviceLockBeforePreflight,
  STALE_DEVICE_LOCK_RELEASE_REASON,
  TERMINAL_REQUEST_DEVICE_LOCK_RELEASE_REASON,
} from "./reconcile-stale-device-lock-before-preflight.ts";

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

type MockState = {
  lock: Record<string, unknown> | null;
  requestStatus?: string | null;
  preflightStatus?: string | null;
  releaseResult?: Record<string, unknown>;
  releaseError?: Error | null;
};

function makeSupabase(state: MockState) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = {
    rpcCalls,
    from(table: string) {
      const query = {
        select: () => query,
        eq: (col: string, value: unknown) => {
          if (table === "auto_restart_device_locks" && col === "device_id") {
            query._deviceId = readString(value);
          }
          if (table === "account_run_requests" && col === "id") {
            query._requestId = readString(value);
          }
          if (table === "scheduled_session_preflights" && col === "request_id") {
            query._preflightRequestId = readString(value);
          }
          return query;
        },
        limit: () => query,
        maybeSingle: async () => {
          if (table === "auto_restart_device_locks") {
            if (!state.lock || readString(state.lock.device_id) !== query._deviceId) {
              return { data: null, error: null };
            }
            return { data: state.lock, error: null };
          }
          if (table === "account_run_requests") {
            if (!state.requestStatus || query._requestId !== readString(state.lock?.request_id)) {
              return { data: null, error: null };
            }
            return { data: { status: state.requestStatus }, error: null };
          }
          if (table === "scheduled_session_preflights") {
            if (!state.preflightStatus) return { data: null, error: null };
            return { data: { status: state.preflightStatus }, error: null };
          }
          return { data: null, error: null };
        },
        _deviceId: "",
        _requestId: "",
        _preflightRequestId: "",
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "auto_restart_release_device_lock") {
        if (state.releaseError) throw state.releaseError;
        return {
          data: state.releaseResult ?? { ok: true, released: true, lease_id: "lease-1" },
          error: null,
        };
      }
      return { data: {}, error: null };
    },
  };
  return supabase;
}

test("expired lock before preflight releases via audited RPC", async () => {
  const supabase = makeSupabase({
    lock: {
      device_id: "device-1",
      worker_id: "pending-request:req-old",
      request_id: "req-old",
      lease_id: "lease-1",
      lease_expires_at: "2026-07-08T16:05:30.000Z",
    },
    requestStatus: "failed",
  });
  const result = await reconcileStaleDeviceLockBeforePreflight(supabase, {
    deviceId: "device-1",
    accountId: "account-1",
    now: new Date("2026-07-09T18:00:00.000Z"),
  });

  assert.equal(result.action, "released");
  assert.equal(result.stale_lock_release_succeeded, true);
  assert.equal(
    result.release_reason,
    TERMINAL_REQUEST_DEVICE_LOCK_RELEASE_REASON,
  );
  assert.equal(supabase.rpcCalls.length, 1);
  assert.equal(supabase.rpcCalls[0]?.name, "auto_restart_release_device_lock");
  assert.equal(
    supabase.rpcCalls[0]?.args.p_release_reason,
    TERMINAL_REQUEST_DEVICE_LOCK_RELEASE_REASON,
  );
});

test("terminal request lock releases even when lease metadata is stale", async () => {
  const supabase = makeSupabase({
    lock: {
      device_id: "device-1",
      worker_id: "pending-request:req-old",
      request_id: "req-old",
      lease_id: "lease-1",
      lease_expires_at: "2026-07-09T20:00:00.000Z",
    },
    requestStatus: "canceled",
  });
  const result = await reconcileStaleDeviceLockBeforePreflight(supabase, {
    deviceId: "device-1",
    now: new Date("2026-07-09T18:00:00.000Z"),
  });

  assert.equal(result.action, "released");
  assert.equal(result.release_reason, TERMINAL_REQUEST_DEVICE_LOCK_RELEASE_REASON);
});

test("active non-expired lock with active request is not released", async () => {
  const supabase = makeSupabase({
    lock: {
      device_id: "device-1",
      worker_id: "pending-request:req-live",
      request_id: "req-live",
      lease_id: "lease-1",
      lease_expires_at: "2026-07-09T20:00:00.000Z",
    },
    requestStatus: "running",
  });
  const result = await reconcileStaleDeviceLockBeforePreflight(supabase, {
    deviceId: "device-1",
    now: new Date("2026-07-09T18:00:00.000Z"),
  });

  assert.equal(result.action, "active_not_released");
  assert.equal(result.lock_was_active_not_released, true);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("expired lock without request releases with stale reason", async () => {
  const supabase = makeSupabase({
    lock: {
      device_id: "device-1",
      worker_id: "worker-a",
      request_id: null,
      lease_id: "lease-1",
      lease_expires_at: "2026-07-08T16:05:30.000Z",
    },
  });
  const result = await reconcileStaleDeviceLockBeforePreflight(supabase, {
    deviceId: "device-1",
    now: new Date("2026-07-09T18:00:00.000Z"),
  });

  assert.equal(result.action, "released");
  assert.equal(result.release_reason, STALE_DEVICE_LOCK_RELEASE_REASON);
});

test("ambiguous active lock without request is not released", async () => {
  const supabase = makeSupabase({
    lock: {
      device_id: "device-1",
      worker_id: "worker-a",
      request_id: null,
      lease_id: "lease-1",
      lease_expires_at: "2026-07-09T20:00:00.000Z",
    },
  });
  const result = await reconcileStaleDeviceLockBeforePreflight(supabase, {
    deviceId: "device-1",
    now: new Date("2026-07-09T18:00:00.000Z"),
  });

  assert.equal(result.action, "ambiguous_not_released");
  assert.equal(result.ambiguous_lock_state, true);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("release RPC failure is fail-closed without throwing", async () => {
  const supabase = makeSupabase({
    lock: {
      device_id: "device-1",
      worker_id: "pending-request:req-old",
      request_id: "req-old",
      lease_id: "lease-1",
      lease_expires_at: "2026-07-08T16:05:30.000Z",
    },
    requestStatus: "failed",
    releaseError: new Error("rpc down"),
  });
  const result = await reconcileStaleDeviceLockBeforePreflight(supabase, {
    deviceId: "device-1",
    now: new Date("2026-07-09T18:00:00.000Z"),
  });

  assert.equal(result.action, "release_failed");
  assert.match(result.release_error ?? "", /rpc down/);
});

test("no lock row returns none action", async () => {
  const supabase = makeSupabase({ lock: null });
  const result = await reconcileStaleDeviceLockBeforePreflight(supabase, {
    deviceId: "device-1",
  });
  assert.equal(result.action, "none");
  assert.equal(result.stale_lock_detected, false);
});
