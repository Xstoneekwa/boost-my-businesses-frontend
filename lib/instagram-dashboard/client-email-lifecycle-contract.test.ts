import assert from "node:assert/strict";
import test from "node:test";
import {
  planClientEmailLifecyclePreview,
  readClientEmailLifecycleAutomationEnabledAt,
} from "./client-email-lifecycle-contract.ts";

const watermark = new Date("2026-07-01T00:00:00.000Z");

test("historical pause without watermark stays legacy_state_no_backfill", () => {
  const planned = planClientEmailLifecyclePreview({
    category: "account_paused",
    adminLifecycleStatus: "paused",
    automationEnabledAt: null,
    transitionEvidence: {
      message: "account_paused",
      occurredAt: "2026-06-01T12:00:00.000Z",
      source: "ig_action_logs.account_admin_status_changed",
    },
    activeEpisodeStatus: null,
    clientEmailAvailable: true,
  });
  assert.equal(planned.lifecycleDecision, "legacy_state_no_backfill");
  assert.equal(planned.deliveryState, "blocked_missing_transition_evidence");
});

test("historical cancel without post-watermark transition stays legacy_state_no_backfill", () => {
  const planned = planClientEmailLifecyclePreview({
    category: "account_canceled",
    adminLifecycleStatus: "cancelled",
    automationEnabledAt: watermark,
    transitionEvidence: {
      message: "account_cancelled",
      occurredAt: "2026-06-15T12:00:00.000Z",
      source: "ig_action_logs.account_admin_status_changed",
    },
    activeEpisodeStatus: null,
    clientEmailAvailable: true,
  });
  assert.equal(planned.lifecycleDecision, "legacy_state_no_backfill");
});

test("needs assistance historical state without evidence stays legacy_state_no_backfill", () => {
  const planned = planClientEmailLifecyclePreview({
    category: "needs_assistance",
    adminLifecycleStatus: "needs_assistance",
    automationEnabledAt: watermark,
    transitionEvidence: null,
    activeEpisodeStatus: null,
    clientEmailAvailable: true,
  });
  assert.equal(planned.lifecycleDecision, "legacy_state_no_backfill");
  assert.equal(planned.deliveryState, "blocked_missing_transition_evidence");
});

test("post-watermark transition previews would_open_episode_on_future_transition", () => {
  const planned = planClientEmailLifecyclePreview({
    category: "account_paused",
    adminLifecycleStatus: "paused",
    automationEnabledAt: watermark,
    transitionEvidence: {
      message: "account_paused",
      occurredAt: "2026-07-02T09:00:00.000Z",
      source: "ig_action_logs.account_admin_status_changed",
    },
    activeEpisodeStatus: null,
    clientEmailAvailable: true,
  });
  assert.equal(planned.lifecycleDecision, "would_open_episode_on_future_transition");
  assert.equal(planned.deliveryState, "delivery_ready");
});

test("active episode with cleared lifecycle previews would_resolve_episode", () => {
  const planned = planClientEmailLifecyclePreview({
    category: "needs_assistance",
    adminLifecycleStatus: "active",
    automationEnabledAt: watermark,
    transitionEvidence: {
      message: "account_marked_needs_assistance",
      occurredAt: "2026-07-02T09:00:00.000Z",
      source: "ig_action_logs.account_admin_status_changed",
    },
    activeEpisodeStatus: "active",
    clientEmailAvailable: true,
  });
  assert.equal(planned.lifecycleDecision, "would_resolve_episode");
});

test("missing client email blocks delivery without hiding lifecycle state", () => {
  const planned = planClientEmailLifecyclePreview({
    category: "account_paused",
    adminLifecycleStatus: "paused",
    automationEnabledAt: watermark,
    transitionEvidence: {
      message: "account_paused",
      occurredAt: "2026-07-02T09:00:00.000Z",
      source: "ig_action_logs.account_admin_status_changed",
    },
    activeEpisodeStatus: null,
    clientEmailAvailable: false,
  });
  assert.equal(planned.lifecycleDecision, "would_open_episode_on_future_transition");
  assert.equal(planned.deliveryState, "blocked_missing_client_email");
});

test("automation watermark parser accepts ISO timestamps only", () => {
  assert.equal(readClientEmailLifecycleAutomationEnabledAt({}), null);
  assert.ok(readClientEmailLifecycleAutomationEnabledAt({
    CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z",
  }));
});
