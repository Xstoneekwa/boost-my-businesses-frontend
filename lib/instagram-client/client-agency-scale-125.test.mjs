import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectClientAccountRow } from "./account-projection.ts";
import {
  buildAgencyOverviewSummary,
  buildAgencyPackageSummary,
  filterAgencyOverviewAccounts,
  isAgencyModeActive,
  matchesAgencyAccountSearch,
  paginateAgencyOverviewAccounts,
} from "./client-agency-overview-helpers.ts";
import {
  projectAgencyOverviewAccountRow,
} from "./client-agency-overview-projection.ts";
import {
  buildAgencyTargetingSummary,
  projectAgencyTargetingAccountRow,
} from "./client-agency-targeting-projection.ts";
import {
  buildAgencyAccountSubscriptionCard,
  buildAccountScopedSubscriptionCard,
} from "./client-overview-projection.ts";
import { NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD } from "../instagram-dashboard/needs-more-target-accounts.ts";
import {
  ACCOUNT_SCOPE_NETWORK_BUDGET,
  AGENCY_OVERVIEW_NETWORK_BUDGET,
  SCALE_ACCOUNT_COUNT,
  SCALE_PAGE_SIZE,
  SCALE_TENANT_A_ID,
  SCALE_TENANT_B_ID,
  TenantScopedScopeMemory,
  agencyScopeStorageKey,
  applyAccountScopeFetchResult,
  buildTenantAScaleFixture,
  resolveAuthorizedAccountId,
  simulateAccountScopeNetwork,
  simulateAgencyOverviewNetwork,
  toClientInstagramAccountView,
  toProjectedAccountInput,
} from "./fixtures/agency-scale-fixture.mjs";

const dashboardSource = readFileSync(new URL("../../app/instagram-client/ClientDashboard.tsx", import.meta.url), "utf8");
const scopeSelectorSource = readFileSync(new URL("../../app/instagram-client/ClientAgencyScopeSelector.tsx", import.meta.url), "utf8");
const overviewLoaderSource = readFileSync(new URL("./load-agency-overview.ts", import.meta.url), "utf8");
const targetingLoaderSource = readFileSync(new URL("./load-agency-targeting-overview.ts", import.meta.url), "utf8");
const targetingPanelSource = readFileSync(new URL("../../app/instagram-client/ClientAgencyTargetingPanel.tsx", import.meta.url), "utf8");

const fixture = buildTenantAScaleFixture();

function projectOverviewRows(accounts) {
  return accounts.map((row) => projectAgencyOverviewAccountRow({
    account: projectClientAccountRow(toProjectedAccountInput(row)),
    notificationsByAccount: new Map(),
    passwordActionAccountIds: new Set(row.actionRequired ? [row.accountId] : []),
    lastActivityAt: row.hasFollowerHistory ? "2026-06-20T10:00:00.000Z" : null,
    eligibleTargetCount: row.eligibility.eligible,
  }));
}

function filterScopeSelectorAccounts(accounts, search, filter) {
  return accounts.filter((account) => {
    const view = toClientInstagramAccountView(account);
    if (!matchesAgencyAccountSearch(view.username, search)) return false;
    if (filter === "connected") return view.connected;
    if (filter === "preparing") return !view.connected;
    if (filter === "action_required") {
      return view.loginStatus === "verification_pending"
        || view.provisioningStatus === "login_verification_pending";
    }
    return true;
  });
}

function accountByUsername(username) {
  const normalized = username.replace(/^@+/, "");
  return fixture.accounts.find((row) => row.username === normalized);
}

test("fixture builds 125 tenant-scoped accounts with highlighted usernames", () => {
  assert.equal(fixture.accountCount, SCALE_ACCOUNT_COUNT);
  assert.equal(fixture.accounts.length, 125);
  assert.ok(accountByUsername("agency_account_001"));
  assert.ok(accountByUsername("agency_account_020"));
  assert.ok(accountByUsername("agency_account_101"));
  assert.ok(accountByUsername("agency_account_125"));
  assert.equal(fixture.externalTenant.accounts.length, 5);
  assert.notEqual(fixture.accounts[0].tenantId, fixture.externalTenant.accounts[0].tenantId);
});

test("agency mode is active for 125 linked accounts", () => {
  assert.equal(isAgencyModeActive(fixture.accounts.length), true);
  assert.match(dashboardSource, /useState<OverviewScope>\(agencyModeActive \? "agency" : ""\)/);
});

