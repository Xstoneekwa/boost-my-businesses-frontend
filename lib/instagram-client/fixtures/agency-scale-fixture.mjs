/**
 * Test-only in-memory fixture for agency scalability (125+ linked accounts).
 * Never touches production data or the database.
 */

export const SCALE_TENANT_A_ID = "tenant-scale-a-00000000-0000-4000-8000-0000000000a1";
export const SCALE_TENANT_B_ID = "tenant-scale-b-00000000-0000-4000-8000-0000000000b2";
export const SCALE_ACCOUNT_COUNT = 125;
export const SCALE_PAGE_SIZE = 20;

const HIGHLIGHT_INDICES = new Set([1, 20, 101, 125]);

function padIndex(index) {
  return String(index).padStart(3, "0");
}

function packageForIndex(index) {
  return index % 3 === 0 ? "Pro" : "Growth";
}

function commercialForIndex(index) {
  const isPro = packageForIndex(index) === "Pro";
  return {
    planLabel: isPro ? "Pro" : "Growth",
    priceLabel: isPro ? "197€" : "147€",
    growthLabel: isPro ? "~300–500 abonnés" : "~200–350 abonnés",
    billingDateIso: `2026-${String((index % 12) + 1).padStart(2, "0")}-15T00:00:00.000Z`,
    statusLabel: "Actif",
    billingDisplayMode: "period_end",
  };
}

function eligibilityForIndex(index) {
  if (index === 101) {
    return { total: 8, valid: 8, eligible: 6, pending: 1, rejected: 1, archived: 0 };
  }
  if (index === 20) {
    return { total: 4, valid: 4, eligible: 3, pending: 2, rejected: 0, archived: 0 };
  }
  if (index === 125) {
    return { total: 10, valid: 10, eligible: 7, pending: 0, rejected: 0, archived: 0 };
  }
  if (index % 11 === 0) {
    return { total: 2, valid: 2, eligible: 2, pending: 3, rejected: 0, archived: 0 };
  }
  if (index % 7 === 0) {
    return { total: 5, valid: 5, eligible: 4, pending: 1, rejected: 0, archived: 0 };
  }
  return { total: 9, valid: 9, eligible: 8, pending: 0, rejected: 0, archived: 0 };
}

function accountStateForIndex(index) {
  const connected = index % 5 !== 0;
  const verificationPending = index % 23 === 0;
  const actionRequired = index % 17 === 0 || verificationPending;
  return {
    connected,
    verificationPending,
    actionRequired,
    campaignActive: connected && index % 13 !== 0,
    loginStatus: connected ? "connected" : (verificationPending ? "verification_pending" : "unknown"),
    provisioningStatus: verificationPending ? "login_verification_pending" : (connected ? "provisioned" : "not_started"),
    onboardingStatus: connected ? "ready" : "pending",
    accountStatus: connected && index % 13 !== 0 ? "active" : "paused",
    hasFollowerHistory: index % 19 !== 0,
  };
}

export function buildScaleAccount(index, tenantId = SCALE_TENANT_A_ID) {
  const padded = padIndex(index);
  const username = `agency_account_${padded}`;
  const state = accountStateForIndex(index);
  return {
    tenantId,
    accountId: `acct-scale-${tenantId === SCALE_TENANT_A_ID ? "a" : "b"}-${padded}`,
    username,
    packageLabel: packageForIndex(index),
    commercial: commercialForIndex(index),
    eligibility: eligibilityForIndex(index),
    ...state,
    isHighlight: HIGHLIGHT_INDICES.has(index),
  };
}

export function buildTenantAScaleFixture() {
  const accounts = Array.from({ length: SCALE_ACCOUNT_COUNT }, (_, offset) => buildScaleAccount(offset + 1, SCALE_TENANT_A_ID));
  const linksByTenant = new Map([
    [SCALE_TENANT_A_ID, accounts.map((row) => row.accountId)],
    [SCALE_TENANT_B_ID, Array.from({ length: 5 }, (_, offset) => buildScaleAccount(offset + 1, SCALE_TENANT_B_ID).accountId)],
  ]);
  const accountsById = new Map(accounts.map((row) => [row.accountId, row]));
  for (const tenantId of [SCALE_TENANT_B_ID]) {
    for (let index = 1; index <= 5; index += 1) {
      const row = buildScaleAccount(index, tenantId);
      accountsById.set(row.accountId, row);
    }
  }
  return {
    tenantId: SCALE_TENANT_A_ID,
    accountCount: SCALE_ACCOUNT_COUNT,
    accounts,
    linksByTenant,
    accountsById,
    externalTenant: {
      tenantId: SCALE_TENANT_B_ID,
      accounts: Array.from({ length: 5 }, (_, offset) => buildScaleAccount(offset + 1, SCALE_TENANT_B_ID)),
    },
  };
}

