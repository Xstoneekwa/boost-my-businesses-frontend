import assert from "node:assert/strict";
import test from "node:test";
import { buildTemplatePreview } from "./client-email-template-render.ts";
import { previewClientEmailTemplate } from "./client-email-templates.ts";
import {
  assertNoForbiddenDeliverySettingsSecrets,
  buildClientEmailDemoValues,
  buildIntentDeliverySnapshotFields,
  buildLegacyTransactionalDeliverySettings,
  clearSenderRefreshErrorForTests,
  patchTransactionalDeliverySettings,
  probeTransactionalDeliverySettingsSchema,
  resolveTransactionalDeliverySettings,
  resolveTransactionalUxState,
} from "./client-email-delivery-settings.ts";
import {
  clearPostmarkSenderSyncCacheForTests,
  findConfirmedPostmarkSenderIdentity,
  projectPostmarkSenderSyncStatus,
  readPostmarkAccountTokenConfigured,
  refreshPostmarkSenderIdentities,
} from "./client-email-postmark-sender-sync.ts";
import { resolveClientEmailTransactionalSupportEmail } from "./client-email-transactional-support.ts";

function createSettingsSupabase(input: {
  settings?: Record<string, unknown> | null;
  settingsError?: unknown;
  updateResult?: Record<string, unknown> | null;
  auditError?: unknown;
}) {
  const auditInserts: Record<string, unknown>[] = [];
  return {
    auditInserts,
    supabase: {
      from(table: string) {
        if (table === "transactional_email_delivery_settings") {
          return {
            select() {
              return {
                eq() {
                  return {
                    limit: async () => {
                      if (input.settingsError) return { error: input.settingsError };
                      return { error: null };
                    },
                    maybeSingle: async () => {
                      if (input.settingsError) return { data: null, error: input.settingsError };
                      return { data: input.settings ?? null, error: null };
                    },
                  };
                },
              };
            },
            update(values: Record<string, unknown>) {
              return {
                eq(_key: string, _value: string) {
                  return {
                    eq() {
                      return {
                        select() {
                          return {
                            maybeSingle: async () => ({
                              data: input.updateResult ?? {
                                settings_key: "default",
                                active_from_email: values.active_from_email,
                                support_email: values.support_email,
                                config_version: values.config_version,
                                updated_at: values.updated_at,
                              },
                              error: null,
                            }),
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "transactional_email_delivery_settings_audit") {
          return {
            insert(row: Record<string, unknown>) {
              auditInserts.push(row);
              return Promise.resolve({ error: input.auditError ?? null });
            },
            select() {
              return {
                order() {
                  return {
                    limit: async () => ({ data: [], error: null }),
                  };
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    },
  };
}

test("legacy fallback without migration keeps growth sender and support with zero writes", async () => {
  const { supabase } = createSettingsSupabase({
    settingsError: { message: "Could not find the table 'public.transactional_email_delivery_settings' in the schema cache", code: "PGRST205" },
  });
  const settings = await resolveTransactionalDeliverySettings(supabase as never);
  assert.equal(settings.source, "legacy_default");
  assert.equal(settings.activeFromEmail, "growth@boostmybusinesses.com");
  assert.equal(settings.supportEmail, "growth@boostmybusinesses.com");
  assert.equal(settings.schemaReady, false);
});

test("resolver reads singleton settings when schema is ready", async () => {
  const { supabase } = createSettingsSupabase({
    settings: {
      settings_key: "default",
      active_from_email: "growth@boostmybusinesses.com",
      support_email: "ops@boostmybusinesses.com",
      config_version: 3,
      updated_at: "2026-07-01T12:00:00.000Z",
    },
  });
  const settings = await resolveTransactionalDeliverySettings(supabase as never);
  assert.equal(settings.source, "database");
  assert.equal(settings.supportEmail, "ops@boostmybusinesses.com");
  assert.equal(settings.configVersion, 3);
});

test("support email validation, audit, and preview rendering avoid support@ alias", async () => {
  clearPostmarkSenderSyncCacheForTests();
  const { supabase, auditInserts } = createSettingsSupabase({
    settings: {
      settings_key: "default",
      active_from_email: "growth@boostmybusinesses.com",
      support_email: "growth@boostmybusinesses.com",
      config_version: 2,
      updated_at: "2026-07-01T12:00:00.000Z",
    },
  });

  const invalid = await patchTransactionalDeliverySettings(supabase as never, {
    supportEmail: "not-an-email",
  }, "admin_test");
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.reason, "invalid_support_email");

  const saved = await patchTransactionalDeliverySettings(supabase as never, {
    supportEmail: "helpdesk@boostmybusinesses.com",
    configVersion: 2,
  }, "admin_test");
  assert.equal(saved.ok, true);
  assert.equal(auditInserts.length, 1);

  const settings = saved.ok ? saved.settings : buildLegacyTransactionalDeliverySettings();
  const preview = previewClientEmailTemplate({
    subject: "Help from {{support_email}}",
    bodyText: "Contact {{support_email}}",
    settings,
  });
  assert.equal(preview.ok, true);
  if (preview.ok) {
    assert.match(preview.preview.bodyText, /helpdesk@boostmybusinesses.com/);
    assert.doesNotMatch(preview.preview.bodyText, /support@boostmybusinesses.com/);
  }
});

test("sender changes require confirmed provider identity and reject arbitrary addresses", async () => {
  clearPostmarkSenderSyncCacheForTests();
  const env = { POSTMARK_ACCOUNT_TOKEN: "account-token-test" };

  const { supabase } = createSettingsSupabase({
    settings: {
      settings_key: "default",
      active_from_email: "growth@boostmybusinesses.com",
      support_email: "growth@boostmybusinesses.com",
      config_version: 1,
      updated_at: "2026-07-01T12:00:00.000Z",
    },
  });

  const missingToken = await patchTransactionalDeliverySettings(
    supabase as never,
    { activeFromEmail: "ops@boostmybusinesses.com", confirmed: true, configVersion: 1 },
    "admin_test",
    {},
  );
  assert.equal(missingToken.ok, false);
  if (!missingToken.ok) assert.equal(missingToken.reason, "sender_sync_unavailable");

  await refreshPostmarkSenderIdentities(env, async () => new Response(JSON.stringify({
    SenderSignatures: [
      { EmailAddress: "growth@boostmybusinesses.com", Name: "Growth", Confirmed: true },
      { EmailAddress: "pending@boostmybusinesses.com", Name: "Pending", Confirmed: false },
    ],
  }), { status: 200 }));

  const unconfirmed = await patchTransactionalDeliverySettings(
    supabase as never,
    { activeFromEmail: "pending@boostmybusinesses.com", confirmed: true, configVersion: 1 },
    "admin_test",
    env,
  );
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) assert.equal(unconfirmed.reason, "sender_not_confirmed");

  const arbitrary = await patchTransactionalDeliverySettings(
    supabase as never,
    { activeFromEmail: "freeform@example.com", confirmed: true, configVersion: 1 },
    "admin_test",
    env,
  );
  assert.equal(arbitrary.ok, false);
  if (!arbitrary.ok) assert.equal(arbitrary.reason, "sender_not_confirmed");

  const supportOnly = await patchTransactionalDeliverySettings(
    supabase as never,
    { supportEmail: "ops@boostmybusinesses.com", configVersion: 1 },
    "admin_test",
    {},
  );
  assert.equal(supportOnly.ok, true);
});

test("security: no token exposure and refresh is explicit only", async () => {
  clearPostmarkSenderSyncCacheForTests();
  assert.equal(readPostmarkAccountTokenConfigured({}), false);
  const sync = projectPostmarkSenderSyncStatus({ accountTokenConfigured: false });
  assert.equal(sync.status, "not_configured");
  assert.equal(sync.message, "Sender identity sync is not configured.");
  assert.deepEqual(sync.confirmedSenders, []);
  assert.equal(assertNoForbiddenDeliverySettingsSecrets({ postmark_account_token: "secret" }), "Field postmark_account_token is not allowed on delivery settings requests.");
});

test("future intent snapshots capture applied settings without rewriting history", () => {
  const before = buildLegacyTransactionalDeliverySettings();
  const after = {
    ...before,
    activeFromEmail: "growth@boostmybusinesses.com",
    supportEmail: "ops@boostmybusinesses.com",
    configVersion: 2,
    source: "database" as const,
    schemaReady: true,
  };
  const historical = buildIntentDeliverySnapshotFields(before);
  const next = buildIntentDeliverySnapshotFields(after);
  assert.equal(historical.from_email_snapshot, "growth@boostmybusinesses.com");
  assert.equal(historical.support_email_snapshot, "growth@boostmybusinesses.com");
  assert.equal(next.support_email_snapshot, "ops@boostmybusinesses.com");
  assert.notEqual(historical.support_email_snapshot, next.support_email_snapshot);
});

test("demo values and support resolver stay centralized", () => {
  const settings = {
    activeFromEmail: "growth@boostmybusinesses.com",
    supportEmail: "central@boostmybusinesses.com",
    configVersion: 4,
    source: "database" as const,
    schemaReady: true,
    updatedAt: null,
  };
  const demo = buildClientEmailDemoValues(settings, "preview");
  assert.equal(resolveClientEmailTransactionalSupportEmail(settings), "central@boostmybusinesses.com");
  const preview = buildTemplatePreview("Support {{support_email}}", "Email {{support_email}}", demo);
  assert.match(preview.bodyText, /central@boostmybusinesses.com/);
});

test("schema probe detects missing delivery settings table", async () => {
  const { supabase } = createSettingsSupabase({
    settingsError: { message: "relation \"transactional_email_delivery_settings\" does not exist", code: "42P01" },
  });
  const probe = await probeTransactionalDeliverySettingsSchema(supabase as never);
  assert.equal(probe.available, false);
});

test("ux state mirrors sender sync status without collapsing not_refreshed", () => {
  clearPostmarkSenderSyncCacheForTests();
  const senderSync = projectPostmarkSenderSyncStatus({ accountTokenConfigured: true });
  assert.equal(senderSync.status, "not_refreshed");
  assert.equal(resolveTransactionalUxState({ schemaReady: true, senderSync }), "not_refreshed");
});

test("confirmed sender lookup uses provider refresh cache only", async () => {
  clearPostmarkSenderSyncCacheForTests();
  clearSenderRefreshErrorForTests();
  await refreshPostmarkSenderIdentities({ POSTMARK_ACCOUNT_TOKEN: "token" }, async () => new Response(JSON.stringify({
    SenderSignatures: [{ EmailAddress: "growth@boostmybusinesses.com", Confirmed: true }],
  }), { status: 200 }));
  assert.ok(findConfirmedPostmarkSenderIdentity("growth@boostmybusinesses.com"));
  assert.equal(findConfirmedPostmarkSenderIdentity("other@example.com"), null);
});