test("agency overview KPIs and package counts reflect all 125 accounts", () => {
  const rows = projectOverviewRows(fixture.accounts);
  const summary = buildAgencyOverviewSummary(
    rows,
    new Map(fixture.accounts.map((row) => [row.accountId, row.connected])),
  );
  const packages = buildAgencyPackageSummary(fixture.accounts);

  assert.equal(summary.linkedCount, 125);
  assert.equal(summary.connectedCount, fixture.accounts.filter((row) => row.connected).length);
  assert.equal(summary.actionRequiredCount, rows.filter((row) => row.actionRequired).length);
  assert.equal(summary.campaignActiveCount, rows.filter((row) => row.campaignActive).length);

  const growthCount = fixture.accounts.filter((row) => row.packageLabel === "Growth").length;
  const proCount = fixture.accounts.filter((row) => row.packageLabel === "Pro").length;
  assert.equal(packages.find((row) => row.label === "Growth")?.count, growthCount);
  assert.equal(packages.find((row) => row.label === "Pro")?.count, proCount);
  assert.equal(growthCount + proCount, 125);
});

test("agency-wide scope hides individual subscription cards and mono-account follower charts", () => {
  assert.match(dashboardSource, /overviewScope === "agency"/);
  assert.match(dashboardSource, /hasOverviewInsights = Boolean\(accountInsights\) && \(!agencyModeActive \|\| overviewScope !== "agency"\)/);
  assert.match(dashboardSource, /useAccountScopedSubscription = agencyModeActive && overviewScope !== "agency"/);
  assert.match(dashboardSource, /agencyContact: agencyModeActive && overviewScope === "agency"/);
  assert.match(dashboardSource, /agencyModeActive && overviewScope === "agency" \?/);
  assert.match(dashboardSource, /ClientAgencyOverviewPanel/);
});

test("agency table paginates 20 rows per page and reaches agency_account_101 on page 6", () => {
  const rows = projectOverviewRows(fixture.accounts);
  const page1 = paginateAgencyOverviewAccounts(rows, 1, SCALE_PAGE_SIZE);
  const page6 = paginateAgencyOverviewAccounts(rows, 6, SCALE_PAGE_SIZE);

  assert.equal(page1.items.length, 20);
  assert.equal(page1.total, 125);
  assert.equal(page1.pageSize, 20);
  assert.equal(page6.items.length, 20);
  assert.ok(page6.items.some((row) => row.username === "agency_account_101"));
  assert.equal(page6.items[0]?.username, "agency_account_101");
  assert.notEqual(page1.items[0]?.username, page6.items[0]?.username);
});

test("agency overview does not materialize 125 full detail cards at once", () => {
  const simulated = simulateAgencyOverviewNetwork(fixture, { page: 1, pageSize: SCALE_PAGE_SIZE });
  assert.equal(simulated.pageItemCount, 20);
  assert.equal(simulated.totalFiltered, 125);
  assert.equal(simulated.counter.get("loadClientInstagramAccounts"), AGENCY_OVERVIEW_NETWORK_BUDGET.loadClientInstagramAccounts);
  assert.equal(simulated.counter.get("perAccountInsights"), AGENCY_OVERVIEW_NETWORK_BUDGET.perAccountInsights);
  assert.equal(simulated.counter.get("perAccountSubscription"), AGENCY_OVERVIEW_NETWORK_BUDGET.perAccountSubscription);
});

test("agency overview loader uses batched queries rather than per-account detail loops", () => {
  assert.match(overviewLoaderSource, /loadClientInstagramAccounts\(clientId\)/);
  assert.match(overviewLoaderSource, /loadTargetEligibilityCountsByAccount\(supabase, accountIds\)/);
  assert.match(overviewLoaderSource, /loadRecentInteractionEvents\(accountIds\)/);
  assert.doesNotMatch(overviewLoaderSource, /for \(const accountId of accountIds\)[\s\S]*loadClientAccountInsights/);
});

test("agency overview table remains tenant-scoped with external tenant excluded", () => {
  const tenantRows = fixture.accounts.filter((row) => row.tenantId === SCALE_TENANT_A_ID);
  const externalIds = new Set(fixture.externalTenant.accounts.map((row) => row.accountId));
  assert.equal(tenantRows.length, 125);
  for (const row of tenantRows) {
    assert.equal(resolveAuthorizedAccountId(SCALE_TENANT_A_ID, row.accountId, fixture.linksByTenant), row.accountId);
    assert.equal(resolveAuthorizedAccountId(SCALE_TENANT_A_ID, row.accountId, fixture.linksByTenant) && !externalIds.has(row.accountId), true);
  }
  assert.equal(resolveAuthorizedAccountId(SCALE_TENANT_A_ID, fixture.externalTenant.accounts[0].accountId, fixture.linksByTenant), null);
});

