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

test("refreshPostmarkSenderIdentities uses SenderSignatures with required count/offset", async () => {
  clearPostmarkSenderSyncCacheForTests();
  let requestUrl = "";
  const result = await refreshPostmarkSenderIdentities(
    { POSTMARK_ACCOUNT_TOKEN: "account-token" },
    async (url, init) => {
      requestUrl = String(url);
      assert.equal((init?.headers as Record<string, string>)["X-Postmark-Account-Token"], "account-token");
      assert.doesNotMatch(JSON.stringify(init?.headers ?? {}), /Server-Token/);
      return new Response(JSON.stringify({
        TotalCount: 2,
        SenderSignatures: [
          { EmailAddress: "growth@boostmybusinesses.com", Name: "Growth", Confirmed: true },
          { EmailAddress: "pending@boostmybusinesses.com", Name: "Pending", Confirmed: false },
        ],
      }), { status: 200 });
    },
  );
  assert.match(requestUrl, /count=500/);
  assert.match(requestUrl, /offset=0/);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.confirmedIdentities.length, 1);
    assert.equal(result.confirmedIdentities[0]?.email, "growth@boostmybusinesses.com");
  }
});

test("401/403 Postmark responses map to invalid_credentials without token leak", async () => {
  clearPostmarkSenderSyncCacheForTests();
  const result = await refreshPostmarkSenderIdentities(
    { POSTMARK_ACCOUNT_TOKEN: "account-token" },
    async () => new Response(JSON.stringify({ Message: "Invalid token account-token-secret" }), { status: 401 }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "invalid_credentials");
    assert.doesNotMatch(result.message, /account-token-secret/);
  }
});

test("provider failures map to provider_unavailable", async () => {
  clearPostmarkSenderSyncCacheForTests();
  const result = await refreshPostmarkSenderIdentities(
    { POSTMARK_ACCOUNT_TOKEN: "account-token" },
    async () => new Response(JSON.stringify({ Message: "Parameter count missing" }), { status: 422 }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "provider_unavailable");
});

test("projectPostmarkSenderSyncStatus never exposes tokens", () => {
  clearPostmarkSenderSyncCacheForTests();
  const status = projectPostmarkSenderSyncStatus({ accountTokenConfigured: true });
  assert.match(JSON.stringify(status), /not_refreshed|Refresh sender identities/);
  assert.doesNotMatch(JSON.stringify(status), /account-token|POSTMARK_ACCOUNT_TOKEN|X-Postmark-Account-Token/i);
});

test("not_refreshed is distinct from not_configured when token is present", () => {
  clearPostmarkSenderSyncCacheForTests();
  const status = projectPostmarkSenderSyncStatus({ accountTokenConfigured: true });
  assert.equal(status.status, "not_refreshed");
});
