import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveAssignmentTransitionTimestamps,
  preflightDashboardActionDedupeKey,
  reconcilePreflightDashboardAction,
  resolvePreflightDashboardActionStatus,
  resolvePreflightExpiresAt,
} from "./scheduled-session-preflight.ts";

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

test("resolvePreflightDashboardActionStatus keeps preflight_blocked non-retryable as action_required", () => {
  assert.equal(resolvePreflightDashboardActionStatus("preflight_ready"), "completed");
  assert.equal(resolvePreflightDashboardActionStatus("preflight_expired"), "completed");
  assert.equal(resolvePreflightDashboardActionStatus("preflight_blocked"), "action_required");
});

test("reconcilePreflightDashboardAction resolves CP4 dashboard action on terminal preflight", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
  };

  await reconcilePreflightDashboardAction(supabase, {
    accountId: "acct-1",
    assignmentId: "assign-1",
    startsAt: "2026-07-08T22:00:00.000Z",
    terminalStatus: "preflight_expired",
    reasonCode: "preflight_start_window_elapsed",
    source: "schedule_session_cron",
  });

  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0]?.name, "upsert_account_dashboard_action");
  assert.equal(rpcCalls[0]?.args.p_status, "completed");
  assert.equal(
    rpcCalls[0]?.args.p_dedupe_key,
    preflightDashboardActionDedupeKey("acct-1", "assign-1", "2026-07-08T22:00:00.000Z"),
  );
});

test("reconcilePreflightDashboardAction marks blocked preflight as action_required", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
  };

  await reconcilePreflightDashboardAction(supabase, {
    accountId: "acct-1",
    assignmentId: "assign-1",
    startsAt: "2026-07-08T22:00:00.000Z",
    terminalStatus: "preflight_blocked",
    reasonCode: "identity_mismatch",
  });

  assert.equal(rpcCalls[0]?.args.p_status, "action_required");
  assert.equal(rpcCalls[0]?.args.p_requires_client_action, true);
});