test("scope combobox keeps agency option first and finds agency_account_101", () => {
  assert.match(scopeSelectorSource, /Vue Agence/);
  assert.match(scopeSelectorSource, /Tous les comptes/);
  const matches = filterScopeSelectorAccounts(fixture.accounts, "agency_account_101", "all");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].username, "agency_account_101");
  assert.equal(matchesAgencyAccountSearch("agency_account_101", "@agency_account_101"), true);
});

test("scope selection labels are explicit for agency and account modes", () => {
  const account = accountByUsername("agency_account_101");
  const agencyLabel = "Vue Agence — Tous les comptes";
  const accountLabel = `Compte — @${account.username}`;
  assert.match(scopeSelectorSource, /scopeDisplayLabel/);
  assert.match(scopeSelectorSource, /agencyView\} — \$\{t\.agency\}/);
  assert.match(scopeSelectorSource, /accountPrefix\} — @/);
  assert.notEqual(agencyLabel, accountLabel);
});

test("scope sessionStorage is isolated per tenant", () => {
  const memory = new TenantScopedScopeMemory();
  const keyA = agencyScopeStorageKey(SCALE_TENANT_A_ID);
  const keyB = agencyScopeStorageKey(SCALE_TENANT_B_ID);
  memory.set(keyA, "agency");
  memory.set(keyB, fixture.externalTenant.accounts[0].accountId);
  memory.set(keyA, accountByUsername("agency_account_101").accountId);
  assert.equal(memory.get(keyA), accountByUsername("agency_account_101").accountId);
  assert.equal(memory.get(keyB), fixture.externalTenant.accounts[0].accountId);
});

test("status filters only return matching accounts at scale", () => {
  const rows = projectOverviewRows(fixture.accounts);
  const connected = filterAgencyOverviewAccounts(rows, "connected");
  const actionRequired = filterAgencyOverviewAccounts(rows, "action_required");
  const preparingViaScope = filterScopeSelectorAccounts(fixture.accounts, "", "preparing");
  assert.equal(connected.length, rows.filter((row) => row.connectionLabelEn === "Connected").length);
  assert.ok(preparingViaScope.length > 0);
  assert.ok(actionRequired.length > 0);
  assert.ok(connected.length < 125);
  assert.ok(preparingViaScope.length < 125);
});

test("forced external account id cannot be authorized for tenant A", () => {
  const externalId = fixture.externalTenant.accounts[0].accountId;
  assert.equal(resolveAuthorizedAccountId(SCALE_TENANT_A_ID, externalId, fixture.linksByTenant), null);
  assert.equal(resolveAuthorizedAccountId(SCALE_TENANT_B_ID, externalId, fixture.linksByTenant), externalId);
});

test("account subscription card for agency_account_101 uses only its commercial data", async () => {
  const account = accountByUsername("agency_account_101");
  const card = buildAccountScopedSubscriptionCard({
    accountId: account.accountId,
    username: account.username,
    planLabel: account.commercial.planLabel,
    statusLabel: account.commercial.statusLabel,
    priceLabel: account.commercial.priceLabel,
    growthLabel: account.commercial.growthLabel,
    supportLabel: "Données en cours",
    billingDisplayMode: account.commercial.billingDisplayMode,
    billingDateIso: account.commercial.billingDateIso,
  }, "fr");

  assert.match(card.title, /@agency_account_101/);
  assert.equal(card.planName, "Growth");
  assert.equal(card.price, "147€");
  assert.doesNotMatch(card.growthEstimate, /300–500/);
  assert.match(card.growthEstimate, /200–350/);
});

test("rapid account switching does not let stale async responses overwrite current scope", () => {
  const account018 = accountByUsername("agency_account_018");
  const account101 = accountByUsername("agency_account_101");
  const account123 = accountByUsername("agency_account_123");

  const stale = applyAccountScopeFetchResult(account101.accountId, account018.accountId, { planName: "Pro" });
  assert.equal(stale, null);

  const fresh = applyAccountScopeFetchResult(account101.accountId, account101.accountId, { planName: "Growth" });
  assert.deepEqual(fresh, { planName: "Growth" });

  const cards = [account018, account101, account123].map((row) => buildAgencyAccountSubscriptionCard({
    accountId: row.accountId,
    username: row.username,
    planLabel: row.commercial.planLabel,
    statusLabel: row.commercial.statusLabel,
    priceLabel: row.commercial.priceLabel,
    growthLabel: row.commercial.growthLabel,
    supportLabel: "Données en cours",
    billingDisplayMode: row.commercial.billingDisplayMode,
    billingDateIso: row.commercial.billingDateIso,
  }, null, row.accountId, "fr"));

  assert.equal(cards[0].planName, "Pro");
  assert.equal(cards[1].planName, "Growth");
  assert.equal(cards[2].planName, "Pro");
  assert.match(dashboardSource, /if \(cancelled\) return/);
});

