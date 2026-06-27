import assert from "node:assert/strict";
import test from "node:test";
import {
  validateClientEmailIntentParentRefs,
  resolveClientEmailIntentParentType,
} from "./client-email-intent-parent-contract.ts";

test("test intent requires no parent refs", () => {
  const result = validateClientEmailIntentParentRefs({
    intentKind: "test",
    category: "account_paused",
    sequenceId: null,
    lifecycleEpisodeId: null,
  });
  assert.equal(result.valid, true);
  assert.equal(resolveClientEmailIntentParentType({
    intentKind: "test",
    category: "account_paused",
    sequenceId: null,
    lifecycleEpisodeId: null,
  }), null);
});

test("test intent rejects parent refs", () => {
  const result = validateClientEmailIntentParentRefs({
    intentKind: "test",
    category: "account_paused",
    sequenceId: "seq-1",
    lifecycleEpisodeId: null,
  });
  assert.equal(result.valid, false);
});

test("needs_more client intent requires sequence parent only", () => {
  const valid = validateClientEmailIntentParentRefs({
    intentKind: "client",
    category: "needs_more_target_accounts",
    sequenceId: "seq-1",
    lifecycleEpisodeId: null,
  });
  assert.equal(valid.valid, true);
  assert.equal(resolveClientEmailIntentParentType({
    intentKind: "client",
    category: "needs_more_target_accounts",
    sequenceId: "seq-1",
    lifecycleEpisodeId: null,
  }), "sequence");

  const invalid = validateClientEmailIntentParentRefs({
    intentKind: "client",
    category: "needs_more_target_accounts",
    sequenceId: null,
    lifecycleEpisodeId: null,
  });
  assert.equal(invalid.valid, false);
});

test("lifecycle client intent requires lifecycle episode parent only", () => {
  for (const category of ["account_paused", "account_canceled", "needs_assistance"] as const) {
    const valid = validateClientEmailIntentParentRefs({
      intentKind: "client",
      category,
      sequenceId: null,
      lifecycleEpisodeId: "episode-1",
    });
    assert.equal(valid.valid, true);
    assert.equal(resolveClientEmailIntentParentType({
      intentKind: "client",
      category,
      sequenceId: null,
      lifecycleEpisodeId: "episode-1",
    }), "lifecycle_episode");
  }
});

test("client intent cannot reference both parents", () => {
  const result = validateClientEmailIntentParentRefs({
    intentKind: "client",
    category: "account_paused",
    sequenceId: "seq-1",
    lifecycleEpisodeId: "episode-1",
  });
  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.match(result.reason, /both/);
});

test("historical test intents remain valid under parent contract", () => {
  const historicalTests = [
    { intentKind: "test" as const, category: "account_paused" as const, sequenceId: null, lifecycleEpisodeId: null },
    { intentKind: "test" as const, category: "needs_more_target_accounts" as const, sequenceId: null, lifecycleEpisodeId: null },
  ];
  for (const refs of historicalTests) {
    assert.equal(validateClientEmailIntentParentRefs(refs).valid, true);
  }
});
