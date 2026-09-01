import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("./20260901180552_autom_atism_resume_lineage_v1.sql", import.meta.url),
  "utf8",
);

test("resume lineage V4 preserves the canonical V3 admission path", () => {
  assert.match(sql, /consume_resume_authorization_and_create_request_v4/);
  assert.match(sql, /return public\.consume_resume_authorization_and_create_request_v3/);
  assert.match(sql, /restriction_preflight_only[\s\S]*consume_resume_authorization_and_create_request_v3/);
});

test("the source request owns stable root, explicit parent and monotone attempt", () => {
  assert.match(sql, /where id = v_plan\.run_request_id/);
  assert.match(sql, /v_next_attempt := v_source\.execution_attempt_no \+ 1/);
  assert.match(sql, /'root_business_session_id', v_source\.root_business_session_id::text/);
  assert.match(sql, /'parent_request_id', v_source\.id::text/);
  assert.match(sql, /'execution_attempt_no', v_next_attempt/);
  assert.match(sql, /'retry_index', v_next_attempt - 1/);
});

test("contradictory lineage fails before authorization consumption", () => {
  const mismatch = sql.indexOf("resume_plan_lineage_mismatch");
  const delegate = sql.lastIndexOf("return public.consume_resume_authorization_and_create_request_v3");
  assert.ok(mismatch > 0 && delegate > mismatch);
  assert.match(sql, /v_next_attempt not between 2 and 3/);
});

test("the insert trigger only applies to an atomically authorized resume", () => {
  assert.match(sql, /resume_lineage_contract_v1/);
  assert.match(sql, /v_auth\.status <> 'consumed'/);
  assert.match(sql, /new\.root_business_session_id := v_source\.root_business_session_id/);
  assert.match(sql, /new\.execution_attempt_no := v_next_attempt/);
  assert.match(sql, /new\.retry_index := v_next_attempt - 1/);
});

test("RPC privileges remain service-role only", () => {
  assert.match(sql, /service_role_required/);
  assert.match(sql, /revoke all on function public\.consume_resume_authorization_and_create_request_v4[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.consume_resume_authorization_and_create_request_v4[\s\S]*to service_role/);
});
