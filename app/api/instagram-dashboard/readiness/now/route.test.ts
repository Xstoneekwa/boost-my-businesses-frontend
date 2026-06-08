import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("readiness now route uses admin auth and shared backend helper", () => {
  assert.match(source, /requireInstagramAdmin\(\)/);
  assert.match(source, /getInstagramAdminUserContext\(\)/);
  assert.match(source, /runReadinessNow/);
  assert.match(source, /createSupabaseClient\(\)/);
});

test("readiness now route does not launch runner or DM jobs", () => {
  assert.doesNotMatch(source, /runner\.py/);
  assert.doesNotMatch(source, /dm_job|create_dm|send_dm/i);
  assert.doesNotMatch(source, /requested_run_type:\s*"account_session"/);
});
