import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isLifecycleTerminalizeOperation,
  materializeClientEmailOutboxCandidateInternal,
  projectTerminalizeLifecycleEpisodeRpcPayload,
  resolveStrictMaterializeOperation,
  TERMINALIZE_CLIENT_EMAIL_LIFECYCLE_EPISODE_RPC,
  type MaterializeCandidateCommand,
} from "./client-email-outbox-materializer.ts";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260815194227_client_email_lifecycle_episode_terminalization_v1.sql", import.meta.url),
  "utf8",
);

function buildTerminalizeCommand(
  operation: "close_lifecycle_episode" | "cancel_lifecycle_episode" = "close_lifecycle_episode",
): MaterializeCandidateCommand {
  return {
    accountId: "account-1",
    clientId: "client-1",
    category: "account_paused",
    operation,
    decision: operation === "close_lifecycle_episode" ? "would_close_episode" : "would_cancel_episode",
    parentEpisodeKey: "episode-key",
    parentId: "episode-1",
    parentType: "lifecycle_episode",
    startedAt: "2026-08-15T12:30:00.000Z",
    sourceActionId: null,
    eligibleTargetCountAtStart: null,
    recipientEmail: null,
    idempotencyKey: null,
    configVersion: 1,
    businessIdentity: null,
    intentSnapshot: null,
  };
}

test("close and cancel decisions map only with an exact parent", () => {
  assert.equal(resolveStrictMaterializeOperation({
    category: "account_paused", decision: "would_close_episode", reminderIndex: null, parentId: "episode-1",
  }), "close_lifecycle_episode");
  assert.equal(resolveStrictMaterializeOperation({
    category: "account_paused", decision: "would_cancel_episode", reminderIndex: null, parentId: "episode-1",
  }), "cancel_lifecycle_episode");
  assert.equal(resolveStrictMaterializeOperation({
    category: "account_paused", decision: "would_close_episode", reminderIndex: null, parentId: null,
  }), null);
});

test("terminalization payload contains identity and no recipient or provider fields", () => {
  const payload = projectTerminalizeLifecycleEpisodeRpcPayload(buildTerminalizeCommand());
  assert.deepEqual(payload, {
    p_account_id: "account-1", p_client_id: "client-1", p_category: "account_paused",
    p_operation: "close_lifecycle_episode", p_parent_episode_key: "episode-key", p_parent_id: "episode-1",
  });
  assert.doesNotMatch(JSON.stringify(payload), /recipient|provider|template/i);
  assert.equal(isLifecycleTerminalizeOperation("close_lifecycle_episode"), true);
  assert.equal(TERMINALIZE_CLIENT_EMAIL_LIFECYCLE_EPISODE_RPC, "terminalize_client_email_lifecycle_episode_v1");
});

test("terminalization routes to the dedicated RPC and remains provider-free", async () => {
  const calls: Array<{ name: string; payload: unknown }> = [];
  const result = await materializeClientEmailOutboxCandidateInternal({
    rpc: async (name: string, payload: unknown) => {
      calls.push({ name, payload });
      return {
        data: {
          ok: true,
          parent: { id: "episode-1", kind: "lifecycle_episode", created: false },
          intent: null,
        },
        error: null,
      };
    },
  }, buildTerminalizeCommand());

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, TERMINALIZE_CLIENT_EMAIL_LIFECYCLE_EPISODE_RPC);
  assert.doesNotMatch(JSON.stringify(calls[0]?.payload), /recipient|provider|template/i);
});

test("migration is service-role only, idempotent, and preserves ambiguous or sent intents", () => {
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /status in \('pending', 'scheduled', 'claimed'\)/i);
  assert.doesNotMatch(migration, /status in \([^)]*dispatch_uncertain/i);
  assert.match(migration, /if v_episode\.status = 'active'/i);
  assert.match(migration, /'idempotent', not v_changed/i);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
  assert.match(migration, /revoke all[\s\S]*from authenticated/i);
});
