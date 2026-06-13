import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const manageSource = readFileSync(
  new URL("../../../../../app/instagram-dashboard/manage-data.ts", import.meta.url),
  "utf8",
);
const clientSource = readFileSync(
  new URL("../../../../../app/instagram-dashboard/client-accounts-data.ts", import.meta.url),
  "utf8",
);
const clientAccountsRouteSource = readFileSync(
  new URL("../../client-accounts/route.ts", import.meta.url),
  "utf8",
);

test("lifecycle trash patch does not write admin_lifecycle_status", () => {
  assert.doesNotMatch(source, /admin_lifecycle_status:\s*"trashed"/);
  assert.doesNotMatch(source, /admin_lifecycle_status:\s*"archived"/);
  assert.doesNotMatch(source, /admin_lifecycle_status:\s*"active"/);
});

test("lifecycle trash patch updates account lifecycle fields", () => {
  assert.match(source, /status:\s*"trashed"/);
  assert.match(source, /trashed_at:\s*nowIso/);
  assert.match(source, /scheduled_delete_at:\s*addDays\(now,\s*30\)/);
});

test("lifecycle archive patch updates archived lifecycle fields", () => {
  assert.match(source, /status:\s*"archived"/);
  assert.match(source, /archived_at:\s*nowIso/);
  assert.match(source, /scheduled_trash_at:\s*addDays\(now,\s*30\)/);
});

test("lifecycle restore patch clears trash/archive timestamps", () => {
  assert.match(source, /status:\s*"active"/);
  assert.match(source, /restored_at:\s*nowIso/);
  assert.match(source, /archived_at:\s*null/);
  assert.match(source, /trashed_at:\s*null/);
});

test("lifecycle route maps check constraint errors to safe client message", () => {
  assert.match(source, /safeLifecycleClientError/);
  assert.match(source, /Move to Bin failed\. Lifecycle status mapping is invalid\./);
  assert.match(source, /error_code:\s*safeError\.error_code/);
  assert.match(source, /\[lifecycle\] account_update_failed/);
});

test("lifecycle route blocks automation flags and active runtime", () => {
  assert.match(source, /automation_flags_must_be_false/);
  assert.match(source, /hasActiveRuntime/);
  assert.match(source, /run_started:\s*false/);
  assert.match(source, /provisioning_started:\s*false/);
  assert.match(source, /login_started:\s*false/);
});

test("manage projection buckets lifecycle from accountLifecycleStatus not admin ops status", () => {
  assert.match(manageSource, /accountLifecycleStatus/);
  assert.match(manageSource, /enrichWithIgAccountLifecycle/);
  assert.match(manageSource, /const accountStatus = normalize\(account\.accountLifecycleStatus/);
  assert.doesNotMatch(manageSource, /const status = normalize\(account\.adminStatus\)/);
});

test("client projection buckets lifecycle from accountLifecycleStatus", () => {
  assert.match(clientSource, /account\.accountLifecycleStatus/);
});

test("client accounts API exposes the same lifecycle buckets as BotApp/Admin", () => {
  assert.match(clientAccountsRouteSource, /activeAccounts: manage\.activeAccounts/);
  assert.match(clientAccountsRouteSource, /archivedAccounts: manage\.archivedAccounts/);
  assert.match(clientAccountsRouteSource, /trashedAccounts: manage\.trashedAccounts/);
});
