import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  mergeResolvedAccountEmail,
  normalizeSafeEmail,
  resolveAccountEmail,
} from "./resolve-account-email.ts";

const manageSource = readFileSync(new URL("../../app/instagram-dashboard/manage-data.ts", import.meta.url), "utf8");

test("growth_with_bmb email resolves from ig_account_settings", () => {
  const resolved = resolveAccountEmail({
    igAccount: { email: null },
    accountSettings: { email: "ekwax@hotmail.fr" },
  });
  assert.equal(resolved.email, "ekwax@hotmail.fr");
  assert.equal(resolved.emailSource, "ig_account_settings");
  assert.equal(resolved.emailAvailable, true);
});

test("i_m_your_traker resolves unknown when safe sources are empty", () => {
  const resolved = resolveAccountEmail({
    igAccount: { email: null },
    accountSettings: { email: "" },
    credentialMetadataSafe: {
      source: "add_profile",
      vault_secret_created: true,
    },
  });
  assert.equal(resolved.emailDisplay, "unknown");
  assert.equal(resolved.emailSource, "unknown");
  assert.equal(resolved.emailAvailable, false);
});

test("account without email returns unknown", () => {
  const resolved = resolveAccountEmail({});
  assert.equal(resolved.emailAvailable, false);
  assert.equal(resolved.emailDisplay, "unknown");
});

test("normalizeSafeEmail rejects secrets and invalid values", () => {
  assert.equal(normalizeSafeEmail("not-an-email"), null);
  assert.equal(normalizeSafeEmail("password@example.com"), null);
  assert.equal(normalizeSafeEmail("safe@example.com"), "safe@example.com");
});

test("mergeResolvedAccountEmail keeps an already resolved email", () => {
  const merged = mergeResolvedAccountEmail(
    { emailDisplay: "ekwax@hotmail.fr", emailSource: "ig_account_settings", emailAvailable: true },
    resolveAccountEmail({ accountSettings: { email: "other@example.com" } }),
  );
  assert.equal(merged.emailDisplay, "ekwax@hotmail.fr");
  assert.equal(merged.emailSource, "ig_account_settings");
});

test("manage-data uses centralized account email resolver without profile merge changes", () => {
  assert.match(manageSource, /resolveAccountEmail/);
  assert.match(manageSource, /mergeResolvedAccountEmail/);
  assert.match(manageSource, /emailAvailable/);
  assert.doesNotMatch(manageSource, /client_accounts.*profiles|profiles.*client_accounts/i);
});

test("password and secret fields are never returned as email", () => {
  const resolved = resolveAccountEmail({
    igAccount: { email: "secret-token@service.local" },
    accountSettings: { email: "password@example.com" },
    credentialMetadataSafe: { email: "token@example.com" },
  });
  assert.equal(resolved.emailAvailable, false);
  assert.equal(resolved.emailDisplay, "unknown");
});
