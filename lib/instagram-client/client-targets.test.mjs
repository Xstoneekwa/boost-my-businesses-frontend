import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeAccountFilterListInput,
  parseAccountFilterList,
  serializeAccountFilterList,
} from "./account-filter-lists.ts";
import {
  clientAiTargetingButtonLabel,
  clientAiTargetingUpgradeLabel,
  isClientAiTargetingEnabled,
} from "./ai-targeting-gate.ts";
import {
  clientTargetPerformanceHelp,
  clientTargetPerformanceLabel,
  formatClientTargetSent,
} from "./client-target-display.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("parseAccountFilterList normalizes usernames", () => {
  assert.deepEqual(parseAccountFilterList("User_One, @user_two\nuser_three"), [
    "user_one",
    "user_two",
    "user_three",
  ]);
});

test("serializeAccountFilterList dedupes and validates usernames", () => {
  assert.equal(
    serializeAccountFilterList(["User_One", "user_one", "@valid_user", "!!!"]),
    "user_one\nvalid_user",
  );
});

test("normalizeAccountFilterListInput returns unique normalized usernames", () => {
  assert.deepEqual(normalizeAccountFilterListInput(["@Alpha", "alpha", "beta"]), ["alpha", "beta"]);
});

test("client AI targeting gate consumes only the canonical server projection", () => {
  assert.equal(isClientAiTargetingEnabled(false), false);
  assert.equal(isClientAiTargetingEnabled(true), true);
  assert.equal(isClientAiTargetingEnabled(null), false);
  assert.equal(isClientAiTargetingEnabled(undefined), false);
});

test("client AI targeting labels match product copy", () => {
  assert.equal(clientAiTargetingButtonLabel("fr"), "Lancer la recherche avec l'IA");
  assert.match(clientAiTargetingUpgradeLabel("fr"), /Intelligence Artificielle/);
});

test("client target Sent preserves unknown versus true zero", () => {
  assert.equal(formatClientTargetSent(null, "fr"), "—");
  assert.equal(formatClientTargetSent(undefined, "en"), "—");
  assert.equal(formatClientTargetSent(0, "fr"), "0");
  assert.equal(formatClientTargetSent(12, "en"), "12");
});

test("client target Perf labels distinguish pending from insufficient data", () => {
  assert.equal(clientTargetPerformanceLabel("pending", "fr"), "En attente de mesure");
  assert.equal(clientTargetPerformanceLabel("insufficient_data", "fr"), "Données insuffisantes");
  assert.equal(clientTargetPerformanceLabel("not_applicable", "fr"), "Non applicable");
  assert.equal(clientTargetPerformanceLabel("bad", "fr"), "Faible");
  assert.equal(clientTargetPerformanceLabel("avg", "fr"), "Moyenne");
  assert.equal(clientTargetPerformanceLabel("good", "fr"), "Bonne");
  assert.equal(clientTargetPerformanceLabel("pending", "en"), "Pending measurement");
  assert.equal(clientTargetPerformanceLabel("insufficient_data", "en"), "Insufficient data");
  assert.equal(clientTargetPerformanceLabel("not_applicable", "en"), "Not applicable");
  assert.equal(clientTargetPerformanceLabel("bad", "en"), "Low");
  assert.equal(clientTargetPerformanceLabel("avg", "en"), "Average");
  assert.equal(clientTargetPerformanceLabel("good", "en"), "Good");
  assert.match(clientTargetPerformanceHelp("fr"), /100 follows/);
});

