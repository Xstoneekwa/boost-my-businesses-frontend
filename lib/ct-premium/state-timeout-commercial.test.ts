import assert from "node:assert/strict";
import test from "node:test";
import { applyCommercialTransition } from "./commercial.ts";
import { CtDomainError } from "./errors.ts";
import { CT_BATCH_TRANSITIONS, transitionBatch, transitionProposal } from "./state-machine.ts";
import { FixedClock, pendingProposal, premiumCommercial, readyRuntime, reviewBatch } from "./test-helpers.ts";
import { evaluateExpiredBatch } from "./timeout.ts";

test("documented batch transitions all produce immutable events", () => {
  for (const [action, sources] of Object.entries(CT_BATCH_TRANSITIONS)) {
    for (const source of sources) {
      const original = reviewBatch({ status: source });
      const result = transitionBatch({ batch: original, action: action as keyof typeof CT_BATCH_TRANSITIONS, actorId: "operator_fixture", source: "operator", clock: new FixedClock("2026-07-02T00:00:00.000Z") });
      assert.equal(original.status, source);
      assert.equal(result.events.length, 1);
    }
  }
  assert.throws(() => transitionBatch({ batch: reviewBatch({ status: "completed" }), action: "markReady", actorId: "operator", source: "operator", clock: new FixedClock("2026-07-02T00:00:00.000Z") }), (error) => error instanceof CtDomainError && error.code === "invalid_transition");
});

test("proposal state machine prevents rejected proposal reactivation", () => {
  const rejected = transitionProposal({ batch: reviewBatch(), proposal: pendingProposal(), action: "rejectProposal", actorId: "client_fixture", source: "client", clock: new FixedClock("2026-07-02T00:00:00.000Z"), reasonCode: "client_rejected" }).proposal;
  assert.throws(() => transitionProposal({ batch: reviewBatch(), proposal: rejected, action: "autoAcceptEligible", actorId: "system", source: "system_timeout", clock: new FixedClock("2026-07-06T00:00:00.000Z"), reasonCode: "timeout" }), (error) => error instanceof CtDomainError && error.code === "proposal_not_pending");
});

test("J+5 is inactive before expiry and triggers exactly at expiry", () => {
  const before = evaluateExpiredBatch({ batch: reviewBatch(), proposals: [pendingProposal()], commercial: premiumCommercial(), runtime: readyRuntime(), revalidation: [{ proposalId: pendingProposal().id, eligible: true, reasonCode: "eligible" }], clock: new FixedClock("2026-07-05T23:59:59.999Z") });
  assert.equal(before.actions.length, 0);
  const exact = evaluateExpiredBatch({ batch: reviewBatch(), proposals: [pendingProposal()], commercial: premiumCommercial(), runtime: readyRuntime(), revalidation: [{ proposalId: pendingProposal().id, eligible: true, reasonCode: "eligible" }], clock: new FixedClock("2026-07-06T00:00:00.000Z") });
  assert.equal(exact.proposals[0].status, "auto_accepted");
  assert.equal(exact.batch.status, "auto_validation_pending");
});

test("timeout ignores rejected, invalidates blacklist/duplicates and is idempotent on retry", () => {
  const rejected = pendingProposal({ status: "rejected", decision: { source: "client", outcome: "rejected", actorId: "client", decidedAt: "2026-07-02T00:00:00.000Z", reasonCode: "client_rejected" } });
  const pending = pendingProposal({ id: "proposal_fixture_2" as typeof rejected.id, normalizedUsername: "blacklisted_fixture" });
  const first = evaluateExpiredBatch({ batch: reviewBatch({ proposalIds: [rejected.id, pending.id] }), proposals: [rejected, pending], commercial: premiumCommercial(), runtime: readyRuntime(), revalidation: [{ proposalId: pending.id, eligible: false, reasonCode: "blacklisted" }], clock: new FixedClock("2026-07-07T00:00:00.000Z") });
  assert.equal(first.proposals[0].status, "rejected");
  assert.equal(first.proposals[1].status, "invalidated");
  const retry = evaluateExpiredBatch({ batch: first.batch, proposals: first.proposals, commercial: premiumCommercial(), runtime: readyRuntime(), revalidation: [], clock: new FixedClock("2026-07-07T01:00:00.000Z") });
  assert.equal(retry.actions.length, 0);
  assert.equal(retry.idempotent, true);
});

test("timeout blocks on downgrade, pause, cancel and campaign blocker", () => {
  const cases = [
    { commercial: premiumCommercial({ plan: "pro", premiumEntitlementActive: false }), runtime: readyRuntime(), expected: "premium_required" },
    { commercial: premiumCommercial(), runtime: readyRuntime({ paused: true }), expected: "account_paused" },
    { commercial: premiumCommercial(), runtime: readyRuntime({ canceled: true }), expected: "account_canceled" },
    { commercial: premiumCommercial(), runtime: readyRuntime({ campaignBlocked: true }), expected: "campaign_blocked" },
  ];
  for (const entry of cases) {
    const result = evaluateExpiredBatch({ batch: reviewBatch(), proposals: [pendingProposal()], commercial: entry.commercial, runtime: entry.runtime, revalidation: [], clock: new FixedClock("2026-07-07T00:00:00.000Z") });
    assert.ok(result.blockedReasons.includes(entry.expected));
    assert.equal(result.actions.length, 0);
  }
});

test("commercial downgrade/pause freeze, cancel cancels, reactivation requires a new batch", () => {
  const clock = new FixedClock("2026-07-03T00:00:00.000Z");
  for (const kind of ["downgrade_pro", "downgrade_growth", "pause", "entitlement_expired"] as const) {
    const result = applyCommercialTransition({ kind, batch: reviewBatch(), commercial: premiumCommercial(), runtime: readyRuntime(), clock });
    assert.equal(result.batch.status, "frozen");
    assert.equal(result.actionsAllowed, false);
  }
  assert.equal(applyCommercialTransition({ kind: "cancel", batch: reviewBatch(), commercial: premiumCommercial(), runtime: readyRuntime(), clock }).batch.status, "canceled");
  const reactivated = applyCommercialTransition({ kind: "reactivate_premium", batch: reviewBatch({ status: "frozen" }), commercial: premiumCommercial({ premiumEntitlementActive: false }), runtime: readyRuntime({ paused: true }), clock, newEntitlementId: "entitlement_fixture_new" });
  assert.equal(reactivated.batch.status, "frozen");
  assert.equal(reactivated.requiresNewBatch, true);
});
