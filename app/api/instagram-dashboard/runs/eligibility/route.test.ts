import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("run eligibility route is read-only and uses shared run control gates", () => {
  assert.match(source, /requireInstagramAdmin\(\)/);
  assert.match(source, /evaluateRunStartEligibility/);
  assert.match(source, /runStartBlockMessage/);
  assert.doesNotMatch(source, /create_account_run_request/);
  assert.doesNotMatch(source, /insertManualRunAudit/);
  assert.doesNotMatch(source, /runner\.py/);
});

test("run eligibility route returns safe reason and message only", () => {
  assert.match(source, /ok_to_start/);
  assert.match(source, /reason/);
  assert.match(source, /message/);
  assert.doesNotMatch(source, /device_id|app_instance_id|assignment_id|adb_serial|secret_ref|service_role|raw XML|screenshot/i);
});
