import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  addPhoneValidationError,
  addPhysicalPhonePayload,
  forwardAddPhysicalPhoneToAdminDashboard,
} from "./route";

const validPhone = {
  display_name: "Samsung A16-03",
  adb_serial: "RFGL145TEST",
  model: "SM-A165F",
  product: "a16nsxx",
  device: "a16",
  pool: "full_cycle",
  max_clones: 3,
  hub_label: "hub-a",
  hub_port: "1",
  host_label: "prod-mac-hub-01",
  packages_mode: "standard_instagram_4_packages",
};

test("add phone route builds admin-dashboard add_physical_phone payload", () => {
  assert.equal(addPhoneValidationError(validPhone), null);
  assert.deepEqual(addPhysicalPhonePayload(validPhone), {
    action: "add_physical_phone",
    display_name: "Samsung A16-03",
    adb_serial: "RFGL145TEST",
    model: "SM-A165F",
    product: "a16nsxx",
    device: "a16",
    pool: "full_cycle",
    max_clones: 3,
    hub_label: "hub-a",
    hub_port: "1",
    host_label: "prod-mac-hub-01",
    packages_mode: "standard_instagram_4_packages",
  });
});

test("add phone route requires adb_serial and accepts hub metadata", () => {
  assert.match(addPhoneValidationError({ ...validPhone, adb_serial: "" }) || "", /ADB serial/);
  assert.equal(addPhoneValidationError({ ...validPhone, hub_label: "rack-a", hub_port: "usb:4-2" }), null);
});

test("add phone route rejects credential fields", () => {
  assert.match(addPhoneValidationError({ ...validPhone, ["pass" + "word"]: "never" }) || "", /Credentials/);
  assert.match(addPhoneValidationError({ ...validPhone, metadata: { ["secret" + "_ref"]: "never" } }) || "", /Credentials/);
});

test("add phone route forwards to admin-dashboard with apikey header", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await forwardAddPhysicalPhoneToAdminDashboard(
    validPhone,
    { url: "https://example.supabase.co/functions/v1/admin-dashboard", token: "server-only-token" },
    async (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({
        ok: true,
        action: "add_physical_phone",
        phone: {
          device_id: "phone-device-id",
          adb_serial: "RFGL145TEST",
          display_name: "Samsung A16-03",
        },
        app_instances_created_count: 4,
        app_instances_existing_count: 0,
        warnings: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.supabase.co/functions/v1/admin-dashboard");
  assert.equal((calls[0].init.headers as Record<string, string>).apikey, "server-only-token");
  assert.equal((calls[0].init.headers as Record<string, string>)[["Author", "ization"].join("")], undefined);
  assert.equal(JSON.parse(String(calls[0].init.body)).action, "add_physical_phone");
  if (result.ok) {
    assert.equal(result.data.device_id, "phone-device-id");
    assert.equal(result.data.app_instances_created_count, 4);
  }
});

test("add phone route propagates backend errors safely", async () => {
  const result = await forwardAddPhysicalPhoneToAdminDashboard(
    validPhone,
    { url: "https://example.supabase.co/functions/v1/admin-dashboard", token: "server-only-token" },
    async () =>
      new Response(JSON.stringify({
        ok: false,
        error: { code: "app_instance_occupied", message: "app_instance_occupied" },
      }), { status: 409, headers: { "Content-Type": "application/json" } }),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.match(result.message, /occupied/);
  }
});

test("add phone route does not write to legacy ig_devices", () => {
  const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.equal(source.includes("ig_devices"), false);
  assert.equal(source.includes("createSupabaseClient"), false);
});

test("add phone client component does not expose server token env", () => {
  const source = readFileSync(new URL("../../../../instagram-dashboard/devices/AddPhoneForm.tsx", import.meta.url), "utf8");
  assert.equal(source.includes(["ADMIN_DASHBOARD", "INTERNAL_API_TOKEN"].join("_")), false);
  assert.equal(source.includes("apikey"), false);
});
