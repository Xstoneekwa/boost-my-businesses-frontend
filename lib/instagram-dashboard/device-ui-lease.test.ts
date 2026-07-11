import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEVICE_LEASE_OPERATOR_LABEL,
  DEVICE_LEASE_UNAVAILABLE,
  deviceLeaseOperatorLabel,
  leaseRequestOrCancel,
  mapDeviceLockReasonToLeaseReason,
  runtimeLockFromActiveLease,
} from "./device-ui-lease.ts";
import { deviceSessionLockBlocksStart } from "./device-session-lock.ts";

describe("device ui lease CP3", () => {
  it("maps legacy device_lock_held to device_lease_unavailable", () => {
    assert.equal(mapDeviceLockReasonToLeaseReason("device_lock_held"), DEVICE_LEASE_UNAVAILABLE);
    assert.equal(deviceLeaseOperatorLabel("device_lock_held"), DEVICE_LEASE_OPERATOR_LABEL);
  });

  it("projects runtimeLock when an active phone lease exists", () => {
    assert.equal(
      runtimeLockFromActiveLease({
        deviceId: "device-1",
        workerId: "pending-request:req-1",
        accountId: "acct-1",
        appInstanceId: null,
        requestId: "req-1",
        reason: "manual_run",
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, "device-1"),
      "device_level_lock",
    );
    assert.equal(
      runtimeLockFromActiveLease({
        deviceId: "device-1",
        workerId: "pending-request:req-1",
        accountId: "acct-1",
        appInstanceId: null,
        requestId: "req-1",
        reason: "manual_run",
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, "device-2"),
      "none",
    );
  });

  it("blocks cross-owner starts with device_lease_unavailable", () => {
    const reason = deviceSessionLockBlocksStart(
      {
        deviceId: "device-1",
        workerId: "worker-a",
        accountId: "acct-a",
        appInstanceId: null,
        requestId: "req-a",
        reason: "manual_run",
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      { accountId: "acct-b" },
    );
    assert.equal(reason, "device_lease_unavailable");
  });

  it("scheduled preflight lease path reconciles stale lock before acquire", async () => {
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const supabase = {
      from(table: string) {
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => {
            if (table === "auto_restart_device_locks") {
              return {
                data: {
                  device_id: "device-1",
                  worker_id: "pending-request:req-old",
                  request_id: "req-old",
                  lease_id: "lease-1",
                  lease_expires_at: "2026-07-08T16:05:30.000Z",
                },
                error: null,
              };
            }
            if (table === "account_run_requests") {
              return { data: { status: "failed" }, error: null };
            }
            if (table === "scheduled_session_preflights") {
              return { data: null, error: null };
            }
            return { data: null, error: null };
          },
        };
        return query;
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        if (name === "auto_restart_release_device_lock") {
          return { data: { ok: true, released: true }, error: null };
        }
        if (name === "auto_restart_acquire_device_lock") {
          return { data: { ok: true, acquired: true, lease_id: "lease-new" }, error: null };
        }
        if (name === "auto_restart_bind_device_lock_to_request") {
          return { data: { ok: true, bound: true }, error: null };
        }
        return { data: {}, error: null };
      },
    };

    const result = await leaseRequestOrCancel(supabase, {
      deviceId: "device-1",
      accountId: "account-1",
      requestId: "req-new",
      reason: "scheduled_session_preflight",
      ownerKind: "preflight",
      operationPhase: "queued",
    });

    assert.equal(result.ok, true);
    assert.equal(rpcCalls[0]?.name, "auto_restart_release_device_lock");
    assert.ok(rpcCalls.some((call) => call.name === "auto_restart_acquire_device_lock"));
  });

  it("scheduled preflight lease path refuses acquire when slot is preflight_ready", async () => {
    const currentWindowStart = "2026-07-11T10:00:00.000Z";
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const supabase = {
      from(table: string) {
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => {
            if (table === "scheduled_session_preflights") {
              return {
                data: {
                  id: "preflight-1",
                  status: "preflight_ready",
                  request_id: "req-ready",
                  scheduled_window_start: currentWindowStart,
                  business_action_deadline: "2026-07-11T15:50:00.000Z",
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        };
        return query;
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        if (name === "cancel_account_run_request") {
          return { data: { ok: true }, error: null };
        }
        if (name === "auto_restart_release_device_lock") {
          return { data: { ok: true, released: true }, error: null };
        }
        return { data: {}, error: null };
      },
    };

    const result = await leaseRequestOrCancel(supabase, {
      deviceId: "device-1",
      accountId: "account-1",
      requestId: "req-new",
      reason: "scheduled_session_preflight",
      ownerKind: "preflight",
      operationPhase: "queued",
      scheduledWindowStart: currentWindowStart,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "preflight_slot_already_ready");
    }
    assert.ok(rpcCalls.some((call) => call.name === "cancel_account_run_request"));
    assert.equal(rpcCalls.some((call) => call.name === "auto_restart_acquire_device_lock"), false);
  });

  it("scheduled preflight lease path ignores preflight_ready from an older slot window", async () => {
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const supabase = {
      from(table: string) {
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => {
            if (table === "scheduled_session_preflights") {
              return { data: null, error: null };
            }
            return { data: null, error: null };
          },
        };
        return query;
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        if (name === "auto_restart_acquire_device_lock") {
          return { data: { ok: true, acquired: true, lease_id: "lease-new" }, error: null };
        }
        if (name === "auto_restart_bind_device_lock_to_request") {
          return { data: { ok: true, bound: true }, error: null };
        }
        return { data: {}, error: null };
      },
    };

    const result = await leaseRequestOrCancel(supabase, {
      deviceId: "device-1",
      accountId: "account-1",
      requestId: "req-new",
      reason: "scheduled_session_preflight",
      ownerKind: "preflight",
      operationPhase: "queued",
      scheduledWindowStart: "2026-07-11T10:00:00.000Z",
    });

    assert.equal(result.ok, true);
    assert.equal(rpcCalls.some((call) => call.name === "cancel_account_run_request"), false);
    assert.ok(rpcCalls.some((call) => call.name === "auto_restart_acquire_device_lock"));
  });

  it("scheduled preflight lease path ignores stale preflight_ready past business_action_deadline", async () => {
    const currentWindowStart = "2026-07-11T10:00:00.000Z";
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const supabase = {
      from(table: string) {
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => {
            if (table === "scheduled_session_preflights") {
              return {
                data: {
                  id: "preflight-stale",
                  status: "preflight_ready",
                  request_id: "req-old-ready",
                  scheduled_window_start: currentWindowStart,
                  business_action_deadline: "2026-07-11T09:00:00.000Z",
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        };
        return query;
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        if (name === "auto_restart_acquire_device_lock") {
          return { data: { ok: true, acquired: true, lease_id: "lease-new" }, error: null };
        }
        if (name === "auto_restart_bind_device_lock_to_request") {
          return { data: { ok: true, bound: true }, error: null };
        }
        return { data: {}, error: null };
      },
    };

    const result = await leaseRequestOrCancel(supabase, {
      deviceId: "device-1",
      accountId: "account-1",
      requestId: "req-late",
      reason: "scheduled_session_preflight",
      ownerKind: "preflight",
      operationPhase: "queued",
      scheduledWindowStart: currentWindowStart,
      now: new Date("2026-07-11T12:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.equal(rpcCalls.some((call) => call.name === "cancel_account_run_request"), false);
    assert.ok(rpcCalls.some((call) => call.name === "auto_restart_acquire_device_lock"));
  });

  it("scheduled preflight lease path refuses acquire when another preflight is running", async () => {
    const currentWindowStart = "2026-07-11T10:00:00.000Z";
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const supabase = {
      from(table: string) {
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => {
            if (table === "scheduled_session_preflights") {
              return {
                data: {
                  id: "preflight-1",
                  status: "preflight_running",
                  request_id: "req-running",
                  scheduled_window_start: currentWindowStart,
                  business_action_deadline: "2026-07-11T15:50:00.000Z",
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        };
        return query;
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        if (name === "cancel_account_run_request") {
          return { data: { ok: true }, error: null };
        }
        if (name === "auto_restart_release_device_lock") {
          return { data: { ok: true, released: true }, error: null };
        }
        return { data: {}, error: null };
      },
    };

    const result = await leaseRequestOrCancel(supabase, {
      deviceId: "device-1",
      accountId: "account-1",
      requestId: "req-new",
      reason: "scheduled_session_preflight",
      ownerKind: "preflight",
      operationPhase: "queued",
      scheduledWindowStart: currentWindowStart,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "preflight_already_running");
    }
    assert.equal(rpcCalls.some((call) => call.name === "auto_restart_acquire_device_lock"), false);
  });
});
