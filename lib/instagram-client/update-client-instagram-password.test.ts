import assert from "node:assert/strict";
import test from "node:test";
import { updateClientInstagramPassword } from "./update-client-instagram-password.ts";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const ACTION = "44444444-4444-4444-8444-444444444444";
const INCIDENT = "55555555-5555-4555-8555-555555555555";
const PASSWORD = "candidate-only-secret";

type Row = Record<string, unknown>;

function fakeSupabase(input: { action?: Row | null; account?: Row | null }) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        limit() { return query; },
        async maybeSingle() {
          const source = table === "account_dashboard_actions" ? input.action : input.account;
          if (!source) return { data: null, error: null };
          if (filters.id && source.id !== filters.id) return { data: null, error: null };
          if (filters.account_id && source.account_id !== filters.account_id) return { data: null, error: null };
          return { data: source, error: null };
        },
      };
      return query;
    },
  };
}

function action(overrides: Row = {}) {
  return {
    id: ACTION,
    account_id: ACCOUNT,
    client_id: CLIENT,
    incident_id: INCIDENT,
    action_type: "update_instagram_password",
    status: "pending",
    requires_client_action: true,
    metadata: {},
    ...overrides,
  };
}

function account(overrides: Row = {}) {
  return {
    id: ACCOUNT,
    username: "generic_account",
    status: "active",
    admin_lifecycle_status: "active",
    ...overrides,
  };
}

async function submit(overrides: Partial<Parameters<typeof updateClientInstagramPassword>[0]> = {}) {
  const requests: Row[] = [];
  const result = await updateClientInstagramPassword({
    actorUserId: ACTOR,
    clientId: CLIENT,
    accountId: ACCOUNT,
    actionId: ACTION,
    password: PASSWORD,
    supabase: fakeSupabase({ action: action(), account: account() }) as never,
    credentialsConfig: { url: "https://credentials.invalid", token: "server-only-token" },
    fetcher: (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Row);
      return Response.json({
        ok: true,
        account_id: ACCOUNT,
        action_id: ACTION,
        credentials_version: 2,
        password_status: "write_only",
        idempotent_replay: requests.length > 1,
      });
    }) as typeof fetch,
    ...overrides,
  });
  return { result, requests };
}

test("owner-bound submit forwards one write-only causal request and never starts login", async () => {
  const { result, requests } = await submit();
  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].account_id, ACCOUNT);
  assert.equal(requests[0].action_id, ACTION);
  assert.equal(requests[0].external_request_id, `password-update:${ACTION}`);
  assert.equal((requests[0].metadata_safe as Row).login_after_save, false);
  assert.equal((requests[0].metadata_safe as Row).start_run, false);
  assert.equal(JSON.stringify(result).includes(PASSWORD), false);
});

test("same action retry uses the same idempotency identity", async () => {
  const first = await submit();
  const second = await submit();
  assert.equal(first.requests[0].external_request_id, second.requests[0].external_request_id);
  assert.equal(first.result.ok, true);
  assert.equal(second.result.ok, true);
});

test("wrong tenant is rejected before the credential writer", async () => {
  const { result, requests } = await submit({
    supabase: fakeSupabase({ action: action({ client_id: "66666666-6666-4666-8666-666666666666" }), account: account() }) as never,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "password_update_action_tenant_mismatch");
  assert.equal(requests.length, 0);
});

test("wrong account/action binding is rejected", async () => {
  const { result, requests } = await submit({
    supabase: fakeSupabase({ action: action({ account_id: "77777777-7777-4777-8777-777777777777" }), account: account() }) as never,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "password_update_action_not_found");
  assert.equal(requests.length, 0);
});

test("wrong action type and resolved action are rejected", async () => {
  const wrongType = await submit({
    supabase: fakeSupabase({ action: action({ action_type: "enter_email_verification_code" }), account: account() }) as never,
  });
  assert.equal(wrongType.result.ok, false);
  if (!wrongType.result.ok) assert.equal(wrongType.result.code, "password_update_action_type_invalid");

  const resolved = await submit({
    supabase: fakeSupabase({ action: action({ status: "resolved", requires_client_action: false }), account: account() }) as never,
  });
  assert.equal(resolved.result.ok, false);
  if (!resolved.result.ok) assert.equal(resolved.result.code, "password_update_action_inactive");
});

test("absent password is rejected without calling the writer", async () => {
  const { result, requests } = await submit({ password: "" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "password_invalid");
  assert.equal(requests.length, 0);
});

test("pending_verification permits response-loss replay only", async () => {
  const { result, requests } = await submit({
    supabase: fakeSupabase({
      action: action({ status: "pending_verification", requires_client_action: false }),
      account: account(),
    }) as never,
  });
  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
});
