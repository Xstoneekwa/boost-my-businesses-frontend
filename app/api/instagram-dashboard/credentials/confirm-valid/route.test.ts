import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("confirm valid route requires admin auth and shared helper", () => {
  assert.match(source, /requireInstagramAdmin\(\)/);
  assert.match(source, /getInstagramAdminUserContext\(\)/);
  assert.match(source, /confirmValidCredentials/);
  assert.match(source, /createSupabaseClient\(\)/);
});

test("confirm valid route only accepts account id and does not read secrets", () => {
  assert.match(source, /account_id/);
  assert.doesNotMatch(source, /password/);
  assert.doesNotMatch(source, /secret_ref/);
  assert.doesNotMatch(source, /vault/i);
  assert.doesNotMatch(source, /service_role/i);
  assert.doesNotMatch(source, /token/i);
  assert.doesNotMatch(source, /device_id/);
  assert.doesNotMatch(source, /app_instance_id/);
  assert.doesNotMatch(source, /adb/i);
  assert.doesNotMatch(source, /raw_xml|screenshot/i);
});

test("confirm valid route does not launch run or DM jobs", () => {
  assert.doesNotMatch(source, /runner\.py/);
  assert.doesNotMatch(source, /runs\/start|requested_run_type|account_run_request|create_account_run_request/);
  assert.doesNotMatch(source, /dm_job|create_dm|send_dm/i);
});
