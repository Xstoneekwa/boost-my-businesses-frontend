import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/migrations/20260822014155_account_session_transition_projection_v1.sql", import.meta.url), "utf8");

test("fixtures A-H are encoded fail-closed in the SQL projection", () => {
  assert.match(sql, /follow_to_unfollow_time_handoff/); // A/B recognized source
  assert.match(sql, /v_unfollow_started boolean/); // B cannot be UI-inferred
  assert.match(sql, /zero_executable_unfollow/); // C no_work
  assert.match(sql, /v_state := 'blocked'/); // D blocker kept separately
  assert.match(sql, /partial_resumable/); // E safe window partial
  assert.match(sql, /v_state := 'completed'/); // F terminal update
  assert.match(sql, /on conflict \(transition_key\) do update/); // G replay dedupe
  assert.match(sql, /Generic incident fallbacks do not qualify/); // H old fallback cannot overwrite
});

test("normal transitions never write account_incidents", () => {
  assert.doesNotMatch(sql, /insert\s+into\s+public\.account_incidents/i);
});

test("projection identity contains all four stable components", () => {
  assert.match(sql, /concat_ws\(':', v_business_session_id, v_attempt_id, v_generation, 'follow_to_unfollow_handoff'\)/);
});
