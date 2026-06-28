import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clientMaxAccountsLimit,
  projectClientAccountRow,
  rejectTechnicalClientFields,
} from "./guards.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("rejectTechnicalClientFields blocks device and clone fields", () => {
  assert.equal(rejectTechnicalClientFields({ username: "botapp" }), null);
  assert.match(
    rejectTechnicalClientFields({ username: "botapp", device_id: "phone-1" }) || "",
    /Technical assignment fields are not allowed/,
  );
  assert.match(
    rejectTechnicalClientFields({ clone_index: 2 }) || "",
    /Technical assignment fields are not allowed/,
  );
});

test("client account projection hides technical details", () => {
  const row = projectClientAccountRow({
    accountId: "acct-1",
    username: "botapp",
    packageLabel: "Growth",
    loginStatus: "unknown",
    assignmentStatus: "pending_assignment",
  });
  assert.equal(row.username, "botapp");
  assert.equal(row.connected, false);
  assert.equal(row.readinessLabel, "");
  const readyRow = projectClientAccountRow({
    accountId: "acct-1",
    username: "botapp",
    readinessStatus: "ready_to_connect",
  });
  assert.equal(readyRow.clientReadinessStatus, "ready_to_connect");
});

test("client create route requires tenant session and rejects technical fields", () => {
  const routeSource = source("../../app/api/instagram-client/accounts/route.ts");
  assert.match(routeSource, /requireClientInstagramSession/);
  assert.match(routeSource, /rejectTechnicalClientFields/);
  assert.match(routeSource, /createClientInstagramAccount/);
  assert.match(routeSource, /loadClientInstagramAccounts/);
  assert.match(routeSource, /export async function GET/);
});

test("client readiness and connect routes enforce ownership", () => {
  const readinessRoute = source("../../app/api/instagram-client/accounts/[accountId]/check-readiness/route.ts");
  const connectRoute = source("../../app/api/instagram-client/accounts/[accountId]/connect/route.ts");
  assert.match(readinessRoute, /authorizeClientInstagramAccount/);
  assert.match(connectRoute, /authorizeClientInstagramAccount/);
  assert.match(readinessRoute, /checkClientAccountReadiness/);
  assert.match(connectRoute, /connectClientInstagramAccount/);
});

test("add account modal exposes accessible instagram password visibility toggle", () => {
  const sectionSource = source("../../app/instagram-client/ClientAccountsSection.tsx");
  assert.match(sectionSource, /showInstagramPassword/);
  assert.match(sectionSource, /type=\{showInstagramPassword \? "text" : "password"\}/);
  assert.match(sectionSource, /Afficher le mot de passe Instagram/);
  assert.match(sectionSource, /Masquer le mot de passe Instagram/);
  assert.match(sectionSource, /cd-password-toggle/);
});

test("check-readiness route stays passive and never enqueues connect", () => {
  const readinessRoute = source("../../app/api/instagram-client/accounts/[accountId]/check-readiness/route.ts");
  const connectSource = source("./connect-account.ts");
  assert.match(readinessRoute, /checkClientAccountReadiness/);
  assert.match(connectSource, /dryRun: true/);
  assert.match(connectSource, /mode: PASSIVE_READINESS_MODE/);
  assert.doesNotMatch(readinessRoute, /connectClientInstagramAccount/);
});

test("client dashboard UI exposes one add CTA per context", () => {
  const sectionSource = source("../../app/instagram-client/ClientAccountsSection.tsx");
  const modalSource = source("../../app/instagram-client/ClientAccountProcessModal.tsx");
  const dashboardSource = source("../../app/instagram-client/ClientDashboard.tsx");
  assert.match(sectionSource, /choose-plan/);
  assert.match(sectionSource, /handleAddAccountClick/);
  assert.match(sectionSource, /isEmpty \?/);
  assert.match(sectionSource, /Add Instagram account|Ajouter un compte Instagram/);
  assert.match(sectionSource, /ClientAccountProcessModal/);
  assert.match(sectionSource, /projectAddAccountProcess/);
  assert.match(sectionSource, /errorCode: processModal\.errorCode/);
  assert.match(sectionSource, /projectConnectProcess/);
  assert.match(sectionSource, /refreshFromServer/);
  assert.match(sectionSource, /POLL_MAX_ATTEMPTS/);
  assert.match(modalSource, /cd-progress-steps/);
  assert.match(modalSource, /onRefresh/);
  assert.doesNotMatch(sectionSource, /device_id|clone_index|Start run|Stop worker/i);
  assert.match(dashboardSource, /activeView === "overview"/);
  assert.match(dashboardSource, /accounts=\{hasLinkedInstagramAccount \? initialAccounts : \[\]\}/);
  assert.match(dashboardSource, /cd-preview-banner/);
});

