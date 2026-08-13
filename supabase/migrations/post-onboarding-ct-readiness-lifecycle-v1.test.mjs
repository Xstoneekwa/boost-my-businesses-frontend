import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("./20260813231409_post_onboarding_ct_readiness_lifecycle_v1.sql", import.meta.url),
  "utf8",
);

test("initial onboarding retains the 15 eligible target gate", () => {
  assert.match(sql, /v_onboarding_status <> 'ready' and v_eligible_targets < 15/);
  assert.match(sql, /'initial_onboarding_required_eligible_targets', 15/);
});

test("post-onboarding reconciliation never rejects target depletion", () => {
  const reconcile = sql.slice(sql.indexOf("create function public.reconcile_connected_instagram_growth_readiness_v1"));
  assert.doesNotMatch(reconcile, /if v_eligible_targets < 15/);
  assert.doesNotMatch(reconcile, /reason', 'insufficient_eligible_targets'/);
  assert.match(reconcile, /'onboarding_target_gate_applied', false/);
});

test("low-stock remains an independent five-target lifecycle signal", () => {
  assert.match(sql, /'post_onboarding_low_stock_threshold', 5/);
  assert.match(sql, /'post_onboarding_low_stock', v_eligible_targets <= 5/);
});

test("RPCs stay service-role only", () => {
  assert.match(sql, /revoke all on function public\.confirm_instagram_login_operator_v1[\s\S]*from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.confirm_instagram_login_operator_v1[\s\S]*to service_role;/);
  assert.match(sql, /revoke all on function public\.reconcile_connected_instagram_growth_readiness_v1[\s\S]*from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.reconcile_connected_instagram_growth_readiness_v1[\s\S]*to service_role;/);
});