export function toClientInstagramAccountView(row) {
  return {
    accountId: row.accountId,
    username: row.username,
    packageLabel: row.packageLabel,
    connected: row.connected,
    loginStatus: row.loginStatus,
    provisioningStatus: row.provisioningStatus,
    accountStatus: row.accountStatus,
    onboardingStatus: row.onboardingStatus,
  };
}

export function toProjectedAccountInput(row) {
  return {
    accountId: row.accountId,
    username: row.username,
    packageLabel: row.packageLabel,
    accountStatus: row.accountStatus,
    onboardingStatus: row.onboardingStatus,
    provisioningStatus: row.provisioningStatus,
    loginStatus: row.loginStatus,
    assignmentStatus: row.connected ? "assigned" : "pending_assignment",
  };
}

export function agencyScopeStorageKey(tenantId) {
  return `bmb_agency_scope_${tenantId}`;
}

export class TenantScopedScopeMemory {
  #values = new Map();

  get(key) {
    return this.#values.get(key) ?? null;
  }

  set(key, value) {
    this.#values.set(key, value);
  }
}

export function resolveAuthorizedAccountId(clientId, accountId, linksByTenant) {
  const allowed = new Set(linksByTenant.get(clientId) ?? []);
  return allowed.has(accountId) ? accountId : null;
}

/**
 * Mirrors ClientDashboard stale-response guard for account scope fetches.
 */
export function applyAccountScopeFetchResult(currentScope, requestedScope, payload) {
  if (currentScope !== requestedScope) return null;
  return payload;
}

export const AGENCY_OVERVIEW_NETWORK_BUDGET = {
  loadClientInstagramAccounts: 1,
  loadClientAccountNotificationsForClient: 1,
  loadPasswordActionAccountIds: 1,
  loadRecentInteractionEvents: 1,
  loadTargetEligibilityCountsByAccount: 1,
  perAccountInsights: 0,
  perAccountFollowerGrowth: 0,
  perAccountSubscription: 0,
};

export const ACCOUNT_SCOPE_NETWORK_BUDGET = {
  insights: 1,
  followerGrowth: 1,
  subscription: 1,
};

export class NetworkCallCounter {
  constructor() {
    this.counts = new Map();
  }

  record(name) {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
  }

  get(name) {
    return this.counts.get(name) ?? 0;
  }

  total() {
    return [...this.counts.values()].reduce((sum, value) => sum + value, 0);
  }
}

/**
 * Simulates the batched agency overview loader without per-account detail calls.
 */
export function simulateAgencyOverviewNetwork(fixture, input = {}) {
  const counter = new NetworkCallCounter();
  counter.record("loadClientInstagramAccounts");
  counter.record("loadClientAccountNotificationsForClient");
  counter.record("loadPasswordActionAccountIds");
  counter.record("loadRecentInteractionEvents");
  counter.record("loadTargetEligibilityCountsByAccount");

  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? SCALE_PAGE_SIZE;
  const search = (input.search ?? "").trim().toLowerCase().replace(/^@+/, "");
  const filter = input.filter ?? "all";

  let accounts = fixture.accounts;
  if (search) {
    accounts = accounts.filter((row) => row.username.toLowerCase().includes(search));
  }

  const start = (Math.max(1, page) - 1) * pageSize;
  const pageItems = accounts.slice(start, start + pageSize);

  return {
    counter,
    page,
    pageSize,
    pageItems,
    pageItemCount: pageItems.length,
    totalFiltered: accounts.length,
    filter,
    search,
  };
}

/**
 * Simulates account-scope detail fetches for one selected account.
 */
export function simulateAccountScopeNetwork(accountId) {
  const counter = new NetworkCallCounter();
  counter.record("insights");
  counter.record("followerGrowth");
  counter.record("subscription");
  return { counter, accountId };
}
