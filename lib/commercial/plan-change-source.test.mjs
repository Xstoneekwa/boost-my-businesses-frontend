import assert from "node:assert/strict";
import test from "node:test";
import { resolveCanonicalWorkspaceCommercialSource } from "./plan-change-source.ts";

test("canonical source rejects multiple workspace commercial entitlements", () => {
  const sessionA = {
    id: "session-a",
    client_id: "client-1",
    flow_type: "first_purchase",
    status: "checkout_activated_test",
    pack_period_total_cents: 60_000,
    total_period_cents: 60_000,
    activated_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  const sessionB = {
    id: "session-b",
    client_id: "client-1",
    flow_type: "plan_change",
    status: "checkout_activated_test",
    pack_period_total_cents: 90_000,
    total_period_cents: 20_000,
    activated_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
  };

  const result = resolveCanonicalWorkspaceCommercialSource({
    clientId: "client-1",
    sessionsById: new Map([
      ["session-a", sessionA],
      ["session-b", sessionB],
    ]),
    entitlements: [
      {
        id: "ent-a",
        client_id: "client-1",
        checkout_session_id: "session-a",
        plan_key: "pro",
        billing_interval_months: 3,
        status: "entitlement_consumed",
        account_id: null,
        pack_period_total_cents: 60_000,
        updated_at: "2026-01-01T00:00:00.000Z",
        metadata: { workspace_plan: "true" },
      },
      {
        id: "ent-b",
        client_id: "client-1",
        checkout_session_id: "session-b",
        plan_key: "premium",
        billing_interval_months: 3,
        status: "entitlement_consumed",
        account_id: null,
        pack_period_total_cents: 90_000,
        updated_at: "2026-02-01T00:00:00.000Z",
        metadata: { workspace_plan: "true" },
      },
    ],
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "source_ambiguous_entitlement");
});

test("cancelled superseded entitlement is ignored leaving one canonical source", () => {
  const activeSession = {
    id: "session-b",
    client_id: "client-1",
    flow_type: "plan_change",
    status: "checkout_activated_test",
    pack_period_total_cents: 90_000,
    total_period_cents: 20_000,
    activated_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
  };

  const result = resolveCanonicalWorkspaceCommercialSource({
    clientId: "client-1",
    sessionsById: new Map([["session-b", activeSession]]),
    entitlements: [
      {
        id: "ent-old",
        client_id: "client-1",
        checkout_session_id: "session-a",
        plan_key: "pro",
        billing_interval_months: 3,
        status: "entitlement_cancelled",
        account_id: null,
        pack_period_total_cents: 60_000,
        updated_at: "2026-01-01T00:00:00.000Z",
        metadata: { superseded_at: "2026-02-01T00:00:00.000Z" },
      },
      {
        id: "ent-b",
        client_id: "client-1",
        checkout_session_id: "session-b",
        plan_key: "premium",
        billing_interval_months: 3,
        status: "entitlement_consumed",
        account_id: null,
        pack_period_total_cents: 90_000,
        updated_at: "2026-02-01T00:00:00.000Z",
        metadata: { workspace_plan: "true", period_end_at: "2026-04-01T00:00:00.000Z" },
      },
    ],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.entitlement.id, "ent-b");
    assert.equal(result.session.id, "session-b");
  }
});
