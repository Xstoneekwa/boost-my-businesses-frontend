import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveClientConnectionActionPanel } from "./client-connection-action-scope.ts";

const accounts = ["account-a", "account-b", "account-c"].map((accountId) => ({ accountId }));

test("standard tenant keeps its account actions and global add action", () => {
  const panel = resolveClientConnectionActionPanel({
    accounts: accounts.slice(0, 1),
    agencyModeActive: false,
    overviewScope: "",
  });
  assert.equal(panel.showAccountActions, true);
  assert.deepEqual(panel.accounts.map((row) => row.accountId), ["account-a"]);
  assert.equal(panel.accountScopeId, null);
});

test("agency aggregate keeps only the global action while every selected account is scoped dynamically", () => {
  const aggregate = resolveClientConnectionActionPanel({
    accounts,
    agencyModeActive: true,
    overviewScope: "agency",
  });
  assert.equal(aggregate.showAccountActions, false);
  assert.deepEqual(aggregate.accounts.map((row) => row.accountId), ["account-a", "account-b", "account-c"]);

  for (const account of accounts) {
    const selected = resolveClientConnectionActionPanel({
      accounts,
      agencyModeActive: true,
      overviewScope: account.accountId,
    });
    assert.equal(selected.showAccountActions, true);
    assert.deepEqual(selected.accounts.map((row) => row.accountId), [account.accountId]);
    assert.equal(selected.accountScopeId, account.accountId);
  }
});

test("unknown selection never falls back to another tenant account", () => {
  const panel = resolveClientConnectionActionPanel({
    accounts,
    agencyModeActive: true,
    overviewScope: "foreign-account",
  });
  assert.equal(panel.showAccountActions, false);
  assert.deepEqual(panel.accounts, []);
  assert.equal(panel.accountScopeId, null);
});

test("dashboard keeps add and selected-account actions distinct and responsive", () => {
  const dashboard = readFileSync(new URL("../../app/instagram-client/ClientDashboard.tsx", import.meta.url), "utf8");
  const section = readFileSync(new URL("../../app/instagram-client/ClientAccountsSection.tsx", import.meta.url), "utf8");
  const modal = readFileSync(new URL("../../app/instagram-client/ClientAccountProcessModal.tsx", import.meta.url), "utf8");

  assert.match(dashboard, /resolveClientConnectionActionPanel/);
  assert.match(dashboard, /accountScopeId=\{connectionActionPanel\.accountScopeId\}/);
  assert.match(section, /Ajouter un compte Instagram/);
  assert.match(section, /Vérification…/);
  assert.match(section, /runConnectProcess\(account, "check_readiness"\)/);
  assert.match(section, /confirmVerifiedConnection/);
  assert.match(section, /runConnectProcess\(account, "connect", \{/);
  assert.match(section, /connectSubmissionRef\.current/);
  assert.match(modal, /Connecter maintenant/);
  assert.match(dashboard, /@media\(max-width:720px\)[\s\S]*\.cd-account-row\{align-items:stretch;flex-direction:column\}/);
  assert.doesNotMatch(`${dashboard}\n${section}`, /rex_gen_boost_ai|third.account|troisi.me compte/i);
});
