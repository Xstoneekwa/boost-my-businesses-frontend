import assert from "node:assert/strict";
import test from "node:test";
import { assertApiScope, CT_PREMIUM_API_PATHS } from "./api-contracts.ts";
import { activateProposal } from "./activation.ts";
import { CT_PREMIUM_EDGE_FIXTURES, CT_PREMIUM_SYNTHETIC_SCOPES, syntheticCommercial, syntheticReviewBatch, syntheticReviewProposals, syntheticRuntime } from "./fixtures.ts";
import { InMemoryCtActivationPort, InMemoryCtEmailPort, InMemoryCtNotificationPort, InMemoryCtStore } from "./memory-adapters.ts";
import { CT_REVIEW_COPY, ctInstagramProfileUrl, projectCtReviewState, projectCtReviewView } from "./review-view-model.ts";
import type { TargetId } from "./types.ts";

test("memory store isolates accounts in the same tenant and rejects stale writes", async () => {
  const scope = CT_PREMIUM_SYNTHETIC_SCOPES.premiumAgency;
  const store = new InMemoryCtStore();
  for (const item of scope.accounts) store.seedScope(scope.tenantId, item.accountId, { commercial: syntheticCommercial(), runtime: syntheticRuntime() });
  const batch = syntheticReviewBatch();
  store.seedScope(batch.tenantId, batch.accountId, { commercial: syntheticCommercial(), runtime: syntheticRuntime(), activeTargets: ["active_fixture"], blacklist: CT_PREMIUM_EDGE_FIXTURES.blacklist });
  await store.save(batch, 0);
  for (const proposal of syntheticReviewProposals().slice(0, 2)) await store.save(proposal, 0);
  assert.equal((await store.listByBatch(batch.tenantId, batch.accountId, batch.id)).length, 2);
  assert.equal((await store.list(scope.tenantId, scope.accounts[1].accountId)).length, 0);
  await assert.rejects(() => store.save({ ...batch, version: 2 }, 0), /batch_version_conflict/);
});

test("notification and email adapters only record in-memory intents", async () => {
  const batch = syntheticReviewBatch();
  const notifications = new InMemoryCtNotificationPort();
  const emails = new InMemoryCtEmailPort();
  await notifications.record({ tenantId: batch.tenantId, accountId: batch.accountId, batchId: batch.id, kind: "batch_ready", createdAt: batch.createdAt });
  await emails.record({ tenantId: batch.tenantId, accountId: batch.accountId, batchId: batch.id, kind: "batch_ready", createdAt: batch.createdAt, locale: "fr" });
  assert.equal(notifications.intents.length, 1);
  assert.equal(emails.intents.length, 1);
});

test("activation adapter is idempotent and simulates partial failure without ig_targets", async () => {
  const batch = syntheticReviewBatch();
  const proposal = syntheticReviewProposals()[0];
  const activation = new InMemoryCtActivationPort();
  activation.setOutcome(proposal.id, { ok: false, reasonCode: "fixture_activation_failure" });
  const input = { tenantId: batch.tenantId, accountId: batch.accountId, batchId: batch.id, proposalId: proposal.id, normalizedUsername: proposal.normalizedUsername, idempotencyKey: "activation_fixture_1" };
  assert.deepEqual(await activation.activate(input), { ok: false, reasonCode: "fixture_activation_failure" });
  await activation.activate(input);
  assert.equal(activation.attempts.length, 1);
  activation.setOutcome(proposal.id, { ok: true, targetId: "target_fixture_success" as TargetId });
  assert.equal((await activation.activate({ ...input, idempotencyKey: "activation_fixture_2" })).ok, true);
});

test("activation service emits explicit activated and activation_failed outcomes", async () => {
  const batch = syntheticReviewBatch();
  const accepted = { ...syntheticReviewProposals(["accepted"])[0], decision: { source: "client" as const, outcome: "accepted" as const, actorId: "client_fixture", decidedAt: "2026-07-03T00:00:00.000Z", reasonCode: "client_accepted" } };
  const activation = new InMemoryCtActivationPort();
  const success = await activateProposal({ batch, proposal: accepted, commercial: syntheticCommercial(), runtime: syntheticRuntime(), port: activation, clock: { now: () => new Date("2026-07-04T00:00:00.000Z") } });
  assert.equal(success.proposal.status, "activated");
  const failingProposal = { ...accepted, id: CT_PREMIUM_EDGE_FIXTURES.partialActivationFailure.failedProposalIds[0] };
  activation.setOutcome(failingProposal.id, { ok: false, reasonCode: "fixture_activation_failure" });
  const failed = await activateProposal({ batch: { ...batch, proposalIds: [failingProposal.id] }, proposal: failingProposal, commercial: syntheticCommercial(), runtime: syntheticRuntime(), port: activation, clock: { now: () => new Date("2026-07-04T00:00:00.000Z") } });
  assert.equal(failed.proposal.status, "activation_failed");
  assert.equal(failed.proposal.decision?.outcome, "accepted");
});

test("API contracts require tenant and account and define no production route implementation", () => {
  const scope = CT_PREMIUM_SYNTHETIC_SCOPES.premiumSingle;
  assert.equal(assertApiScope(scope.accounts[0].accountId, { tenant_id: scope.tenantId, account_id: scope.accounts[0].accountId }), true);
  assert.equal(assertApiScope("another_account", { tenant_id: scope.tenantId, account_id: scope.accounts[0].accountId }), false);
  assert.equal(Object.keys(CT_PREMIUM_API_PATHS).length, 8);
});

test("UI projection covers preparation, review, frozen, canceled, completed, empty and error", () => {
  const proposals = syntheticReviewProposals();
  assert.equal(projectCtReviewState(syntheticReviewBatch("preparing"), proposals), "preparing");
  assert.equal(projectCtReviewState(syntheticReviewBatch(), proposals), "review");
  assert.equal(projectCtReviewState(syntheticReviewBatch("frozen"), proposals), "frozen");
  assert.equal(projectCtReviewState(syntheticReviewBatch("canceled"), proposals), "canceled");
  assert.equal(projectCtReviewState(syntheticReviewBatch("completed"), proposals), "completed");
  assert.equal(projectCtReviewState(null, []), "empty");
  assert.equal(projectCtReviewState(null, [], true), "error");
  assert.equal(projectCtReviewView(syntheticReviewBatch(), proposals, new Date("2026-07-03T00:00:00.000Z")).remainingMs, 3 * 24 * 60 * 60 * 1000);
});

test("FR/EN copy states J+5 revalidation and permanent rejection guarantees", () => {
  assert.match(CT_REVIEW_COPY.fr.timeout, /réévaluées/);
  assert.match(CT_REVIEW_COPY.fr.rejection, /jamais/);
  assert.match(CT_REVIEW_COPY.en.timeout, /reviewed again/);
  assert.match(CT_REVIEW_COPY.en.rejection, /never/);
});

test("proposal usernames resolve to the canonical Instagram profile URL", () => {
  assert.equal(ctInstagramProfileUrl("synthetic_target"), "https://www.instagram.com/synthetic_target/");
});
