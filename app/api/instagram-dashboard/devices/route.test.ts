import assert from "node:assert/strict";
import test from "node:test";
import { safePhoneDevice } from "./route.ts";

test("devices route projects Samsung phones from phone_devices with app instances", () => {
  const phone = safePhoneDevice(
    {
      id: "phone-1",
      name: "Samsung A16-01",
      adb_serial: "RFGL145VCKE",
      status: "available",
      pool_type: "full_cycle",
      max_clones: 3,
    },
    [{
      id: "app-primary",
      device_id: "phone-1",
      instance_type: "primary_app",
      instance_index: 0,
      visible_label: "Samsung A16-01 primary",
      package_name: "com.instagram.android",
      status: "occupied",
      current_account_id: "cinema-account",
      usable_for_auto_login: true,
      is_launchable: true,
    }, {
      id: "app-clone-1",
      device_id: "phone-1",
      instance_type: "clone",
      instance_index: 1,
      visible_label: "Samsung A16-01 clone 1",
      package_name: "com.instagram.androie",
      status: "available",
      current_account_id: null,
      usable_for_auto_login: true,
      is_launchable: true,
    }],
    { device_id: "phone-1", status: "online", last_seen_at: new Date().toISOString() },
  );

  assert.equal(phone.device_name, "Samsung A16-01");
  assert.equal(phone.adb_serial, "RFGL145VCKE");
  assert.equal(phone.app_instances_available_count, 1);
  assert.equal(phone.app_instances_occupied_count, 1);
  assert.equal(phone.app_instances[1].app_instance_id, "app-clone-1");
  assert.equal(phone.app_instances[1].selectable, true);
});

test("devices route marks stale heartbeat as warning", () => {
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const phone = safePhoneDevice(
    { id: "phone-1", name: "Samsung A16-01", adb_serial: "RFGL145VCKE", status: "available" },
    [],
    { device_id: "phone-1", status: "online", last_seen_at: old },
  );

  assert.equal(phone.heartbeat_status, "stale");
  assert.equal(phone.heartbeat_warning, "stale_heartbeat");
});
