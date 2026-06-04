import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  forwardLiveViewToAdminDashboard,
  isLiveViewActiveStatus,
  liveViewEyeTone,
  liveViewStartPayload,
  liveViewTokenPayload,
  liveViewTooltip,
  safeLiveViewSession,
  shouldKeepLiveViewSession,
} from "../../../instagram-dashboard/live-view-data.ts";

const accountId = "83de9cc9-5c37-42d1-8edc-c924352b17b1";
const sessionId = "22222222-2222-4222-8222-222222222222";
const adminConfig = {
  url: "https://example.supabase.co/functions/v1/admin-dashboard",
  token: "server-only-admin-token",
};

function assertNoLeak(value: unknown) {
  const text = JSON.stringify(value).toLowerCase();
  for (const marker of [
    "server-only-admin-token",
    "adb_serial",
    "device_udid",
    "hub_port",
    "rfgl145",
    "secret",
    "service_role",
  ]) {
    assert.equal(text.includes(marker), false, `leak detected: ${marker}`);
  }
}

test("live view start payload is server-side safe", () => {
  assert.deepEqual(liveViewStartPayload({
    accountId,
    mode: "view_only",
    source: "manager_row_eye",
    actorId: "admin-user",
  }), {
    action: "live_view_start",
    account_id: accountId,
    mode: "view_only",
    source: "manager_row_eye",
    actor_id: "admin-user",
    requested_by: "admin-user",
  });
});

test("start proxy calls admin-dashboard with apikey only", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await forwardLiveViewToAdminDashboard(
    liveViewStartPayload({ accountId, actorId: "admin-user" }),
    adminConfig,
    async (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        ok: true,
        action: "live_view_start",
        live_view_session_id: sessionId,
        status: "pending",
        mode: "view_only",
        stream_transport: "webrtc",
        username: "i_m_your_traker",
        device_label: "Samsung A16-01",
        clone_label: "clone 1",
        package_name: "com.instagram.androie",
        run_active_at_start: false,
        interaction_enabled: false,
        expires_at: "2026-06-04T14:00:00Z",
        adb_serial: "RFGL145VCKE",
        device_udid: "RFGL145VCKE",
        hub_port: "usb:2-1",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, adminConfig.url);
  assert.equal((calls[0].init.headers as Record<string, string>).apikey, adminConfig.token);
  assert.equal((calls[0].init.headers as Record<string, string>)[["Author", "ization"].join("")], undefined);
  assert.equal(JSON.parse(String(calls[0].init.body)).action, "live_view_start");
  assertNoLeak(result);
});

test("livekit_not_configured is propagated safely", async () => {
  const result = await forwardLiveViewToAdminDashboard(
    liveViewTokenPayload({ liveViewSessionId: sessionId, actorId: "admin-user" }),
    adminConfig,
    async () =>
      new Response(JSON.stringify({
        ok: false,
        action: "live_view_token",
        error: { code: "livekit_not_configured", message: "internal detail ignored" },
        live_view_session_id: sessionId,
        status: "pending",
      }), { status: 503, headers: { "Content-Type": "application/json" } }),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "livekit_not_configured");
    assert.equal(result.status, 503);
    assert.match(result.message, /LiveKit is not configured/);
  }
  assertNoLeak(result);
});

test("safeLiveViewSession whitelists response fields", () => {
  const safe = safeLiveViewSession({
    ok: true,
    live_view_session_id: sessionId,
    status: "active",
    mode: "view_only",
    stream_transport: "webrtc",
    username: "i_m_your_traker",
    device_label: "Samsung A16-01",
    clone_label: "clone 1",
    package_name: "com.instagram.androie",
    run_active_at_start: true,
    interaction_enabled: false,
    expires_at: "2026-06-04T14:00:00Z",
    adb_serial: "RFGL145VCKE",
    device_udid: "RFGL145VCKE",
    hub_port: "usb:2-1",
    secret: "never",
  });

  assert.equal(safe.live_view_session_id, sessionId);
  assert.equal(safe.status, "active");
  assertNoLeak(safe);
});

test("live view button helpers expose expected UI states", () => {
  assert.equal(isLiveViewActiveStatus("pending"), true);
  assert.equal(shouldKeepLiveViewSession("livekit_not_configured"), true);
  assert.equal(liveViewEyeTone("active"), "success");
  assert.equal(liveViewEyeTone("stopped"), "neutral");
  assert.equal(liveViewTooltip({ status: "active" }), "Live view active");
  assert.equal(liveViewTooltip({ runActive: true }), "Run active - view only");
  assert.equal(liveViewTooltip({ livekitNotConfigured: true }), "LiveKit not configured");
});

test("live view routes and UI avoid server token exposure", () => {
  const files = [
    new URL("./start/route.ts", import.meta.url),
    new URL("./stop/route.ts", import.meta.url),
    new URL("./status/route.ts", import.meta.url),
    new URL("./token/route.ts", import.meta.url),
    new URL("../../../instagram-dashboard/LivePhoneViewPanel.tsx", import.meta.url),
    new URL("../../../instagram-dashboard/live-view-client.ts", import.meta.url),
  ];
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
  const managerSource = readFileSync(new URL("../../../instagram-dashboard/InstagramDashboardButtons.tsx", import.meta.url), "utf8");
  const utilsSource = readFileSync(new URL("../_utils.ts", import.meta.url), "utf8");

  assert.match(source, /Live view/);
  assert.match(managerSource, /LivePhoneViewPanel/);
  assert.match(managerSource, /loadLiveViewStatus/);
  assert.match(managerSource, /label: "Live view"/);
  assert.equal(source.includes(["ADMIN_DASHBOARD", "INTERNAL_API_TOKEN"].join("_")), false);
  assert.equal(source.includes("apikey:"), false);
  assert.equal(source.includes("adb_serial"), false);
  assert.equal(source.includes("device_udid"), false);
  assert.equal(source.includes("hub_port"), false);

  for (const routeFile of files.slice(0, 4)) {
    const routeSource = readFileSync(routeFile, "utf8");
    assert.match(routeSource, /requireInstagramAdmin\(\)/);
    assert.doesNotMatch(routeSource, /getDashboardUserContext/);
    assert.doesNotMatch(routeSource, /requireDashboardUserContext/);
  }

  assert.match(utilsSource, /getInstagramUserContext/);
  assert.doesNotMatch(utilsSource, /getDashboardUserContext/);
});

test("live view browser client sends instagram session cookies", () => {
  const clientSource = readFileSync(
    new URL("../../../instagram-dashboard/live-view-client.ts", import.meta.url),
    "utf8",
  );

  assert.match(clientSource, /credentials:\s*"include"/);
  assert.match(clientSource, /live-view\/start/);
  assert.match(clientSource, /live-view\/stop/);
  assert.match(clientSource, /live-view\/status/);
  assert.match(clientSource, /live-view\/token/);
});
