import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../../../instagram-client/page.tsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../../../instagram-client/ClientDashboard.tsx", import.meta.url), "utf8");

test("notifications GET exposes featureAvailable when table is unavailable", () => {
  assert.match(routeSource, /featureAvailable: projection\.featureAvailable/);
  assert.match(routeSource, /reconcileClientAccountNotificationsForClient/);
  assert.match(routeSource, /loadClientAccountNotificationsForClient/);
  assert.doesNotMatch(routeSource, /\.catch\(\(\) => undefined\)/);
});

test("notifications PATCH is explicit no-op when feature is unavailable", () => {
  assert.match(routeSource, /probeClientAccountNotificationsTable/);
  assert.match(routeSource, /buildClientNotificationsUnavailablePatchResponse/);
  assert.match(routeSource, /feature_unavailable/);
  assert.doesNotMatch(routeSource, /\.insert\(/);
  assert.doesNotMatch(routeSource, /\.update\(/);
});

test("instagram-client SSR path does not swallow reconcile failures with catch", () => {
  assert.match(pageSource, /reconcileClientAccountNotificationsForClient\(supabase, userContext\.tenantId\)/);
  assert.match(pageSource, /loadClientAccountNotificationsForClient\(supabase, userContext\.tenantId\)/);
  assert.doesNotMatch(pageSource, /reconcileClientAccountNotificationsForClient[\s\S]*\.catch\(\(\) => undefined\)/);
});

test("client dashboard hides bell badge and panel when notifications feature is unavailable", () => {
  assert.match(dashboardSource, /notificationsFeatureAvailable/);
  assert.match(dashboardSource, /accountNotifications\.featureAvailable !== false/);
  assert.match(dashboardSource, /notificationsFeatureAvailable \? \(/);
  assert.match(dashboardSource, /notificationsFeatureAvailable && notificationsOpen/);
});
