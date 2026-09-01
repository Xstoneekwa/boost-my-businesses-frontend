import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canonicalRuntimeFallbackProfiles,
  mergeCanonicalProfilesWithRuntime,
  missingRuntimeAccountIds,
  replaceRuntimeProfiles,
} from "./profile-core.ts";
import { selectCanonicalVisibleProfiles } from "./profile-visibility.ts";

const liveRouteSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const profileRouteSource = readFileSync(new URL("../route.ts", import.meta.url), "utf8");

function parity(base, runtime = {}) {
  return mergeCanonicalProfilesWithRuntime([base], [{ accountId: base.accountId, ...runtime }])[0];
}

test("parity matrix: ready account preserves canonical readiness and package mapping", () => {
  const row = parity({ accountId: "ready", readiness: "ready", eligibility: "can_start", packageLabel: "Premium" });
  assert.deepEqual([row.readiness, row.eligibility, row.packageLabel], ["ready", "can_start", "Premium"]);
});

test("parity matrix: active runtime overlays only runtime fields", () => {
  const row = parity(
    { accountId: "active", username: "stable", packageLabel: "Pro" },
    { executionPhase: "ACTIVE", activeRunId: "run-1", countersToday: { follows: 7 } },
  );
  assert.equal(row.username, "stable");
  assert.equal(row.packageLabel, "Pro");
  assert.equal(row.executionPhase, "ACTIVE");
  assert.deepEqual(row.countersToday, { follows: 7 });
});

test("parity matrix: restriction blocker and 48H label remain canonical", () => {
  const operationalBlocker = { category: "instagram_restriction", reasonCode: "instagram_restriction_active", label: "48H pause required", blocking: true };
  const row = parity({ accountId: "restricted", readiness: "ready", eligibility: "blocked_now", growth_ready: true, operationalBlocker });
  assert.strictEqual(row.operationalBlocker, operationalBlocker);
  assert.equal(row.growth_ready, true);
  assert.equal(row.eligibility, "blocked_now");
});

test("parity matrix: operational incident-only blocker is retained", () => {
  const blocker = { category: "other", reasonCode: "incident_only", sourceType: "incident", blocking: true };
  assert.strictEqual(parity({ accountId: "incident", operationalBlocker: blocker }).operationalBlocker, blocker);
});

test("parity matrix: login and identity blocker fields are retained", () => {
  const row = parity({ accountId: "login", loginStatus: "checkpoint", loginIdentityProofStatus: "required_unverified", connected: false });
  assert.deepEqual([row.loginStatus, row.loginIdentityProofStatus, row.connected], ["checkpoint", "required_unverified", false]);
});

test("parity matrix: terminal and cancelled accounts remain excluded", () => {
  const visible = selectCanonicalVisibleProfiles([
    { accountId: "active", accountLifecycleStatus: "active" },
    { accountId: "terminal", accountLifecycleStatus: "cancelled" },
  ]);
  assert.deepEqual(visible.map((row) => row.accountId), ["active"]);
});

test("parity matrix: device and assignment unavailability are retained", () => {
  const row = parity({ accountId: "device", deviceId: "phone-1", assignmentStatus: "blocked", assignmentHealth: "requires_attention", phoneStatus: "offline" });
  assert.deepEqual([row.deviceId, row.assignmentStatus, row.assignmentHealth, row.phoneStatus], ["phone-1", "blocked", "requires_attention", "offline"]);
});

test("parity matrix: multiple accounts preserve canonical order", () => {
  const rows = mergeCanonicalProfilesWithRuntime(
    [{ accountId: "b", username: "second" }, { accountId: "a", username: "first" }],
    [{ accountId: "a", executionPhase: "ACTIVE" }, { accountId: "b", executionPhase: "TERMINAL" }],
  );
  assert.deepEqual(rows.map((row) => row.accountId), ["b", "a"]);
  assert.deepEqual(rows.map((row) => row.executionPhase), ["TERMINAL", "ACTIVE"]);
});

test("parity matrix: empty account set stays empty", () => {
  assert.deepEqual(mergeCanonicalProfilesWithRuntime([], []), []);
  assert.deepEqual(missingRuntimeAccountIds([], []), []);
});

test("parity matrix: newly visible accounts are detected for one fallback batch", () => {
  assert.deepEqual(
    missingRuntimeAccountIds([{ accountId: "known" }, { accountId: "new" }], [{ accountId: "known" }]),
    ["new"],
  );
});

test("parity matrix: package fallback reuses the canonical base in one batch", () => {
  const base = [
    { accountId: "premium", packageLabel: "Premium" },
    { accountId: "growth", packageLabel: "Growth" },
  ];
  const runtime = [
    { accountId: "premium", capsSource: "ig_account_settings+ig_action_logs", marker: "placeholder" },
    { accountId: "growth", capsSource: "ig_account_settings+ig_action_logs" },
  ];
  assert.deepEqual(canonicalRuntimeFallbackProfiles(base, runtime).map((row) => row.accountId), ["premium"]);
  assert.deepEqual(
    replaceRuntimeProfiles(runtime, [{ accountId: "premium", capsSource: "account_package_summary+ig_account_settings", marker: "canonical" }])
      .find((row) => row.accountId === "premium")?.marker,
    "canonical",
  );
});

test("parity matrix: growth_ready cannot erase an active blocker", () => {
  const blocker = { reasonCode: "instagram_restriction_active", blocking: true };
  const row = parity({ accountId: "growth", growth_ready: true, eligibility: "blocked_now", operationalBlocker: blocker });
  assert.equal(row.growth_ready, true);
  assert.equal(row.eligibility, "blocked_now");
  assert.strictEqual(row.operationalBlocker, blocker);
});

test("parity matrix: sparse runtime rows cannot erase stable canonical fields", () => {
  const row = parity({ accountId: "stable", clientName: "Client", loginStatus: "connected", operationalBlocker: null }, { runtimeIndicator: { state: "idle" } });
  assert.equal(row.clientName, "Client");
  assert.equal(row.loginStatus, "connected");
  assert.equal(row.operationalBlocker, null);
});

test("parity matrix: stale, malformed, and Last Confirmed gates stay client-owned", () => {
  assert.match(liveRouteSource, /projection_revision:\s*generatedAt/);
  assert.match(liveRouteSource, /schema_version:\s*PROFILES_LIVE_SCHEMA_VERSION/);
  assert.match(liveRouteSource, /projection_mode:\s*"full_snapshot"/);
});

test("parity matrix: live uses the same runtime mapper as full Profiles", () => {
  assert.match(profileRouteSource, /export async function enrichAccountsWithRuntime/);
  assert.match(liveRouteSource, /enrichAccountsWithRuntime/);
});

test("parity matrix: no per-account runtime loop or cache was added", () => {
  assert.doesNotMatch(liveRouteSource, /for\s*\([^)]*account[^)]*\)[\s\S]{0,200}enrichAccountsWithRuntime/);
  assert.doesNotMatch(liveRouteSource, /unstable_cache|use cache|setTimeout|sleep/);
  assert.match(liveRouteSource, /visibleBaseProfiles\.filter/);
  assert.match(liveRouteSource, /uuidPattern\.test\(value\)/);
});
