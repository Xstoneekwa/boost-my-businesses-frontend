import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("live route emits bounded no-database timing telemetry", () => {
  assert.match(routeSource, /PROFILES_LIVE_TELEMETRY/);
  assert.match(routeSource, /phase_legacy_profiles_ms/);
  assert.match(routeSource, /phase_identity_ms/);
  assert.match(routeSource, /phase_serialization_ms/);
  assert.match(routeSource, /phase_total_ms/);
  assert.match(routeSource, /response_size_bytes/);
  assert.match(routeSource, /X-Profiles-Live-Request-Id/);
  assert.match(routeSource, /X-Profiles-Live-Response-Size/);
  assert.match(routeSource, /profiles_live_v1/);
});

test("instrumentation adds no telemetry table or polling path", () => {
  assert.doesNotMatch(routeSource, /notification|telemetry_events|telemetry_logs/);
  assert.doesNotMatch(routeSource, /setInterval|setTimeout/);
  assert.doesNotMatch(routeSource, /\.from\(["']profiles_live_telemetry/);
});
