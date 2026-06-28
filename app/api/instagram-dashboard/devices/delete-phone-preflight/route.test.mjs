import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  compassRelayAuthFailureReason,
  relayAuthStatus,
  verifyCompassRelayKey,
} from "../../compass/relay-auth.ts";
import { forwardDeletePhonePreflight } from "./route.ts";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const deleteRouteSource = readFileSync(new URL("../delete-phone/route.ts", import.meta.url), "utf8");
const entry2cDeviceId = "00000000-0000-4000-8000-00000022c002";

test("delete phone preflight route accepts BotApp relay auth", () => {
  assert.match(routeSource, /requireRelayOrAdmin\(request,\s*"Delete phone preflight"\)/);
  assert.doesNotMatch(routeSource, /requireInstagramAdmin\(\)/);
});

test("delete phone route accepts BotApp relay auth", () => {
  assert.match(deleteRouteSource, /requireRelayOrAdmin\(request,\s*"Delete phone"\)/);
  assert.doesNotMatch(deleteRouteSource, /requireInstagramAdmin\(\)/);
});

test("delete phone preflight relay auth rejects missing and invalid keys when configured", () => {
  const previous = process.env.BOTAPP_RELAY_API_KEY;
  process.env.BOTAPP_RELAY_API_KEY = "configured-relay-key";
  try {
    const missing = verifyCompassRelayKey(new Headers());
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "relay_auth_required");
    assert.equal(relayAuthStatus(compassRelayAuthFailureReason(missing)), 401);

    const invalid = verifyCompassRelayKey(new Headers({ "x-botapp-relay-key": "wrong-key" }));
    assert.equal(invalid.ok, false);
    assert.equal(invalid.reason, "relay_auth_invalid");
    assert.equal(relayAuthStatus(compassRelayAuthFailureReason(invalid)), 403);

    const valid = verifyCompassRelayKey(new Headers({ authorization: "Bearer configured-relay-key" }));
    assert.deepEqual(valid, { ok: true, mode: "relay_key" });
  } finally {
    if (previous === undefined) delete process.env.BOTAPP_RELAY_API_KEY;
    else process.env.BOTAPP_RELAY_API_KEY = previous;
  }
});

test("delete phone preflight forwards to admin-dashboard with server token only", async () => {
  const calls = [];
  const result = await forwardDeletePhonePreflight(
    entry2cDeviceId,
    { url: "https://example.supabase.co/functions/v1/admin-dashboard", token: "server-only-token" },
    async (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        ok: true,
        preflight: {
          deviceId: entry2cDeviceId,
          displayName: "Entry 2C Physical Outreach Phone",
          deletable: true,
          occupiedCloneCount: 0,
          activeAssignmentCount: 0,
          linkedInstagramAccountCount: 0,
          activeCredentialCount: 0,
          activeRunRequestCount: 0,
          activeLiveViewCount: 0,
          releasedAssignmentCount: 5,
          releasedAssignmentsInfoFr: "5 anciennes assignations terminées seront conservées dans l'historique.",
          blockingReasonsFr: [],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.supabase.co/functions/v1/admin-dashboard");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.apikey, "server-only-token");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.action, "delete_physical_phone_preflight");
  assert.equal(body.device_id, entry2cDeviceId);
  if (result.ok) {
    assert.equal(result.data.deletable, true);
    assert.equal(result.data.releasedAssignmentCount, 5);
    assert.match(String(result.data.releasedAssignmentsInfoFr || ""), /5 anciennes assignations/);
  }
});

test("delete phone preflight route does not expose admin-dashboard token to clients", () => {
  assert.equal(routeSource.includes("createSupabaseClient"), false);
  assert.doesNotMatch(routeSource, /NEXT_PUBLIC_/);
});
