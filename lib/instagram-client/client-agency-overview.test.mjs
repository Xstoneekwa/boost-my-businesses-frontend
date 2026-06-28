import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildAgencyOverviewSummary,
  buildAgencyPackageSummary,
  filterAgencyOverviewAccounts,
  isAgencyModeActive,
  matchesAgencyAccountSearch,
  paginateAgencyOverviewAccounts,
} from "./client-agency-overview-helpers.ts";

const projectionSource = readFileSync(new URL("./client-agency-overview-projection.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../../app/instagram-client/ClientDashboard.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../../app/instagram-client/page.tsx", import.meta.url), "utf8");

test("agency mode activates only with two or more linked accounts", () => {
  assert.equal(isAgencyModeActive(0), false);
  assert.equal(isAgencyModeActive(1), false);
  assert.equal(isAgencyModeActive(2), true);
});

test("pure agency helpers stay lightweight and honest", () => {
  const summary = buildAgencyPackageSummary([
    { packageLabel: "Growth" },
    { packageLabel: "Pro" },
  ]);
  assert.deepEqual(summary, [{ label: "Growth", count: 1 }, { label: "Pro", count: 1 }]);
  assert.equal(matchesAgencyAccountSearch("brand_paris", "paris"), true);
  assert.equal(paginateAgencyOverviewAccounts(Array.from({ length: 45 }, (_, i) => i), 1, 20).items.length, 20);

  const rows = [
    { accountId: "a", username: "a", packageLabel: "Growth", connectionLabelFr: "", connectionLabelEn: "Connected", preparationLabelFr: "", preparationLabelEn: "", campaignActive: true, campaignLabelFr: "", campaignLabelEn: "", needsTargets: false, needsTargetsLabelFr: null, needsTargetsLabelEn: null, lastActivityAt: null, lastActivityLabelFr: null, lastActivityLabelEn: null, actionRequired: false },
    { accountId: "b", username: "b", packageLabel: "Pro", connectionLabelFr: "", connectionLabelEn: "Pending", preparationLabelFr: "", preparationLabelEn: "Setup in progress", campaignActive: false, campaignLabelFr: "", campaignLabelEn: "", needsTargets: false, needsTargetsLabelFr: null, needsTargetsLabelEn: null, lastActivityAt: null, lastActivityLabelFr: null, lastActivityLabelEn: null, actionRequired: true },
  ];
  assert.equal(filterAgencyOverviewAccounts(rows, "connected").length, 1);
  assert.equal(buildAgencyOverviewSummary(rows, new Map([["a", true], ["b", false]])).connectedCount, 1);
});

test("SSR skips single-account insights preload when agency mode is active", () => {
  assert.match(pageSource, /agencyModeActive = orderedAccounts\.length >= 2/);
  assert.match(pageSource, /initialAgencyModeActive=\{agencyModeActive\}/);
  assert.match(pageSource, /const primaryAccountId = agencyModeActive \? "" :/);
});

test("dashboard keeps single-account overview unchanged and adds agency scope flow", () => {
  assert.match(dashboardSource, /initialAgencyModeActive/);
  assert.match(dashboardSource, /overviewScope === "agency"/);
  assert.match(dashboardSource, /ClientAgencyOverviewPanel/);
  assert.match(dashboardSource, /ClientAgencyScopeSelector/);
  assert.match(dashboardSource, /\/api\/instagram-client\/accounts\/\$\{encodeURIComponent\(overviewScope\)\}\/insights/);
  assert.match(projectionSource, /projectAgencyOverviewAccountRow/);
});
