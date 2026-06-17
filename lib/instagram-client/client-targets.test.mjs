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

test("client AI targeting gate enables Pro and Premium only", () => {
  assert.equal(isClientAiTargetingEnabled("growth"), false);
  assert.equal(isClientAiTargetingEnabled("pro"), true);
  assert.equal(isClientAiTargetingEnabled("premium"), true);
  assert.equal(isClientAiTargetingEnabled("internal_test"), false);
});

test("client AI targeting labels match product copy", () => {
  assert.equal(clientAiTargetingButtonLabel("fr"), "Lancer la recherche avec l'IA");
  assert.match(clientAiTargetingUpgradeLabel("fr"), /Intelligence Artificielle/);
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
  assert.match(drawerSource, /clientAiTargetingButtonLabel/);
  assert.match(drawerSource, /clientAiTargetingUpgradeLabel/);
  assert.match(dashboardSource, /ClientAccountTargetsDrawer/);
  assert.match(dashboardSource, /reloadTargeting/);
  assert.match(dashboardSource, /persistFilterLists/);
  assert.doesNotMatch(dashboardSource, /christine_leclerc/);
  assert.doesNotMatch(dashboardSource, /i_m_your_traker/);
  assert.match(dashboardSource, /Lancer la recherche avec l'IA/);
});

test("admin targets route delegates to shared targets service", () => {
  const adminRoute = source("../../app/api/instagram-dashboard/targets/route.ts");
  assert.match(adminRoute, /listAccountTargets/);
  assert.match(adminRoute, /addAccountTargetSingle/);
  assert.match(adminRoute, /archiveAccountTargets/);
});
