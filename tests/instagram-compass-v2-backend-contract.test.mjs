import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260909135410_compass_v2_signal_intelligence.sql", import.meta.url), "utf8");
const dataLayer = readFileSync(new URL("../lib/instagram-dashboard/compass-v2-data.ts", import.meta.url), "utf8");
const signalRoute = readFileSync(new URL("../app/api/instagram-dashboard/compass/signals/route.ts", import.meta.url), "utf8");
const intelligenceRoute = readFileSync(new URL("../app/api/instagram-dashboard/compass/intelligence/route.ts", import.meta.url), "utf8");
const handoffRoute = readFileSync(new URL("../app/api/instagram-dashboard/compass/handoffs/route.ts", import.meta.url), "utf8");

test("migration persists the full Compass history without exposing tables", () => {
  for (const table of ["compass_external_source_checks", "compass_external_signals", "compass_signal_clusters", "compass_cluster_history", "compass_fleet_correlations", "compass_risk_assessments", "compass_recommendations", "compass_fleet_handoffs", "compass_operator_decisions", "compass_outcomes"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.%I from anon, authenticated/);
  assert.match(migration, /actions_executable = false/);
  assert.match(migration, /persist_compass_assessment_batch_v1/);
  assert.match(migration, /security invoker/);
  assert.doesNotMatch(migration, /security definer/i);
});

test("collection route is authenticated, bounded, and never stores raw payloads", () => {
  assert.match(signalRoute, /requireRelayOrAdmin/);
  assert.match(dataLayer, /COLLECTION_BATCH_TOO_LARGE/);
  assert.match(dataLayer, /rawPayloadStored: false/);
  assert.match(dataLayer, /signals\.map\(externalSignalRow\)/);
  assert.doesNotMatch(dataLayer, /raw_payload|raw_evidence/);
});

test("intelligence route reuses canonical Fleet incidents", () => {
  assert.match(dataLayer, /getIncidentsOverview/);
  assert.match(dataLayer, /restriction_evidence/);
  assert.match(dataLayer, /first_causal_reason/);
  assert.match(dataLayer, /runtime_version/);
  assert.match(dataLayer, /deriveExposedAccounts/);
  assert.match(dataLayer, /account_assignments/);
  assert.match(dataLayer, /phone_app_instances/);
  assert.match(dataLayer, /persist_compass_assessment_batch_v1/);
  assert.match(intelligenceRoute, /requireRelayOrAdmin/);
});

test("handoff route prepares intent and contains no Fleet mutation", () => {
  assert.match(handoffRoute, /persistPreparedHandoff/);
  assert.match(handoffRoute, /actionsExecutable: false/);
  assert.match(dataLayer, /error\?\.code === "23505"/);
  assert.doesNotMatch(handoffRoute, /hold|release|cap|apply|execute/i);
  assert.doesNotMatch(dataLayer, /(?:hold|release|cap|apply|execute)[a-z0-9_]*\s*\(/i);
});
