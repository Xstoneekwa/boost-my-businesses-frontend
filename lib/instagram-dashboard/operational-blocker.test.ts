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
    label: "48H pause required",
    detail: "Instagram restricted",
  });
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
          restrictionRow,
          {
            ...restrictionRow,
            account_id: secondAccount,
            incident_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
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
  assert.equal(calls[0]?.name, "canonical_active_blocking_incidents_v1");
  assert.deepEqual(calls[0]?.args.p_account_ids, [restrictionRow.account_id, secondAccount]);
  assert.equal(blockers.size, 2);
  assert.equal(blockers.get(secondAccount)?.category, "login");
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
