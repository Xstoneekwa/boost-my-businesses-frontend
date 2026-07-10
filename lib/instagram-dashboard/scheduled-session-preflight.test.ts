import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveAssignmentTransitionTimestamps,
  preflightDashboardActionDedupeKey,
  preflightSlotBlocksNewEnqueue,
  reconcilePreflightDashboardAction,
  resolvePreflightDashboardActionSeverity,
  resolvePreflightDashboardActionStatus,
  resolvePreflightExpiresAt,
} from "./scheduled-session-preflight.ts";

test("preflightSlotBlocksNewEnqueue blocks terminal and in-flight statuses", () => {
  assert.equal(preflightSlotBlocksNewEnqueue("preflight_ready"), true);
  assert.equal(preflightSlotBlocksNewEnqueue("preflight_running"), true);
  assert.equal(preflightSlotBlocksNewEnqueue("preflight_blocked"), true);
  assert.equal(preflightSlotBlocksNewEnqueue("preflight_due"), false);
  assert.equal(preflightSlotBlocksNewEnqueue(null), false);
});

test("resolvePreflightExpiresAt uses session_start for T-10 preflight", () => {
  const timestamps = deriveAssignmentTransitionTimestamps(
    "2026-07-08T22:00:00.000Z",
    "2026-07-09T04:00:00.000Z",
  );
  assert.ok(timestamps);
  assert.equal(resolvePreflightExpiresAt(timestamps), timestamps.session_start);
});

test("resolvePreflightExpiresAt uses business_action_deadline for late preflight", () => {
  const timestamps = deriveAssignmentTransitionTimestamps(
    "2026-07-08T22:00:00.000Z",
    "2026-07-09T04:00:00.000Z",
  );
  assert.ok(timestamps);
  assert.equal(
    resolvePreflightExpiresAt(timestamps, { late_preflight: true }),
    timestamps.business_action_deadline,
  );
});

test("resolvePreflightDashboardActionStatus maps to statuses accepted by the RPC", () => {
  assert.equal(resolvePreflightDashboardActionStatus("preflight_ready"), "resolved");
  assert.equal(resolvePreflightDashboardActionStatus("preflight_expired"), "resolved");
  assert.equal(resolvePreflightDashboardActionStatus("preflight_invalidated"), "resolved");
  assert.equal(resolvePreflightDashboardActionStatus("preflight_blocked"), "pending");
});

test("resolvePreflightDashboardActionSeverity maps identity blocks to error", () => {
  assert.equal(resolvePreflightDashboardActionSeverity("preflight_blocked", "own_profile_open_failed"), "error");
  assert.equal(resolvePreflightDashboardActionSeverity("preflight_blocked", "active_instagram_account_mismatch"), "error");
  assert.equal(resolvePreflightDashboardActionSeverity("preflight_blocked", "login_challenge"), "error");
  assert.equal(resolvePreflightDashboardActionSeverity("preflight_blocked", "device_serial_missing"), "warning");
  assert.equal(resolvePreflightDashboardActionSeverity("preflight_ready", null), "info");
});

function makeReconcileSupabase(activeActionRows: Array<Record<string, unknown>> = []) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    limit: () => Promise.resolve({ data: activeActionRows, error: null }),
  };
  return {
    rpcCalls,
    client: {
      from: () => builder,
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return { data: null, error: null };
      },
    },
  };
}

test("reconcilePreflightDashboardAction resolves active CP4 action on terminal preflight", async () => {
  const supabase = makeReconcileSupabase([{ id: "action-1", status: "pending" }]);

  await reconcilePreflightDashboardAction(supabase.client, {
    accountId: "acct-1",
    assignmentId: "assign-1",
    startsAt: "2026-07-08T22:00:00.000Z",
    terminalStatus: "preflight_expired",
    reasonCode: "preflight_start_window_elapsed",
    source: "schedule_session_cron",
  });

  assert.equal(supabase.rpcCalls.length, 1);
  assert.equal(supabase.rpcCalls[0]?.name, "transition_account_dashboard_action");
  assert.equal(supabase.rpcCalls[0]?.args.p_action_id, "action-1");
  assert.equal(supabase.rpcCalls[0]?.args.p_new_status, "resolved");
  assert.equal(
    supabase.rpcCalls[0]?.args.p_reason,
    "preflight_terminal:preflight_expired:preflight_start_window_elapsed",
  );
});

test("reconcilePreflightDashboardAction skips resolution when no active action exists", async () => {
  const supabase = makeReconcileSupabase([]);

  await reconcilePreflightDashboardAction(supabase.client, {
    accountId: "acct-1",
    assignmentId: "assign-1",
    startsAt: "2026-07-08T22:00:00.000Z",
    terminalStatus: "preflight_ready",
  });

  assert.equal(supabase.rpcCalls.length, 0);
});

test("reconcilePreflightDashboardAction marks blocked preflight as pending with real reason", async () => {
  const supabase = makeReconcileSupabase();

  await reconcilePreflightDashboardAction(supabase.client, {
    accountId: "acct-1",
    assignmentId: "assign-1",
    startsAt: "2026-07-08T22:00:00.000Z",
    terminalStatus: "preflight_blocked",
    reasonCode: "own_profile_open_failed",
  });

  assert.equal(supabase.rpcCalls.length, 1);
  assert.equal(supabase.rpcCalls[0]?.name, "upsert_account_dashboard_action");
  assert.equal(supabase.rpcCalls[0]?.args.p_status, "pending");
  assert.equal(supabase.rpcCalls[0]?.args.p_requires_client_action, true);
  assert.equal(supabase.rpcCalls[0]?.args.p_severity, "error");
  assert.equal(
    supabase.rpcCalls[0]?.args.p_admin_message,
    "Scheduled session preflight blocked: own_profile_open_failed.",
  );
  assert.equal(
    (supabase.rpcCalls[0]?.args.p_metadata as Record<string, unknown>)?.reason_code,
    "own_profile_open_failed",
  );
  assert.equal(
    supabase.rpcCalls[0]?.args.p_dedupe_key,
    preflightDashboardActionDedupeKey("acct-1", "assign-1", "2026-07-08T22:00:00.000Z"),
  );
});
