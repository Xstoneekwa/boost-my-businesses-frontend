import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = [
  ["settings", "./route.ts"],
  ["follow-filters", "./follow-filters/route.ts"],
  ["dm", "./dm/route.ts"],
  ["unfollow", "./unfollow/route.ts"],
  ["follow-sources", "./follow-sources/route.ts"],
];

for (const [label, relativePath] of routes) {
  test(`${label} settings accept BotApp relay auth`, () => {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /requireRelayOrAdmin\(request/);
    assert.doesNotMatch(source, /requireInstagramAdmin\(\)/);
  });
}

test("settings save excludes ig_accounts lifecycle projection fields from ig_account_settings writes", () => {
  const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /"admin_lifecycle_status"/);
  assert.match(source, /runtimeProjectionKeys[\s\S]*"admin_lifecycle_status"/);
  assert.match(source, /const baseSettings = existing/);
  assert.doesNotMatch(source, /normalizeSettings\(body, accountId\)/);
});

test("shared relay auth helper is exported from instagram dashboard utils", () => {
  const utilsSource = readFileSync(new URL("../_utils.ts", import.meta.url), "utf8");
  assert.match(utilsSource, /export async function requireRelayOrAdmin/);
  assert.match(utilsSource, /verifyCompassRelayKey/);
});
