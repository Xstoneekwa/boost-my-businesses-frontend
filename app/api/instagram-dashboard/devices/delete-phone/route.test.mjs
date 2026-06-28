import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deletePhoneErrorMessage,
  deletePhoneStableReason,
  forwardDeletePhysicalPhone,
} from "./route.ts";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const entry2cDeviceId = "00000000-0000-4000-8000-00000022c002";

test("delete phone route accepts BotApp relay auth", () => {
  assert.match(routeSource, /requireRelayOrAdmin\(request,\s*"Delete phone"\)/);
  assert.doesNotMatch(routeSource, /requireInstagramAdmin\(\)/);
});

test("delete phone stable reasons map backend delete guard codes", () => {
  assert.equal(deletePhoneStableReason({ message: "device_delete_confirmation_mismatch" }, 400), "device_delete_confirmation_mismatch");
  assert.equal(deletePhoneStableReason({ message: "device_delete_blocked_by_active_dependency" }, 409), "device_delete_blocked_by_active_dependency");
  assert.equal(deletePhoneStableReason({ message: "device_delete_confirmation_required" }, 400), "device_delete_confirmation_required");
  assert.match(deletePhoneErrorMessage({ message: "device_delete_confirmation_mismatch" }, 400), /does not match/);
});

test("delete phone relay forwards confirmation fields to admin-dashboard", async () => {
  const calls = [];
  const result = await forwardDeletePhysicalPhone(
    {
      device_id: entry2cDeviceId,
      confirmation_name: "Entry 2C Physical Outreach Phone",
      source: "BotApp",
    },
    { url: "https://example.supabase.co/functions/v1/admin-dashboard", token: "server-only-token" },
    async (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        ok: true,
        deleted: {
          device_id: entry2cDeviceId,
          display_name: "Entry 2C Physical Outreach Phone",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.action, "delete_physical_phone");
  assert.equal(body.device_id, entry2cDeviceId);
  assert.equal(body.confirmation_name, "Entry 2C Physical Outreach Phone");
});

test("delete phone relay propagates confirmation mismatch without mutation", async () => {
  const result = await forwardDeletePhysicalPhone(
    {
      device_id: entry2cDeviceId,
      confirmation_name: "Wrong Name",
    },
    { url: "https://example.supabase.co/functions/v1/admin-dashboard", token: "server-only-token" },
    async () => new Response(JSON.stringify({
      ok: false,
      error: { code: "validation_error", message: "device_delete_confirmation_mismatch" },
    }), { status: 400, headers: { "Content-Type": "application/json" } }),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "device_delete_confirmation_mismatch");
    assert.equal(result.status, 400);
  }
});

test("delete phone relay propagates active dependency block", async () => {
  const result = await forwardDeletePhysicalPhone(
    {
      device_id: entry2cDeviceId,
      confirmation_name: "Entry 2C Physical Outreach Phone",
    },
    { url: "https://example.supabase.co/functions/v1/admin-dashboard", token: "server-only-token" },
    async () => new Response(JSON.stringify({
      ok: false,
      error: { code: "conflict", message: "device_delete_blocked_by_active_dependency" },
    }), { status: 409, headers: { "Content-Type": "application/json" } }),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "device_delete_blocked_by_active_dependency");
    assert.equal(result.status, 409);
  }
});
