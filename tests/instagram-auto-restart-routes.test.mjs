import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const files = [
  "app/api/instagram-dashboard/auto-restart/overview/route.ts",
  "app/api/instagram-dashboard/auto-restart/dry-run/route.ts",
  "app/api/instagram-dashboard/auto-restart/action-preview/route.ts",
  "app/api/instagram-dashboard/auto-restart/settings/route.ts",
  "app/api/instagram-dashboard/auto-restart/tick/route.ts",
  "app/api/instagram-dashboard/auto-restart/execute/route.ts",
];

test("Auto Restart API routes support relay/admin auth", () => {
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    if (file.endsWith("tick/route.ts")) {
      assert.match(source, /extractAutoRestartTickToken/);
      assert.doesNotMatch(source, /verifyCompassRelayKey/);
      continue;
    }
    assert.match(source, /verifyCompassRelayKey|requireInstagramAdmin|requireRelayOrAdmin/);
  }
});

test("Auto Restart settings route persists without direct runner launch", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/auto-restart/settings/route.ts", import.meta.url), "utf8");
  assert.match(source, /auto_restart_settings/);
  assert.match(source, /auto_restart_settings_updated/);
  assert.doesNotMatch(source, /runner\.py/);
});

test("Auto Restart tick route delegates to runAutoRestartTick on POST only", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/auto-restart/tick/route.ts", import.meta.url), "utf8");
  assert.match(source, /export async function POST/);
  assert.match(source, /runAutoRestartTick/);
  assert.match(source, /getAutoRestartTickStatus/);
  assert.doesNotMatch(source, /verifyCompassRelayKey/);
});

test("Auto Restart execute route uses confirmed mutations", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/auto-restart/execute/route.ts", import.meta.url), "utf8");
  assert.match(source, /confirmed/);
  assert.match(source, /runAutoRestartTick/);
});

test("Auto Restart dry-run route does not enqueue", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/auto-restart/dry-run/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /create_account_run_request/);
});

test("Auto Restart action preview exposes execute route for mutations", () => {
  const source = readFileSync(new URL("../app/api/instagram-dashboard/auto-restart/action-preview/route.ts", import.meta.url), "utf8");
  assert.match(source, /execute_route/);
  assert.match(source, /actions_executable/);
});
