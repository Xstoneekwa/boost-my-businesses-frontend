import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AUTH_USER_LOCALE,
  resolveAuthLocaleBackfill,
  resolveAuthUserLocale,
} from "./auth-user-locale.ts";
import {
  planAuthLocaleBackfill,
  runAuthLocaleBackfill,
} from "../../scripts/backfill-auth-user-locales.mjs";

test("auth locale accepts only fr or en and defaults to fr", () => {
  assert.equal(resolveAuthUserLocale("fr"), "fr");
  assert.equal(resolveAuthUserLocale(" EN "), "en");
  assert.equal(resolveAuthUserLocale(undefined), DEFAULT_AUTH_USER_LOCALE);
  assert.equal(resolveAuthUserLocale("de"), "fr");
});

test("backfill uses the canonical client language and otherwise temporary fr", () => {
  const canonical = resolveAuthLocaleBackfill({ currentLocale: undefined, linkedClientLocales: ["en"] });
  assert.deepEqual(canonical, {
    needsUpdate: true,
    locale: "en",
    source: "client_preferred_language",
  });
  assert.deepEqual(
    resolveAuthLocaleBackfill({ currentLocale: undefined, linkedClientLocales: [] }),
    { needsUpdate: true, locale: "fr", source: "temporary_fr_fallback" },
  );
});

test("runtime and server-side backfill planners use the same locale contract", () => {
  assert.deepEqual(
    planAuthLocaleBackfill({ currentLocale: null, linkedClientLocales: ["fr"] }),
    { needsUpdate: true, locale: "fr", source: "client_preferred_language" },
  );
  assert.deepEqual(
    planAuthLocaleBackfill({ currentLocale: "en", linkedClientLocales: ["fr"] }),
    { needsUpdate: false, locale: "en", source: "existing_auth_metadata" },
  );
});

function createBackfillMock() {
  const authUsers = [
    { id: "11111111-1111-4111-8111-111111111111", user_metadata: { email_verified: true } },
    { id: "22222222-2222-4222-8222-222222222222", user_metadata: { email_verified: true } },
  ];
  const updates = [];
  const tables = {
    client_users: [{ auth_user_id: authUsers[0].id, client_id: "client-en" }],
    clients: [{ id: "client-en", metadata: { preferred_language: "en" } }],
  };

  return {
    authUsers,
    updates,
    supabase: {
      auth: {
        admin: {
          async listUsers() {
            return { data: { users: authUsers }, error: null };
          },
          async updateUserById(id, input) {
            updates.push({ id, input });
            return { data: { user: null }, error: null };
          },
        },
      },
      from(table) {
        return {
          select() {
            return {
              async range() {
                return { data: tables[table] ?? [], error: null };
              },
            };
          },
        };
      },
    },
  };
}

test("backfill is dry-run by default and apply preserves existing metadata", async () => {
  const dryRun = createBackfillMock();
  const drySummary = await runAuthLocaleBackfill({ supabase: dryRun.supabase, apply: false });
  assert.equal(drySummary.usersPlannedForUpdate, 2);
  assert.deepEqual(dryRun.updates, []);

  const applyRun = createBackfillMock();
  await runAuthLocaleBackfill({ supabase: applyRun.supabase, apply: true });
  assert.deepEqual(applyRun.updates, [
    {
      id: applyRun.authUsers[0].id,
      input: { user_metadata: { email_verified: true, locale: "en" } },
    },
    {
      id: applyRun.authUsers[1].id,
      input: { user_metadata: { email_verified: true, locale: "fr" } },
    },
  ]);
});