test("client accounts refresh route and connect/readiness return account snapshots", () => {
  const connectSource = source("./connect-account.ts");
  const readinessRoute = source("../../app/api/instagram-client/accounts/[accountId]/check-readiness/route.ts");
  const connectRoute = source("../../app/api/instagram-client/accounts/[accountId]/connect/route.ts");
  assert.match(connectSource, /reloadClientAccountSnapshot/);
  assert.match(connectSource, /attachOperationPending/);
  assert.match(readinessRoute, /clientId: session\.clientId/);
  assert.match(connectRoute, /clientId: session\.clientId/);
});

test("client dashboard keeps non-overview views visible without linked instagram account", () => {
  const dashboardSource = source("../../app/instagram-client/ClientDashboard.tsx");
  assert.match(dashboardSource, /activeView === "activity"/);
  assert.doesNotMatch(dashboardSource, /hasLinkedInstagramAccount && activeView === "activity"/);
  assert.match(dashboardSource, /activeView === "targeting"/);
  assert.doesNotMatch(dashboardSource, /hasLinkedInstagramAccount && activeView === "targeting"/);
  assert.match(dashboardSource, /activeView === "account"/);
  assert.doesNotMatch(dashboardSource, /hasLinkedInstagramAccount && activeView === "account"/);
  assert.match(dashboardSource, /buildOverviewStats/);
  assert.match(dashboardSource, /buildSubscriptionOverviewCard/);
  assert.match(dashboardSource, /hasOverviewInsights/);
  assert.doesNotMatch(dashboardSource, /useLiveData \? mapInsightsActivity\(accountInsights!\.activity, lang\) : FD/);
  assert.match(dashboardSource, /handleSaveProfile/);
  assert.match(dashboardSource, /cd-tg2-cols/);
  assert.match(dashboardSource, /cd-preview-banner/);
  assert.match(dashboardSource, /t\.account\.profile/);
});

test("client workspace and insights routes are tenant-safe", () => {
  const workspaceRoute = source("../../app/api/instagram-client/workspace/route.ts");
  const insightsRoute = source("../../app/api/instagram-client/accounts/[accountId]/insights/route.ts");
  const accountsRoute = source("../../app/api/instagram-client/accounts/route.ts");
  const pageSource = source("../../app/instagram-client/page.tsx");
  const workspaceData = source("./workspace-data.ts");
  const loaderSource = source("./load-client-instagram-accounts.ts");

  assert.match(workspaceRoute, /requireClientInstagramSession/);
  assert.match(workspaceRoute, /updateClientWorkspaceView/);
  assert.match(insightsRoute, /authorizeClientInstagramAccount/);
  assert.match(insightsRoute, /loadClientAccountInsights/);
  assert.match(accountsRoute, /requireClientInstagramSession/);
  assert.match(accountsRoute, /loadClientInstagramAccounts\(session\.clientId\)/);
  assert.match(loaderSource, /\.eq\("client_id", clientId\)/);
  assert.match(loaderSource, /projectPassiveReadinessByAccountId/);
  assert.match(pageSource, /loadClientInstagramAccounts/);
  assert.match(pageSource, /getClientWorkspaceView/);
  assert.match(pageSource, /loadClientAccountInsights/);
  assert.match(pageSource, /loadClientFollowerGrowthSeries/);
  assert.match(workspaceData, /rejectTechnicalClientFields/);
});

test("create account supports dry_run flag in route and service", () => {
  const createSource = source("./create-account.ts");
  const routeSource = source("../../app/api/instagram-client/accounts/route.ts");
  assert.match(createSource, /getReservedEntitlementForClient/);
  assert.match(createSource, /entitlement_required/);
  assert.match(createSource, /resolveServerCredentialsConfig/);
  assert.match(createSource, /credentials_unavailable/);
  assert.doesNotMatch(createSource, /INSTAGRAM_CREDENTIALS_API_TOKEN/);
  assert.doesNotMatch(createSource, /defaultAddProfileCommercialPackage/);
  assert.match(createSource, /dryRun/);
  assert.match(routeSource, /dry_run/);
});

test("client add account persists login email through shared helper", () => {
  const createSource = source("./create-account.ts");
  const routeSource = source("../../app/api/instagram-client/accounts/route.ts");
  const persistSource = source("../instagram-dashboard/persist-account-login-email.ts");

  assert.match(createSource, /persistAccountLoginEmail/);
  assert.match(createSource, /parseLoginEmailInput/);
  assert.match(createSource, /profileVerificationPayloadForInsert/);
  assert.doesNotMatch(createSource, /instagram_verification_status/);
  assert.match(createSource, /ig_account_settings/);
  assert.match(routeSource, /loginEmail/);
  assert.match(routeSource, /email_invalid/);
  assert.match(persistSource, /normalizeSafeEmail/);
  assert.doesNotMatch(createSource, /i_m_your_traker|growth_with_bmb/);
});

