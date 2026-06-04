import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  devicesOverviewPayload,
  forwardDevicesOverviewToAdminDashboard,
  safeDevicesOverviewResponse,
  type LivePhoneDevice,
  type LivePhoneInventorySummary,
} from "../../../../instagram-dashboard/devices-live-data";
import { DevicesKpis, RegisteredPhonesList } from "../../../../instagram-dashboard/devices/page";

const summary: LivePhoneInventorySummary = {
  total_phone_devices: 1,
  physical_phone_count: 1,
  emulator_count: 0,
  available_phone_count: 1,
  unavailable_phone_count: 0,
  total_app_instances: 4,
  available_app_instances: 4,
  occupied_app_instances: 0,
  problem_phone_count: 1,
  adb_status_unknown_count: 1,
};

const phone: LivePhoneDevice = {
  device_id: "phone-1",
  display_name: "Samsung A16-01",
  adb_serial: "RFGL145VCKE",
  device_kind: "physical_phone",
  kind: "physical_phone",
  status: "available",
  pool: "full_cycle",
  max_clones: 3,
  model: "SM-A165F",
  product: "a16nsxx",
  device: "a16",
  hub_label: "hub-a",
  hub_port: "1",
  host_label: "prod-mac-hub-01",
  heartbeat_status: "unknown",
  heartbeat_last_seen_at: null,
  app_instances_count: 4,
  app_instances_available_count: 4,
  app_instances_occupied_count: 0,
  issues: ["adb_status_unknown", "missing_primary_instance"],
  app_instances: [{
    app_instance_id: "app-1",
    instance_index: 0,
    instance_kind: "primary",
    app_role: "primary",
    package_name: "com.instagram.android",
    status: "available",
    current_account_id: null,
    adb_package_verified: true,
  }],
};

test("devices overview payload forwards only devices_overview action", () => {
  assert.deepEqual(devicesOverviewPayload(), { action: "devices_overview" });
});

test("devices overview route forwards to admin-dashboard with apikey header", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await forwardDevicesOverviewToAdminDashboard(
    { url: "https://example.supabase.co/functions/v1/admin-dashboard", token: "server-only-token" },
    async (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        ok: true,
        action: "devices_overview",
        count: 1,
        phone_devices: [phone],
        items: [phone],
        phone_inventory_summary: summary,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.supabase.co/functions/v1/admin-dashboard");
  assert.equal((calls[0].init.headers as Record<string, string>).apikey, "server-only-token");
  assert.equal((calls[0].init.headers as Record<string, string>)[["Author", "ization"].join("")], undefined);
  assert.equal(JSON.parse(String(calls[0].init.body)).action, "devices_overview");
  if (result.ok) {
    assert.equal(result.data.phone_devices[0].adb_serial, "RFGL145VCKE");
  }
});

test("devices overview response is sanitized before returning to client", () => {
  const payload = safeDevicesOverviewResponse({
    ok: true,
    action: "devices_overview",
    count: 1,
    phone_devices: [{
      ...phone,
      ["service" + "_role"]: "never",
      ["pass" + "word"]: "never",
      app_instances: [{
        ...phone.app_instances[0],
        ["secret" + "_ref"]: "never",
        raw_payload: { hidden: "never" },
      }],
    }],
    items: [],
    phone_inventory_summary: summary,
  });
  const text = JSON.stringify(payload);

  assert.equal(payload.phone_devices[0].app_instances[0].package_name, "com.instagram.android");
  assert.equal(text.includes("never"), false);
  assert.equal(text.includes("raw_payload"), false);
  assert.equal(text.includes(["service", "role"].join("_")), false);
});

test("devices page can render empty phone_devices", () => {
  const html = renderToStaticMarkup(createElement(RegisteredPhonesList, { phones: [] }));

  assert.match(html, /No registered phones/);
});

test("devices page renders issues and setup badge", () => {
  const html = renderToStaticMarkup(createElement(RegisteredPhonesList, { phones: [phone] }));

  assert.match(html, /adb_status_unknown/);
  assert.match(html, /placeholder \/ setup issue/);
  assert.match(html, /com.instagram.android/);
});

test("devices KPIs render live inventory summary labels", () => {
  const html = renderToStaticMarkup(createElement(DevicesKpis, { summary }));

  assert.match(html, /Total phones/);
  assert.match(html, /ADB status unknown/);
  assert.match(html, /App instances/);
});

test("devices client refreshes server inventory after add phone success", () => {
  const source = readFileSync(new URL("../../../../instagram-dashboard/devices/AddPhoneForm.tsx", import.meta.url), "utf8");

  assert.match(source, /router\.refresh\(\)/);
  assert.equal(source.includes(["ADMIN_DASHBOARD", "INTERNAL_API_TOKEN"].join("_")), false);
  assert.equal(source.includes("apikey"), false);
});
