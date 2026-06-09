import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manageSource = readFileSync(new URL("./manage-data.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("Manage enriches legacy accounts with modern assignment phone and clone data", () => {
  assert.match(manageSource, /from\("account_assignments"\)/);
  assert.match(manageSource, /from\("phone_devices"\)/);
  assert.match(manageSource, /from\("phone_app_instances"\)/);
  assert.match(manageSource, /visible_label/);
  assert.match(manageSource, /package_name/);
  assert.match(manageSource, /phoneName: appLabel \? `\$\{phoneLabel\} · \$\{appLabel\}` : phoneLabel/);
});

test("Manage maps active credentials separately from login status", () => {
  assert.match(manageSource, /from\("account_credentials"\)/);
  assert.match(manageSource, /credentialsStatus === "active" \? "active"/);
  assert.match(manageSource, /reauthRequired: credentialsStatus === "active" \? false/);
  assert.match(manageSource, /pending_login/);
});

test("Manage exposes server-side readiness projection without raw device or secret fields", () => {
  assert.match(manageSource, /buildAdminReadinessProjection/);
  assert.match(manageSource, /from\("account_dashboard_actions"\)/);
  assert.match(manageSource, /from\("ig_account_dm_settings"\)/);
  assert.match(manageSource, /from\("ig_account_unfollow_settings"\)/);
  assert.match(manageSource, /commercialAddonsLabel: account\.commercialAddonsLabel/);
  assert.match(manageSource, /entitlementSummary: account\.entitlementSummary/);
  assert.match(manageSource, /is_launchable,usable_for_auto_login/);
  assert.match(pageSource, /ReadinessSummary/);
  assert.match(pageSource, /readinessLabel/);
  assert.doesNotMatch(pageSource, /device_id|app_instance_id|secret_ref|Vault|service_role|raw XML|screenshot|ADB serial/);
});

test("Manage renders account avatar with canonical username fallback", () => {
  assert.match(pageSource, /function AccountAvatar/);
  assert.match(pageSource, /profileImageUrl/);
  assert.match(pageSource, /\/api\/instagram-dashboard\/avatar\?kind=account/);
  assert.match(pageSource, /ig-dashboard-account-avatar-fallback/);
  assert.match(pageSource, /instagramCanonicalUsername/);
});
