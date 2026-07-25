import assert from "node:assert/strict";
import test from "node:test";

import {
  isSocialProfileSnapshotAccountCollectible,
  processClaimedSocialProfileSnapshotJobs,
} from "./social-profile-snapshot-service.ts";

test("collection follows lifecycle, not scheduler or run status", () => {
  for (const status of ["active", "inactive", "paused", "manual"]) {
    assert.equal(isSocialProfileSnapshotAccountCollectible({
      id: `account-${status}`,
      username: `account_${status}`,
      admin_lifecycle_status: "active",
      status,
    }), true, status);
  }
  for (const lifecycle of ["archived", "trashed", "deleted"]) {
    assert.equal(isSocialProfileSnapshotAccountCollectible({
      id: `account-${lifecycle}`,
      username: `account_${lifecycle}`,
      admin_lifecycle_status: lifecycle,
      status: "active",
    }), false, lifecycle);
  }
});
function supabaseRecorder() {
  const updates = [];
  return {
    updates,
    from() {
      return {
        update(payload) {
          updates.push(payload);
          return {
            async eq() { return { error: null }; },
            async in() { return { error: null }; },
          };
        },
      };
    },
  };
}

test("one provider failure is terminalized per job and does not abort the batch", async () => {
  const supabase = supabaseRecorder();
  let calls = 0;
  const found = {
    ok: true,
    status: "found",
    input_username: "second",
    canonical_username: "second",
    instagram_user_id: null,
    external_profile_id: null,
    avatar_url: null,
    is_private: false,
    is_verified: false,
    followers_count: 12,
    following_count: 34,
    posts_count: 5,
    reason: "found",
    checked_at: "2026-07-25T12:00:00.000Z",
    metadata: { provider_mode: "searchapi" },
  };
  const result = await processClaimedSocialProfileSnapshotJobs({
    jobs: [
      { id: "job-1", account_id: "account-1", username_normalized: "first", source_trigger: "daily_fallback", attempts: 1 },
      { id: "job-2", account_id: "account-2", username_normalized: "second", source_trigger: "daily_fallback", attempts: 1 },
    ],
    maxProviderCalls: 2,
    supabase,
    lookup: async () => {
      calls += 1;
      if (calls === 1) throw new Error("redacted provider failure");
      return found;
    },
    persist: async ({ accountId }) => ({
      ok: true,
      created: true,
      row: {
        account_id: accountId,
        followers_count: 12,
        following_count: 34,
        posts_count: 5,
        observed_at: found.checked_at,
      },
    }),
    pause: async () => undefined,
  });
  assert.equal(result.processed, 2);
  assert.equal(result.failedRetryable, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(result.providerCalls, 2);
  assert.equal(supabase.updates.length, 2);
  assert.equal(supabase.updates[0].status, "queued");
  assert.equal(supabase.updates[1].status, "succeeded");
});
