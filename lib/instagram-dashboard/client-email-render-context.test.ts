import assert from "node:assert/strict";
import test from "node:test";
import { buildLegacyTransactionalDeliverySettings } from "./client-email-delivery-settings.ts";
import {
  buildCanonicalClientEmailRenderContext,
  localizedAccountStatus,
  resolveClientEmailLocale,
} from "./client-email-render-context.ts";

const deliverySettings = buildLegacyTransactionalDeliverySettings();

function buildContext(overrides: Partial<Parameters<typeof buildCanonicalClientEmailRenderContext>[0]> = {}) {
  return buildCanonicalClientEmailRenderContext({
    category: "account_paused",
    accountId: "account-one",
    clientId: "client-one",
    instagramUsername: "user_one",
    clientLabel: "Client One",
    adminLifecycleStatus: "paused",
    locale: "fr",
    deliverySettings,
    ...overrides,
  });
}

test("canonical lifecycle render context uses the exact account and client without preview data", () => {
  const result = buildContext();
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.values.client_name, "Client One");
  assert.equal(result.values.instagram_username, "user_one");
  assert.equal(result.values.account_status, "En pause");
  assert.match(result.values.dashboard_url, /account=account-one/);
  assert.doesNotMatch(JSON.stringify(result.values), /Acme Growth Co\.|xstonekwa_backup_acc|preview-account/);
});

test("lifecycle status labels are localized from the canonical target state", () => {
  assert.equal(localizedAccountStatus({ category: "account_paused", adminLifecycleStatus: "active", locale: "fr" }), "En pause");
  assert.equal(localizedAccountStatus({ category: "account_paused", adminLifecycleStatus: "paused", locale: "en" }), "Paused");
  assert.equal(localizedAccountStatus({ category: "account_canceled", adminLifecycleStatus: "active", locale: "fr" }), "Résiliée");
  assert.equal(localizedAccountStatus({ category: "account_canceled", adminLifecycleStatus: "cancelled", locale: "en" }), "Cancelled");
  assert.equal(localizedAccountStatus({ category: "needs_more_target_accounts", adminLifecycleStatus: "active", locale: "fr" }), "Active");
});

test("client locale resolution is deterministic and defaults to French", () => {
  assert.equal(resolveClientEmailLocale({ preferred_language: "en-US" }), "en");
  assert.equal(resolveClientEmailLocale({ locale: "fr-FR" }), "fr");
  assert.equal(resolveClientEmailLocale(null), "fr");
});

test("incomplete canonical context fails closed with an explicit stable code", () => {
  const result = buildContext({ accountId: "", clientId: "", instagramUsername: null, clientLabel: null });
  assert.deepEqual(result, {
    ok: false,
    code: "lifecycle_email_render_context_incomplete",
    missing: ["account_id", "client_id", "instagram_username", "client_name"],
  });
});

test("multi-account and multi-tenant render contexts never cross identities", () => {
  const first = buildContext();
  const second = buildContext({
    accountId: "account-two",
    clientId: "tenant-two",
    instagramUsername: "user_two",
    clientLabel: "Client Two",
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;

  assert.equal(first.values.client_name, "Client One");
  assert.equal(first.values.instagram_username, "user_one");
  assert.match(first.values.dashboard_url, /account=account-one/);
  assert.doesNotMatch(JSON.stringify(first.values), /Client Two|user_two|account-two|tenant-two/);
  assert.equal(second.values.client_name, "Client Two");
  assert.equal(second.values.instagram_username, "user_two");
  assert.match(second.values.dashboard_url, /account=account-two/);
  assert.doesNotMatch(JSON.stringify(second.values), /Client One|user_one|account-one|client-one/);
});