test("client add account credentials ingestion uses client actor attribution", () => {
  const createSource = source("./create-account.ts");
  assert.match(createSource, /actor_type:\s*"client"/);
  assert.match(createSource, /source_surface:\s*"instagram_client"/);
  assert.match(createSource, /submit_add_profile_credentials/);
  assert.match(createSource, /credentials_ingestion_failed/);
  assert.doesNotMatch(createSource, /actor_type:\s*"admin"/);
  assert.doesNotMatch(createSource, /console\.(log|info|warn|error)\([\s\S]*password/);
});

test("client add account rolls back ig_accounts after credentials ingestion failure", () => {
  const createSource = source("./create-account.ts");
  assert.match(createSource, /await submitClientCredentials[\s\S]*const ownership = await ensureAddProfileOwnership/);
  assert.match(createSource, /catch \{[\s\S]*ig_accounts[\s\S]*delete[\s\S]*credentials_ingestion_failed/);
  assert.match(createSource, /await submitClientCredentials[\s\S]*markEntitlementConsumed/);
});

test("client add account without email stays optional", () => {
  const createSource = source("./create-account.ts");
  assert.match(createSource, /if \(email\) \{/);
  assert.doesNotMatch(createSource, /email_required/);
});

test("rejectTechnicalClientFields blocks subscription and assignment fields", () => {
  for (const key of ["package", "plan", "role", "tenant_id", "client_id", "account_id", "assignment", "payment_method", "invoice"]) {
    assert.match(
      rejectTechnicalClientFields({ [key]: "blocked" }) || "",
      /Technical assignment fields are not allowed/,
      `expected rejection for ${key}`,
    );
  }
});

test("client workspace data exposes profile, linked accounts, and billing summary", () => {
  const workspaceData = source("./workspace-data.ts");
  const workspaceRoute = source("../../app/api/instagram-client/workspace/route.ts");
  const dashboardSource = source("../../app/instagram-client/ClientDashboard.tsx");

  assert.match(workspaceData, /linkedInstagramAccounts/);
  assert.match(workspaceData, /client_instagram_accounts/);
  assert.match(workspaceData, /ig_accounts/);
  assert.match(workspaceData, /linkedAccountPackageCodes/);
  assert.match(workspaceData, /projectClientSubscriptionDisplay/);
  assert.match(workspaceData, /getAccountPackageSummaries/);
  assert.match(workspaceData, /subscriptionPriceLabel/);
  assert.match(workspaceData, /accountManager/);
  assert.match(workspaceData, /readMetadataString\(metadata/);
  assert.match(workspaceData, /emailEditable: false/);
  assert.match(workspaceRoute, /Login email cannot be changed/);
  assert.match(workspaceRoute, /first_name/);
  assert.match(workspaceRoute, /last_name/);
  assert.match(workspaceRoute, /phone/);
  assert.doesNotMatch(workspaceRoute, /body\.contact_email !== undefined \? readString/);

  assert.match(dashboardSource, /linkedAccountsForAccountTab/);
  assert.match(dashboardSource, /formatLinkedAccountLine/);
  assert.match(dashboardSource, /instagramSummary/);
  assert.match(dashboardSource, /memberSinceValue/);
  assert.match(dashboardSource, /nextPending/);
  assert.match(dashboardSource, /PaymentBillingDrawer/);
  assert.match(dashboardSource, /setBillingDrawerOpen/);
  assert.match(dashboardSource, /billingInvoicesSoon/);
  assert.match(dashboardSource, /changePlanHelp/);
  assert.match(dashboardSource, /emailHint/);
  assert.match(dashboardSource, /readOnly/);
  assert.doesNotMatch(dashboardSource, /contact_email: profileForm\.email/);
});

test("client workspace GET route is tenant-scoped and returns linked instagram accounts", () => {
  const workspaceRoute = source("../../app/api/instagram-client/workspace/route.ts");
  const pageSource = source("../../app/instagram-client/page.tsx");

  assert.match(workspaceRoute, /getClientWorkspaceView\(session\.clientId/);
  assert.match(workspaceRoute, /requireClientInstagramSession/);
  assert.match(pageSource, /getClientWorkspaceView/);
  assert.match(pageSource, /client_instagram_accounts/);
});

test("client account tab uses workspace linked accounts instead of mock instagram field", () => {
  const dashboardSource = source("../../app/instagram-client/ClientDashboard.tsx");
  assert.match(dashboardSource, /workspace\?\.linkedInstagramAccounts/);
  assert.match(dashboardSource, /Aucun compte lié|No linked account/);
  assert.match(dashboardSource, /subscriptionPlanValue/);
  assert.doesNotMatch(dashboardSource, /t\.account\.planVal/);
  assert.doesNotMatch(dashboardSource, /t\.account\.sinceVal/);
  assert.doesNotMatch(dashboardSource, /t\.account\.nextVal/);
});
