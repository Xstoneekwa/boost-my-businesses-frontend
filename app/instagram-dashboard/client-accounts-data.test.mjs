import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dataSource = readFileSync(new URL("./client-accounts-data.ts", import.meta.url), "utf8");
const manageSource = readFileSync(new URL("./manage-data.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("./client-accounts/page.tsx", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../api/instagram-dashboard/client-accounts/route.ts", import.meta.url), "utf8");
const statusRouteSource = readFileSync(new URL("../api/instagram-dashboard/accounts/status/route.ts", import.meta.url), "utf8");
const actionMenuSource = readFileSync(new URL("./client-accounts/AccountStatusActionMenu.tsx", import.meta.url), "utf8");
const lifecycleRegistrySource = readFileSync(new URL("../../lib/instagram-dashboard/lifecycle-communication-registry.ts", import.meta.url), "utf8");

test("client accounts normalize needs assistance as its own non-active status", () => {
  assert.match(dataSource, /"needs_assistance"/);
  assert.match(dataSource, /if \(needsAssistance\) return \{ status: "needs_assistance"/);
  assert.match(dataSource, /"needs_credentials", "needs_login_verification", "needs_phone_assignment"/);
  assert.match(dataSource, /readiness\?\.overall_readiness_reason \?\? `readiness_\$\{readinessStatus\}`/);
  assert.match(pageSource, /item\.operationsStatus === "needs_assistance"/);
  assert.match(pageSource, /function statusSubtext\(item: ClientAccountOperationsItem\)/);
  assert.match(pageSource, /needs assistance · \$\{reason\}/);
  assert.doesNotMatch(pageSource, /item\.needsAssistance \? "needs assistance" : item\.operationsStatus/);
});

test("paused lifecycle has priority over assistance and readiness projections", () => {
  const pausedBoundary = dataSource.indexOf('if (includesAny(admin, ["paused"]))');
  const assistanceBoundary = dataSource.indexOf('if (needsAssistance) return { status: "needs_assistance"');
  assert.ok(pausedBoundary >= 0);
  assert.ok(assistanceBoundary >= 0);
  assert.ok(pausedBoundary < assistanceBoundary);
});

test("client accounts email projection uses safe DB sources and copy UI", () => {
  assert.match(manageSource, /from\("ig_account_settings"\)/);
  assert.match(manageSource, /account_id,email/);
  assert.match(manageSource, /resolveAccountEmail/);
  assert.match(dataSource, /emailSource/);
  assert.match(dataSource, /emailAvailable/);
  assert.match(dataSource, /clientContactEmail/);
  assert.match(dataSource, /resolveClientCommunicationEmail/);
  assert.match(dataSource, /from\("clients"\)/);
  assert.match(dataSource, /from\("client_users"\)/);
  assert.match(dataSource, /\.schema\("auth"\)/);
  assert.doesNotMatch(dataSource, /resolveAccountEmail/);
  assert.match(pageSource, /EmailCopyButton/);
  assert.doesNotMatch(pageSource, /<td>\{item\.emailDisplay\}<\/td>/);
});

test("client accounts relay returns normalized projection", () => {
  assert.match(routeSource, /getClientAccountsOperationsData/);
  assert.match(routeSource, /accounts: clientAccounts\.items/);
  assert.match(routeSource, /source: "client_accounts_operations_projection"/);
  assert.match(routeSource, /\[client-accounts\] botapp_projection/);
});

test("client accounts lifecycle actions are real and expose disabled reasons", () => {
  assert.match(dataSource, /ClientAccountLifecycleActionAvailability/);
  assert.match(pageSource, /actions=\{item\.lifecycleActions\}/);
  assert.match(statusRouteSource, /reactivateBlockReason/);
  assert.match(statusRouteSource, /Resolve credential reauth before reactivation/);
  assert.match(statusRouteSource, /executeCommercialAccountLifecycle/);
  assert.match(dataSource, /ACCOUNT_LIFECYCLE_ACTION_MATRIX/);
  assert.match(actionMenuSource, /lifecycleActionCopy/);
  assert.match(actionMenuSource, /locale = "en"/);
  assert.match(pageSource, /locale="en"/);
  assert.doesNotMatch(actionMenuSource, /Suspendre la campagne/);
  assert.doesNotMatch(actionMenuSource, /Résilier le service du compte/);
  assert.match(lifecycleRegistrySource, /active: \{ pause: true, cancel: true, mark_needs_assistance: true, reactivate: false \}/);
  assert.match(lifecycleRegistrySource, /paused: \{ pause: false, cancel: true, mark_needs_assistance: true, reactivate: true \}/);
  assert.match(lifecycleRegistrySource, /cancelled: \{ pause: false, cancel: false, mark_needs_assistance: false, reactivate: false \}/);
});

test("client accounts relay projects needs more targets fields", () => {
  assert.match(dataSource, /needsMoreTargets/);
  assert.match(dataSource, /eligibleTargetCount/);
  assert.match(dataSource, /loadNeedsMoreTargetAccountsProjectionForAccounts/);
  assert.match(routeSource, /accounts: clientAccounts\.items/);
});
