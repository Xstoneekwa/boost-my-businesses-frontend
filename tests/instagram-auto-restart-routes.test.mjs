import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const files = [
  "app/api/instagram-dashboard/auto-restart/overview/route.ts",
  "app/api/instagram-dashboard/auto-restart/dry-run/route.ts",
  "app/api/instagram-dashboard/auto-restart/action-preview/route.ts",
  "app/api/instagram-dashboard/botapp/overview/route.ts",
  "app/api/instagram-dashboard/devices/route.ts",
  "app/api/instagram-dashboard/profiles/route.ts",
  "app/api/instagram-dashboard/client-accounts/route.ts",
  "app/api/instagram-dashboard/credentials-actions/route.ts",
  "app/api/instagram-dashboard/activity-log/route.ts",
];

test("Auto Restart API routes support relay/admin auth", () => {
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /verifyCompassRelayKey|requireInstagramAdmin/);
  }
});

test("Auto Restart preview routes do not enqueue runtime work", () => {
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /create_account_run_request|runs\/start|runner\.py|insertManualRunAudit/i);
  }
});

test("Auto Restart action preview is dry-run only", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/auto-restart/action-preview/route.ts", import.meta.url), "utf8");
  assert.match(source, /mutation_executed:\s*false/);
  assert.match(source, /actions_executable:\s*false/);
  assert.match(source, /audit_required_before_activation:\s*true/);
});

test("BotApp overview returns partial-safe sections", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/botapp/overview/route.ts", import.meta.url), "utf8");
  assert.match(source, /type SectionResult/);
  assert.match(source, /section\(getManageData\)/);
  assert.match(source, /section\(getDashboardDevices\)/);
  assert.match(source, /section\(getActivityLogData\)/);
  assert.match(source, /endpoint_statuses/);
});

test("BotApp live data endpoints use existing dashboard loaders", () => {
  const expectations = new Map([
    ["app/api/instagram-dashboard/profiles/route.ts", /getManageData/],
    ["app/api/instagram-dashboard/client-accounts/route.ts", /getManageData/],
    ["app/api/instagram-dashboard/credentials-actions/route.ts", /getCredentialsActionsData/],
    ["app/api/instagram-dashboard/activity-log/route.ts", /getActivityLogData/],
    ["app/api/instagram-dashboard/devices/route.ts", /getDashboardDevices/],
  ]);
  for (const [file, pattern] of expectations) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, pattern);
  }
});

test("BotApp profiles endpoint reconciles counters from ig_runs totals", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/profiles/route.ts", import.meta.url), "utf8");
  assert.match(source, /total_like/);
  assert.match(source, /reconcileSocialCounters/);
  assert.match(source, /ig_interaction_events/);
  assert.match(source, /ig_action_logs\+ig_runs\+ig_interaction_events/);
});

test("BotApp profiles endpoint projects queued and starting run requests", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/profiles/route.ts", import.meta.url), "utf8");
  assert.match(source, /"queued"/);
  assert.match(source, /"starting"/);
  assert.match(source, /activeRunRequestStatus/);
});

test("BotApp profiles endpoint exposes current run counters and runtime indicator", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/profiles/route.ts", import.meta.url), "utf8");
  assert.match(source, /currentRunCounters/);
  assert.match(source, /runScopedCounters/);
  assert.match(source, /runtimeIndicator/);
  assert.match(source, /partial_safe_stopped/);
});

test("settings saves update ig_account_settings updated_at", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/settings/route.ts", import.meta.url), "utf8");
  assert.match(source, /updated_at:\s*new Date\(\)\.toISOString\(\)/);
});
