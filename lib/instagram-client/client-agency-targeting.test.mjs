import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { summarizeTargetEligibilityRows } from "../instagram-dashboard/account-target-eligibility.ts";

const dashboardSource = readFileSync(new URL("../../app/instagram-client/ClientDashboard.tsx", import.meta.url), "utf8");
const scopeSelectorSource = readFileSync(new URL("../../app/instagram-client/ClientAgencyScopeSelector.tsx", import.meta.url), "utf8");
const notificationsSource = readFileSync(new URL("./client-account-notifications.ts", import.meta.url), "utf8");
const targetingProjectionSource = readFileSync(new URL("./client-agency-targeting-projection.ts", import.meta.url), "utf8");
const overviewTestSource = readFileSync(new URL("./client-agency-overview.test.mjs", import.meta.url), "utf8");

test("needs-more notification copy explains campaign-ready vs added counts", async () => {
  const { buildClientNotificationCopy } = await import("./client-account-notifications.ts");
  const copy = buildClientNotificationCopy("needs_more_target_accounts", {
    username: "nab_autom_ig",
    eligible_target_count: 4,
    added_target_count: 6,
    threshold: 5,
  }, "fr", "acct-1");
  assert.match(copy.message, /4 comptes prêts/);
  assert.match(copy.message, /6 ajoutés/);
  assert.match(copy.ctaHref, /account=acct-1/);
});

test("eligible target rows resolve needs-more when above threshold", () => {
  const rows = Array.from({ length: 6 }, () => ({
    status: "valid",
    quality_status: "eligible",
    verification_status: "found",
  }));
  const counts = summarizeTargetEligibilityRows(rows);
  assert.equal(counts.eligible, 6);
  assert.equal(counts.eligible > 5, true);
});

test("agency targeting projection exposes added vs eligible fields", () => {
  assert.match(targetingProjectionSource, /addedCount/);
  assert.match(targetingProjectionSource, /eligibleCount/);
  assert.match(targetingProjectionSource, /needsMoreTargets/);
});

test("reconcile syncs dashboard action before notification projection", () => {
  assert.match(notificationsSource, /syncNeedsMoreTargetAccountsDashboardAction/);
  assert.match(notificationsSource, /added_target_count: counts\.total/);
});

test("dashboard wires agency targeting panel and explicit scope bar", () => {
  assert.match(scopeSelectorSource, /scopeLabel: "Afficher les données de"/);
  assert.match(dashboardSource, /ClientAgencyTargetingPanel/);
  assert.match(dashboardSource, /agencyScopeStorageKey/);
  assert.match(dashboardSource, /searchParams\.get\("account"\)/);
  assert.match(dashboardSource, /validEligible/);
});

test("derive desired states uses eligible count threshold", () => {
  assert.match(notificationsSource, /needsMoreActive = eligibleCount <= NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD/);
});

test("agency scope combobox matches DM Templates closed-field affordance", () => {
  assert.match(scopeSelectorSource, /role="combobox"/);
  assert.match(scopeSelectorSource, /aria-expanded=\{open\}/);
  assert.match(scopeSelectorSource, /ScopeChevron/);
  assert.match(scopeSelectorSource, /cd-agency-scope-chevron/);
  assert.match(scopeSelectorSource, /handleTriggerKeyDown/);
  assert.match(scopeSelectorSource, /event\.key !== "Escape"/);
  assert.match(scopeSelectorSource, /sessionStorage\.setItem\(storageKey, scope\)/);
  assert.match(dashboardSource, /\.cd-agency-scope-combobox\{[^}]*var\(--surface-2\)/);
  assert.match(dashboardSource, /\.cd-dm-account-select\{[^}]*var\(--surface-2\)/);
  assert.match(dashboardSource, /\.cd-agency-scope-chevron\.open\{transform:rotate\(180deg\)\}/);
});

test("single-account tenants keep agency selector hidden", () => {
  assert.match(overviewTestSource, /agency mode activates only with two or more linked accounts/);
  assert.match(dashboardSource, /initialAgencyModeActive/);
  assert.match(dashboardSource, /agencyModeActive &&/);
});
