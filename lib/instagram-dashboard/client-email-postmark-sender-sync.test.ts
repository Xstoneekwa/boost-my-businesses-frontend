import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPostmarkSenderSyncCacheForTests,
  projectPostmarkSenderSyncStatus,
  refreshPostmarkSenderIdentities,
} from "./client-email-postmark-sender-sync.ts";

test("refreshPostmarkSenderIdentities rejects missing account token without provider call", async () => {
  let called = false;
  const result = await refreshPostmarkSenderIdentities({}, async () => {
    called = true;
    return new Response("{}", { status: 200 });
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "account_token_missing");
    assert.match(result.message, /not configured/i);
  }
  assert.equal(called, false);
});

test("refreshPostmarkSenderIdentities maps confirmed Postmark senders only", async () => {
  clearPostmarkSenderSyncCacheForTests();
  const result = await refreshPostmarkSenderIdentities(
    { POSTMARK_ACCOUNT_TOKEN: "account-token" },
    async (_url, init) => {
      assert.equal((init?.headers as Record<string, string>)["X-Postmark-Account-Token"], "account-token");
      assert.doesNotMatch(JSON.stringify(init?.headers ?? {}), /Server-Token/);
      return new Response(JSON.stringify({
        Senders: [
          { EmailAddress: "growth@boostmybusinesses.com", Name: "Growth", Confirmed: true },
          { EmailAddress: "pending@boostmybusinesses.com", Name: "Pending", Confirmed: false },
        ],
      }), { status: 200 });
    },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.confirmedIdentities.length, 1);
    assert.equal(result.confirmedIdentities[0]?.email, "growth@boostmybusinesses.com");
  }
});

test("projectPostmarkSenderSyncStatus never exposes tokens", () => {
  clearPostmarkSenderSyncCacheForTests();
  const status = projectPostmarkSenderSyncStatus({ accountTokenConfigured: true });
  assert.match(JSON.stringify(status), /not_refreshed|Refresh sender identities/);
  assert.doesNotMatch(JSON.stringify(status), /account-token|POSTMARK_ACCOUNT_TOKEN|X-Postmark-Account-Token/i);
});
