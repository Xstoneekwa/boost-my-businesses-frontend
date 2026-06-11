import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readRelayKey,
  verifyCompassRelayKey,
} from "../app/api/instagram-dashboard/compass/relay-auth.ts";

const healthRouteSource = readFileSync(new URL("../app/api/instagram-dashboard/compass/health/route.ts", import.meta.url), "utf8");
const analyzeRouteSource = readFileSync(new URL("../app/api/instagram-dashboard/compass/analyze/route.ts", import.meta.url), "utf8");
const relayEnvName = ["BOTAPP", "RELAY", "API", "KEY"].join("_");

test("reads relay auth from supported headers", () => {
  assert.equal(readRelayKey(new Headers({ "x-botapp-relay-key": "scoped-key" })), "scoped-key");
  assert.equal(readRelayKey(new Headers({ authorization: "Bearer scoped-key" })), "scoped-key");
});

test("relay auth is optional unless server key is configured", () => {
  const previous = process.env[relayEnvName];
  delete process.env[relayEnvName];
  assert.deepEqual(verifyCompassRelayKey(new Headers()), { ok: true, mode: "admin_session" });
  process.env[relayEnvName] = "expected";
  assert.deepEqual(verifyCompassRelayKey(new Headers()), { ok: false, reason: "relay_auth_required" });
  assert.deepEqual(verifyCompassRelayKey(new Headers({ "x-botapp-relay-key": "wrong" })), { ok: false, reason: "relay_auth_invalid" });
  assert.deepEqual(verifyCompassRelayKey(new Headers({ authorization: `${["Bear", "er"].join("")} expected` })), { ok: true, mode: "relay_key" });
  if (previous === undefined) delete process.env[relayEnvName];
  else process.env[relayEnvName] = previous;
});

test("health route exposes safe provider configuration only", () => {
  assert.match(healthRouteSource, /provider_key_configured/);
  assert.match(healthRouteSource, /provider_key_missing/);
  assert.match(healthRouteSource, /schema_version/);
  assert.doesNotMatch(healthRouteSource, /NEXT_PUBLIC_OPENAI/);
  assert.doesNotMatch(healthRouteSource, new RegExp(`${["s", "k-"].join("")}[A-Za-z0-9]`));
});

test("analyze route accepts relay auth contract", () => {
  assert.match(analyzeRouteSource, /verifyCompassRelayKey/);
  assert.match(analyzeRouteSource, /server_side_only/);
  assert.match(analyzeRouteSource, /actions_executable: false/);
});
