import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSuppressionReason,
  isDispatchEligibleDecision,
  pickSingleEffectiveRowForCategory,
  resolveWinningCategoryForAccount,
  selectEffectiveOutboxCandidates,
} from "./client-email-lifecycle-outbox-precedence.ts";
import type { ClientEmailOutboxPlanRow } from "./client-email-lifecycle-outbox-plan.ts";

function row(
  overrides: Partial<ClientEmailOutboxPlanRow> & Pick<ClientEmailOutboxPlanRow, "accountId" | "category" | "decision">,
): ClientEmailOutboxPlanRow {
  return {
    clientId: "client-1",
    instagramUsername: "user1",
    clientLabel: "Client",
    clientEmailMasked: "c***@example.com",
    parentType: null,
    parentKey: null,
    parentId: null,
    trigger: null,
    reminderIndex: null,
    businessState: "active",
    reason: "test",
    idempotencyKey: null,
    activeTemplateId: "tpl-1",
    activeTemplateVersion: 1,
    fromEmailSnapshot: "growth@boostmybusinesses.com",
    supportEmailSnapshot: "growth@boostmybusinesses.com",
    configVersion: 1,
    futureIntentSnapshot: null,
    ...overrides,
  };
}

test("account canceled suppresses needs-more and needs assistance", () => {
  const selection = selectEffectiveOutboxCandidates([
    row({ accountId: "a1", category: "account_canceled", decision: "blocked_legacy_pre_watermark" }),
    row({ accountId: "a1", category: "needs_more_target_accounts", decision: "no_action", reason: "signal active" }),
    row({ accountId: "a1", category: "needs_assistance", decision: "blocked_delivery_gate" }),
  ]);
  assert.equal(selection.effectiveCandidates.length, 1);
  assert.equal(selection.effectiveCandidates[0]?.category, "account_canceled");
  assert.equal(selection.suppressedCandidates.length, 2);
  assert.equal(selection.suppressedCandidates.every((item) => item.dispatchEligible === false), true);
  assert.match(selection.suppressedCandidates[0]?.suppressionReason ?? "", /account canceled takes precedence/i);
});

test("account paused suppresses needs assistance and needs-more", () => {
  const selection = selectEffectiveOutboxCandidates([
    row({ accountId: "a1", category: "account_paused", decision: "would_create_initial_intent", trigger: "automatic_initial", reminderIndex: 0 }),
    row({ accountId: "a1", category: "needs_assistance", decision: "blocked_missing_client_email" }),
    row({ accountId: "a1", category: "needs_more_target_accounts", decision: "would_create_reminder_intent", trigger: "automatic_reminder", reminderIndex: 1 }),
  ]);
  assert.equal(selection.effectiveCandidates[0]?.category, "account_paused");
  assert.equal(selection.suppressedCandidates.length, 2);
});

test("needs assistance suppresses needs-more only", () => {
  const selection = selectEffectiveOutboxCandidates([
    row({ accountId: "a1", category: "needs_assistance", decision: "would_open_episode" }),
    row({ accountId: "a1", category: "needs_more_target_accounts", decision: "blocked_legacy_pre_watermark" }),
  ]);
  assert.equal(selection.effectiveCandidates[0]?.category, "needs_assistance");
  assert.equal(selection.suppressedCandidates.length, 1);
  assert.equal(selection.suppressedCandidates[0]?.category, "needs_more_target_accounts");
});

test("active account keeps needs-more as effective candidate", () => {
  const selection = selectEffectiveOutboxCandidates([
    row({ accountId: "a1", category: "needs_more_target_accounts", decision: "would_create_initial_intent", trigger: "automatic_initial", reminderIndex: 0 }),
  ]);
  assert.equal(selection.effectiveCandidates.length, 1);
  assert.equal(selection.effectiveCandidates[0]?.category, "needs_more_target_accounts");
  assert.equal(selection.suppressedCandidates.length, 0);
});

test("duplicate diagnostics collapse to one effective row per account", () => {
  const selection = selectEffectiveOutboxCandidates([
    row({ accountId: "a1", category: "account_paused", decision: "blocked_legacy_pre_watermark", parentKey: "k1" }),
    row({ accountId: "a1", category: "account_paused", decision: "blocked_legacy_pre_watermark", parentKey: "k1" }),
  ]);
  assert.equal(selection.effectiveCandidates.length, 1);
});

test("suppressed candidate never carries dispatch eligibility", () => {
  const selection = selectEffectiveOutboxCandidates([
    row({ accountId: "a1", category: "account_canceled", decision: "would_create_initial_intent", trigger: "automatic_initial", reminderIndex: 0 }),
    row({ accountId: "a1", category: "needs_more_target_accounts", decision: "would_create_reminder_intent", trigger: "automatic_reminder", reminderIndex: 2 }),
  ]);
  const suppressed = selection.suppressedCandidates[0];
  assert.equal(suppressed?.dispatchEligible, false);
  assert.equal(suppressed?.idempotencyKey, null);
});

test("historical cancel before watermark stays single effective blocked_legacy_pre_watermark", () => {
  const selection = selectEffectiveOutboxCandidates([
    row({ accountId: "a1", category: "account_canceled", decision: "blocked_legacy_pre_watermark" }),
    row({ accountId: "a1", category: "needs_more_target_accounts", decision: "no_action", reason: "eligible=5" }),
  ]);
  assert.equal(selection.effectiveCandidates[0]?.decision, "blocked_legacy_pre_watermark");
  assert.equal(selection.suppressedCandidates.length, 1);
});

test("resolveWinningCategoryForAccount respects precedence order", () => {
  const winner = resolveWinningCategoryForAccount([
    row({ accountId: "a1", category: "needs_more_target_accounts", decision: "no_action" }),
    row({ accountId: "a1", category: "account_paused", decision: "no_action" }),
  ]);
  assert.equal(winner, "account_paused");
});

test("pickSingleEffectiveRowForCategory prefers intent decisions", () => {
  const picked = pickSingleEffectiveRowForCategory([
    row({ accountId: "a1", category: "needs_more_target_accounts", decision: "would_open_episode" }),
    row({ accountId: "a1", category: "needs_more_target_accounts", decision: "would_create_initial_intent", trigger: "automatic_initial", reminderIndex: 0 }),
  ]);
  assert.equal(picked?.decision, "would_create_initial_intent");
});

test("isDispatchEligibleDecision is false for blocked and suppressed paths", () => {
  assert.equal(isDispatchEligibleDecision("would_create_initial_intent"), true);
  assert.equal(isDispatchEligibleDecision("blocked_delivery_gate"), false);
  assert.equal(formatSuppressionReason("needs_more_target_accounts", "account_canceled"), "needs more target accounts was suppressed because account canceled takes precedence for this account in the combined outbox.");
});