test("client targets routes enforce tenant session and ownership", () => {
  const targetsRoute = source("../../app/api/instagram-client/accounts/[accountId]/targets/route.ts");
  const filtersRoute = source("../../app/api/instagram-client/accounts/[accountId]/filters/route.ts");
  assert.match(targetsRoute, /requireClientInstagramSession/);
  assert.match(targetsRoute, /authorizeClientInstagramAccount/);
  assert.match(targetsRoute, /rejectTechnicalClientFields/);
  assert.match(targetsRoute, /listAccountTargets/);
  assert.match(targetsRoute, /addAccountTargetSingle/);
  assert.match(targetsRoute, /addAccountTargetsBulk/);
  assert.match(targetsRoute, /archiveAccountTargets/);
  assert.match(targetsRoute, /restoreAccountTarget/);
  assert.match(filtersRoute, /requireClientInstagramSession/);
  assert.match(filtersRoute, /authorizeClientInstagramAccount/);
  assert.match(filtersRoute, /whitelist_words/);
  assert.match(filtersRoute, /blacklist_accounts/);
});

test("client targeting drawer is wired to live account data", () => {
  const drawerSource = source("../../app/instagram-client/ClientAccountTargetsDrawer.tsx");
  const dashboardSource = source("../../app/instagram-client/ClientDashboard.tsx");
  assert.match(drawerSource, /ClientAccountTargetsDrawer/);
  assert.doesNotMatch(drawerSource, /christine_leclerc/);
  assert.doesNotMatch(drawerSource, /const DTL/);
  assert.match(drawerSource, /buildTargetsOverview/);
  assert.match(drawerSource, /TargetAvatar/);
  assert.match(drawerSource, /disabled=\{!canExport\}/);
  assert.match(drawerSource, /\{open \? \(/);
  assert.match(drawerSource, /ClientAiTargetSearchWizard/);
  assert.match(drawerSource, /setAiWizardOpen\(true\)/);
  assert.match(drawerSource, /formatClientTargetSent\(r\.followsSent, lang\)/);
  assert.match(drawerSource, /clientTargetPerformanceLabel\(r\.performanceStatus, lang\)/);
  assert.doesNotMatch(drawerSource, /r\.followsSent \?\? 0/);
  assert.doesNotMatch(drawerSource, /clientAiTargetingComingSoonMessage/);
  assert.match(dashboardSource, /ClientAccountTargetsDrawer/);
  assert.match(dashboardSource, /reloadTargeting/);
  assert.match(dashboardSource, /persistFilterLists/);
  assert.doesNotMatch(dashboardSource, /christine_leclerc/);
  assert.doesNotMatch(dashboardSource, /i_m_your_traker/);
  assert.match(dashboardSource, /Lancer la recherche avec l'IA/);
  assert.match(dashboardSource, /Rechercher un compte cible/);
  assert.doesNotMatch(dashboardSource, /Rechercher un compte ciblé/);
  assert.doesNotMatch(dashboardSource, /Compte protégé/);
  assert.match(dashboardSource, /targetSearchQuery/);
  assert.match(dashboardSource, /filteredTargetingItems/);
});

test("admin targets route delegates to shared targets service", () => {
  const adminRoute = source("../../app/api/instagram-dashboard/targets/route.ts");
  assert.match(adminRoute, /listAdminAccountTargets/);
  assert.match(adminRoute, /addAccountTargetSingle/);
  assert.match(adminRoute, /archiveAccountTargets/);
});

test("client targets projection excludes admin auto-archive metadata", () => {
  const serviceSource = source("../instagram-dashboard/targets-service.ts");
  const clientRoute = source("../../app/api/instagram-client/accounts/[accountId]/targets/route.ts");
  const panelSource = source("../../app/instagram-dashboard/InstagramAccountTargetsPanel.tsx");
  assert.match(clientRoute, /listAccountTargets/);
  assert.doesNotMatch(clientRoute, /listAdminAccountTargets/);
  assert.match(serviceSource, /export function safeTargetRow/);
  assert.match(serviceSource, /export function safeAdminTargetRow/);
  assert.match(serviceSource, /archive_reason/);
  assert.match(panelSource, /listFilter === "archived" && row\.adminAutoArchiveLabel/);
  assert.doesNotMatch(panelSource, /adminAutoArchiveLabel[\s\S]*listFilter !== "archived"/);
});
