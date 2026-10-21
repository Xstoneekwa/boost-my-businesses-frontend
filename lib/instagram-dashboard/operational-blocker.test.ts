import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseOperationalBlocker,
  loadCanonicalOperationalBlockers,
  operationalBlockerFromCanonicalIncident,
  operationalBlockerFromDashboardAction,
} from "./operational-blocker.ts";

const restrictionRow = {
  account_id: "11111111-1111-4111-8111-111111111111",
  incident_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  incident_type: "instagram_account_restriction",
  reason_code: "instagram_action_rate_limit",
  severity: "error",
  requires_manual_resolution: true,
  not_before: "2026-09-03T10:00:00.000Z",
};

test("timed restriction date uses canonical business calendar, preserves expiry instant", () => {
  for (const reason_code of ["instagram_action_rate_limit", "preventive_follow_restriction"]) {
    for (const [not_before, day] of [
      ["2026-09-15T22:30:00.000Z", "2026-09-16"],
      ["2026-09-16T00:30:00.000+02:00", "2026-09-16"],
      ["2026-12-31T23:30:00.000Z", "2027-01-01"],
    ]) {
      const blocker = operationalBlockerFromCanonicalIncident({ ...restrictionRow, reason_code, not_before });
      assert.equal(blocker?.label, `Pause until ${day}`);
      assert.equal(blocker?.notBefore, not_before);
    }
  }
});

test("a timed reason cannot give unrelated incident families a timed restriction label", () => {
  for (const incident_type of ["worker_exit_nonzero", "active_instagram_account_mismatch",
    "device_failure", "assignment_problem", "unknown", "manual_pause"]) {
    const blocker = operationalBlockerFromCanonicalIncident({ ...restrictionRow, incident_type });
    assert.doesNotMatch(blocker?.label ?? "", /^Pause until /);
  }
});

test("canonical incident projects backend-owned restriction presentation", () => {
  assert.deepEqual(operationalBlockerFromCanonicalIncident(restrictionRow), {
    category: "instagram_restriction",
    reasonCode: "instagram_action_rate_limit",
    severity: "error",
    blocking: true,
    requiresManualResolution: true,
    notBefore: "2026-09-03T10:00:00.000Z",
    sourceType: "incident",
    sourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    label: "Pause until 2026-09-03",
    detail: "Resume only after the canonical pause and operator review",
  });
});

test("messages-disabled restriction never inherits the generic 48H label", () => {
  const blocker = operationalBlockerFromCanonicalIncident({
    ...restrictionRow,
    reason_code: "instagram_account_restriction_messages_disabled",
    not_before: "2026-10-09T00:00:00.000Z",
  });
  assert.equal(blocker?.label, "Messaging restricted until 2026-10-09");
  assert.equal(blocker?.detail, "Instagram disabled outgoing messages");
  assert.doesNotMatch(blocker?.label ?? "", /48H/i);
});

test("unknown-scope restriction does not invent a duration", () => {
  const blocker = operationalBlockerFromCanonicalIncident({
    ...restrictionRow,
    reason_code: "instagram_account_restriction_unknown_scope",
    not_before: null,
  });
  assert.equal(blocker?.label, "Instagram restriction");
  assert.equal(blocker?.notBefore, null);
});

test("incident-only blocker is projected without a dashboard action", () => {
  const incident = operationalBlockerFromCanonicalIncident(restrictionRow);
  assert.equal(chooseOperationalBlocker(incident, null), incident);
});

test("existing dashboard action blocker remains a presentation source", () => {
  const action = operationalBlockerFromDashboardAction({
    id: "action-1",
    action_type: "operator_review_required",
    blocking_campaign: true,
  });
  assert.equal(action?.sourceType, "dashboard_action");
  assert.equal(action?.blocking, true);
  assert.equal(action?.label, "Operator review required");
});

test("canonical incident outranks a dashboard action deterministically", () => {
  const incident = operationalBlockerFromCanonicalIncident(restrictionRow);
  const action = operationalBlockerFromDashboardAction({
    id: "action-1",
    action_type: "operator_review_required",
    blocking_campaign: true,
  });
  assert.equal(chooseOperationalBlocker(incident, action)?.sourceType, "incident");
});

test("multiple accounts are loaded through one set-based RPC without N+1", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const secondAccount = "22222222-2222-4222-8222-222222222222";
  const supabase = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return {
        data: [
          { ...restrictionRow, source_type: "incident", source_id: restrictionRow.incident_id },
          {
            ...restrictionRow,
            account_id: secondAccount,
            incident_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            source_type: "incident",
            source_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            incident_type: "account_login_required",
            reason_code: "account_login_required",
          },
        ],
        error: null,
      };
    },
  };

  const blockers = await loadCanonicalOperationalBlockers(supabase, [
    restrictionRow.account_id,
    secondAccount,
    restrictionRow.account_id,
  ]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, "canonical_active_operational_blockers_v1");
  assert.deepEqual(calls[0]?.args.p_account_ids, [restrictionRow.account_id, secondAccount]);
  assert.equal(blockers.size, 2);
  assert.equal(blockers.get(secondAccount)?.category, "login");
});

test("the canonical batch loader projects a standalone dashboard action", async () => {
  const blockers = await loadCanonicalOperationalBlockers({
    async rpc() {
      return {
        data: [{
          account_id: restrictionRow.account_id,
          source_type: "dashboard_action",
          source_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          action_type: "review_login_challenge",
          reason_code: "review_login_challenge",
          severity: "warning",
        }],
        error: null,
      };
    },
  }, [restrictionRow.account_id]);
  assert.equal(blockers.get(restrictionRow.account_id)?.sourceType, "dashboard_action");
  assert.equal(blockers.get(restrictionRow.account_id)?.reasonCode, "review_login_challenge");
});

test("empty account batch performs no RPC", async () => {
  let calls = 0;
  const blockers = await loadCanonicalOperationalBlockers({
    async rpc() {
      calls += 1;
      return { data: [], error: null };
    },
  }, []);
  assert.equal(calls, 0);
  assert.equal(blockers.size, 0);
});
