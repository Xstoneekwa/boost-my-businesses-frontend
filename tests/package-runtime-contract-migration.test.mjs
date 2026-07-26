import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/20260726015750_account_package_runtime_contract.sql", import.meta.url), "utf8");

test("package matrix covers Growth, Pro, Premium and separates warmup from persistent caps", () => {
  for (const packageCode of ["growth", "pro", "premium"]) {
    assert.match(sql, new RegExp(`\\('${packageCode}', 30, 4,`));
  }
  assert.match(sql, /max_actions_per_day = v_package\.default_follow_day_cap/);
  assert.match(sql, /follow_limit = v_package\.default_follow_session_cap/);
  assert.match(sql, /max_follow_per_run = v_package\.default_follow_session_cap/);
  assert.match(sql, /insert into public\.account_warmup_settings/);
  assert.doesNotMatch(sql, /follow_limit\s*=\s*20/);
  assert.doesNotMatch(sql, /max_follow_per_run\s*=\s*10/);
});

test("canonical package matrix provisions every critical setting family", () => {
  assert.match(sql, /max_follows_per_target_per_run/);
  assert.match(sql, /max_targets_per_run/);
  assert.match(sql, /likes_per_follow_min/);
  assert.match(sql, /likes_per_follow_max/);
  assert.match(sql, /likes_per_day_limit/);
  assert.match(sql, /welcome_per_session_limit/);
  assert.match(sql, /outreach_per_session_limit/);
  assert.match(sql, /unfollow_after_days/);
  assert.match(sql, /runtime_profile/);
  assert.match(sql, /schedule_mode/);
  assert.match(sql, /slot_kind/);
  assert.match(sql, /day_1_follow_cap/);
  assert.match(sql, /day_2_follow_cap/);
  assert.match(sql, /day_3_follow_cap/);
  assert.match(sql, /day_4_plus_follow_cap/);
});

test("reconciliation uses package caps and never persists warmup or legacy defaults", () => {
  assert.match(sql, /max_actions_per_day = v_package\.default_follow_day_cap/);
  assert.match(sql, /follow_limit = v_package\.default_follow_session_cap/);
  assert.match(sql, /max_follow_per_run = v_package\.default_follow_session_cap/);
  assert.match(sql, /day_4_plus_follow_cap = excluded\.day_4_plus_follow_cap/);
  assert.doesNotMatch(sql, /max_actions_per_day\s*=\s*v_runtime\.warmup/);
  assert.doesNotMatch(sql, /follow_limit\s*=\s*v_runtime\.warmup/);
});

test("login request trigger blocks invalid package runtime contracts before enqueue", () => {
  assert.match(sql, /before insert on public\.account_run_requests/);
  assert.match(sql, /account_package_runtime_contract_status\(new\.account_id\)/);
  for (const reason of [
    "assignment_package_mismatch",
    "app_instance_package_mismatch",
    "clone_package_mismatch",
    "package_settings_incomplete",
    "runtime_profile_mismatch",
  ]) assert.match(sql, new RegExp(reason));
});

test("sensitive contract RPCs are service-role only", () => {
  assert.match(sql, /revoke all on function public\.reconcile_account_package_runtime_contract\(uuid, text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.reconcile_account_package_runtime_contract\(uuid, text\) to service_role/);
});
