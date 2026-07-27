import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const fullProfilesSource = readFileSync(new URL("../route.ts", import.meta.url), "utf8");

test("live route preserves the installed BotApp HTTP contract", () => {
  assert.match(routeSource, /export async function GET\(request: Request\)/);
  assert.match(routeSource, /verifyCompassRelayKey\(request\.headers\)/);
  assert.match(routeSource, /account_ids/);
  assert.match(routeSource, /profiles_live_batched_v2/);
  assert.match(routeSource, /projection_mode: "full_snapshot"/);
  assert.match(routeSource, /Cache-Control", "private, no-store"/);
  assert.doesNotMatch(routeSource, /cursor|etag/i);
});

test("live route is read-only and projects only safe selected columns", () => {
  assert.doesNotMatch(routeSource, /\.(?:insert|update|upsert|delete|rpc)\(/);
  assert.doesNotMatch(routeSource, /credential|password|vault|secret|service_role|authorization/i);
  assert.match(routeSource, /\.select\("id,status,admin_lifecycle_status"\)/);
  assert.match(routeSource, /\.select\("id,account_id,status,run_id,cancel_requested_at,created_at,claimed_at"\)/);
});

test("live route distinguishes missing and archived accounts", () => {
  assert.match(routeSource, /removed_account_ids: removedAccountIds/);
  assert.match(routeSource, /archived_account_ids: archivedAccountIds/);
  assert.match(routeSource, /requestedAccountIds\.filter\(\(id\) => !existingAccountIdSet\.has\(id\)\)/);
});

test("backend query failures are errors and never empty successful projections", () => {
  assert.match(routeSource, /if \(accounts\.error\) return jsonError\("Could not load live Profiles projection\.", 500\)/);
  assert.match(routeSource, /if \(failed\?\.error\) return jsonError\("Could not load live Profiles projection\.", 500\)/);
});

test("full and live Profiles routes share the canonical SAST freshness contract", () => {
  assert.match(routeSource, /businessDayWindow\(nowDate\)/);
  assert.doesNotMatch(routeSource, /now\.slice\(0, 10\).*T00:00:00\.000Z/);
  assert.match(routeSource, /canonical_persisted_actions_sast_v1/);
  assert.match(fullProfilesSource, /canonical_persisted_actions_sast_v1/);
  assert.match(fullProfilesSource, /businessDayWindow/);
});
