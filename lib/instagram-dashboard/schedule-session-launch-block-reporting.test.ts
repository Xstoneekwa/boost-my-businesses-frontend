import assert from "node:assert/strict";
import test from "node:test";

import {
  REPORTABLE_SCHEDULER_LAUNCH_BLOCK_REASONS,
  schedulerLaunchBlockDedupeKey,
  shouldReportSchedulerLaunchBlock,
  reportSchedulerLaunchBlock,
  SCHEDULER_LAUNCH_BLOCK_ACTION_TYPE,
} from "./schedule-session-launch-block-reporting.ts";

test("welcome_real_send_disabled is reportable", () => {
  assert.equal(shouldReportSchedulerLaunchBlock("welcome_real_send_disabled"), true);
});

test("transient scheduler blocks are not reportable", () => {
  assert.equal(shouldReportSchedulerLaunchBlock("phone_busy"), false);
  assert.equal(shouldReportSchedulerLaunchBlock("device_heartbeat_stale"), false);
  assert.equal(shouldReportSchedulerLaunchBlock("operator_stop_suppressed"), false);
  assert.equal(shouldReportSchedulerLaunchBlock("resume_plan_missing"), false);
  assert.equal(shouldReportSchedulerLaunchBlock("late_preflight_too_close_to_deadline"), false);
});

test("dedupe key is stable per account window and reason", () => {
  const key = schedulerLaunchBlockDedupeKey({
    accountId: "acct-1",
    assignmentId: "assign-1",
    startsAt: "2026-07-08T10:00:00.000Z",
    reasonCode: "welcome_real_send_disabled",
  });
  assert.equal(
    key,
    "account:acct-1:scheduler_launch_block:welcome_real_send_disabled:assign-1:2026-07-08T10:00:00.000Z",
  );
});

test("reportSchedulerLaunchBlock upserts dashboard action once and dedupes notification", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const existingActions: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, "account_dashboard_actions");
      return {
        select() {
          return {
            eq(_column: string, dedupeKey: string) {
              return {
                async limit() {
                  const row = existingActions.find((entry) => entry.dedupe_key === dedupeKey) ?? null;
                  return { data: row ? [row] : [], error: null };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "upsert_account_dashboard_action") {
        existingActions.push({ dedupe_key: args.p_dedupe_key, id: "action-1" });
        return { data: { id: "action-1" }, error: null };
      }
      return { data: null, error: null };
    },
  };

  process.env.SCHEDULER_LAUNCH_BLOCK_NOTIFICATIONS_ENABLED = "false";

  const first = await reportSchedulerLaunchBlock(supabase, {
    accountId: "acct-1",
    assignmentId: "assign-1",
    startsAt: "2026-07-08T10:00:00.000Z",
    endsAt: "2026-07-08T16:00:00.000Z",
    reason: "welcome_real_send_disabled",
    username: "i_m_your_traker",
  });
  assert.equal(first.reported, true);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "upsert_account_dashboard_action");
  assert.equal(rpcCalls[0].args.p_action_type, SCHEDULER_LAUNCH_BLOCK_ACTION_TYPE);
  assert.equal((rpcCalls[0].args.p_metadata as Record<string, unknown>).source, "schedule_session_cron");

  const second = await reportSchedulerLaunchBlock(supabase, {
    accountId: "acct-1",
    assignmentId: "assign-1",
    startsAt: "2026-07-08T10:00:00.000Z",
    endsAt: "2026-07-08T16:00:00.000Z",
    reason: "welcome_real_send_disabled",
    username: "i_m_your_traker",
  });
  assert.equal(second.reported, true);
  assert.equal(rpcCalls.length, 2);
  assert.equal(second.notified, false);
});

test("reportable reason contract includes config blockers", () => {
  assert.ok(REPORTABLE_SCHEDULER_LAUNCH_BLOCK_REASONS.has("welcome_real_send_disabled"));
  assert.ok(REPORTABLE_SCHEDULER_LAUNCH_BLOCK_REASONS.has("late_preflight_blocked"));
  assert.ok(REPORTABLE_SCHEDULER_LAUNCH_BLOCK_REASONS.has("credentials_review_required"));
});
