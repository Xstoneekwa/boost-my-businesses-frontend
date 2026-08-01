import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260801201721_follow60_transactional_activation_control_terminalization_run_reconciliation_v1.sql", import.meta.url),
  "utf8",
);
const metadata = fs.readFileSync(
  new URL("../lib/instagram-dashboard/auto-restart-resume-metadata.ts", import.meta.url),
  "utf8",
);

test("transaction separates prepare from binding consumption", () => {
  const prepare = migration.slice(
    migration.indexOf("create or replace function public.prepare_follow_60s_canary_runtime_v3"),
    migration.indexOf("create or replace function public.commit_follow_60s_canary_runtime_v3"),
  );
  const commit = migration.slice(
    migration.indexOf("create or replace function public.commit_follow_60s_canary_runtime_v3"),
    migration.indexOf("create or replace function public.terminalize_follow_60s_canary_control_v1"),
  );
  assert.match(prepare, /'runtime_binding_consumed',false/);
  assert.doesNotMatch(prepare, /update public\.follow_60s_canary_controls/);
  assert.match(commit, /'runtime_binding_consumed',true/);
  assert.match(commit, /status='running'/);
});

test("canonical constructor requires identity, idempotency, baseline, and collision gate", () => {
  assert.match(migration, /create_or_rearm_follow_60s_canary_control_v1/);
  assert.match(migration, /nullif\(btrim\(p_idempotency_key\),''\) is null/);
  assert.match(migration, /active_control_collision/);
  assert.match(migration, /follow_60s_canary_control_history/);
  assert.match(migration, /runtime_binding_consumed',false/);
  assert.match(migration, /canonical_baseline_timestamp_invalid/);
  assert.match(migration, /same_account_active_control_collision/);
});

test("barrier atomically reaches waiting evaluation at exact canonical target", () => {
  assert.match(migration, /p_canonical_follow_count <> v_row\.baseline_follow_count\+v_row\.evaluation_increment/);
  assert.match(migration, /status='waiting_operator_evaluation'/);
  assert.match(migration, /'current_new_cycle_count',evaluation_increment/);
});

test("terminal run totals are rebuilt from deduplicated canonical events", () => {
  assert.match(migration, /reconcile_ig_run_canonical_totals_v1/);
  assert.match(migration, /count\(distinct lower\(ltrim\(username,'@'\)\)\)/);
  assert.match(migration, /event_type in \('follow_verified','follow_verified_persisted_v1'\)/);
  assert.match(migration, /event_type in \('post_like_success','post_like_verified'\)/);
  assert.match(migration, /'source','canonical_event_reconciliation'/);
  assert.match(migration, /preserved_existing_counter/);
  assert.match(migration, /p_terminal_status='completed'/);
});

test("Follow60 phase plan is generic, Follow-only, and preserves backlog", () => {
  assert.doesNotMatch(metadata, /FOLLOW_60S_ONE_SHOT_ACCOUNT_ID/);
  assert.match(metadata, /phase_plan_source: "follow60_armed_control"/);
  assert.match(metadata, /preserved_business_backlog/);
  assert.match(metadata, /unfollow: false/);
});