test("account scope network budget loads only one account bundle", () => {
  const account = accountByUsername("agency_account_101");
  const simulated = simulateAccountScopeNetwork(account.accountId);
  assert.equal(simulated.counter.get("insights"), ACCOUNT_SCOPE_NETWORK_BUDGET.insights);
  assert.equal(simulated.counter.get("followerGrowth"), ACCOUNT_SCOPE_NETWORK_BUDGET.followerGrowth);
  assert.equal(simulated.counter.get("subscription"), ACCOUNT_SCOPE_NETWORK_BUDGET.subscription);
  assert.equal(simulated.counter.total(), 3);
});

test("agency targeting table stays per-account without merged CT lists", () => {
  const rows = fixture.accounts.map((row) => projectAgencyTargetingAccountRow(
    projectClientAccountRow(toProjectedAccountInput(row)),
    row.eligibility,
  ));
  const summary = buildAgencyTargetingSummary(rows);
  assert.equal(rows.length, 125);
  assert.equal(summary.readyAccounts + summary.needsCompletionAccounts, 125);
  assert.doesNotMatch(targetingPanelSource, /merge|fusion|flatMap\(.*targets/i);
  assert.match(targetingPanelSource, /onManageAccount/);
  assert.match(targetingLoaderSource, /loadTargetEligibilityCountsByAccount/);
  assert.doesNotMatch(targetingLoaderSource, /\/targets/);
});

test("agency targeting statuses and needs-more threshold stay correct at scale", () => {
  const account101 = accountByUsername("agency_account_101");
  const account020 = accountByUsername("agency_account_020");
  const row101 = projectAgencyTargetingAccountRow(
    projectClientAccountRow(toProjectedAccountInput(account101)),
    account101.eligibility,
  );
  const row020 = projectAgencyTargetingAccountRow(
    projectClientAccountRow(toProjectedAccountInput(account020)),
    account020.eligibility,
  );

  assert.equal(row101.eligibleCount, 6);
  assert.equal(row101.needsMoreTargets, false);
  assert.equal(row020.eligibleCount, 3);
  assert.equal(row020.needsMoreTargets, true);
  assert.equal(NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD, 5);
  assert.equal(row101.eligibleCount > NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD, true);
  assert.equal(row020.eligibleCount <= NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD, true);
});

test("notification CTA for page-6 account opens the correct account targeting scope", async () => {
  const account = accountByUsername("agency_account_101");
  const { buildClientNotificationCopy } = await import("./client-account-notifications.ts");
  const copy = buildClientNotificationCopy("needs_more_target_accounts", {
    username: account.username,
    eligible_target_count: account.eligibility.eligible,
    added_target_count: account.eligibility.total,
    threshold: NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
  }, "fr", account.accountId);
  assert.match(copy.ctaHref, new RegExp(`account=${account.accountId}`));
});

test("missing commercial data stays honest and never borrows another account values", () => {
  const account = accountByUsername("agency_account_120");
  const fallback = buildAgencyAccountSubscriptionCard(null, {
    accountId: account.accountId,
    username: account.username,
    packageLabel: account.packageLabel,
    packageCode: "pro",
    campaignActive: account.campaignActive,
    statsDays: [],
    overview: {
      campaignInteractions: { monthInteractions: 0, todayInteractions: 0, businessTimezone: "UTC" },
      followerEvolution: { status: "pending", netChange: null, dailyAverage: null },
    },
    chartSeries: { d7: [], d30: [], d90: [] },
    activity: [],
    recentFeed: [],
    targets: [],
    whitelist: [],
    blacklist: [],
  }, account.accountId, "fr");

  assert.match(fallback.title, /@agency_account_120/);
  assert.equal(fallback.planName, "Pro");
  assert.equal(fallback.price, "Disponible prochainement");
  assert.doesNotMatch(fallback.price, /147€/);
  assert.match(fallback.growthEstimate, /300–500/);
});

test("agency overview search narrows pagination without leaking other tenants", () => {
  const simulated = simulateAgencyOverviewNetwork(fixture, {
    page: 1,
    pageSize: SCALE_PAGE_SIZE,
    search: "agency_account_101",
  });
  assert.equal(simulated.totalFiltered, 1);
  assert.equal(simulated.pageItems[0]?.username, "agency_account_101");
  assert.equal(simulated.counter.total(), 5);
});
