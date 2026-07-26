import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260726111000_account_package_runtime_existing_assignments_retry_v1.sql", import.meta.url),
  "utf8",
);
const scheduler = readFileSync(
  new URL("../lib/instagram-dashboard/schedule-session-cron.ts", import.meta.url),
  "utf8",
);

test("migration contains no account-specific identifier or username", () => {
  assert.doesNotMatch(migration, /ba73eda4-d22a-4b93-9683-2af7b8aab764|j_automatise_pour_toi/i);
});

test("lower account Follow and Unfollow overrides are accepted below package ceilings", () => {
  assert.match(migration, /v_settings\.max_actions_per_day > v_package_follow_day/);
  assert.match(migration, /v_settings\.follow_limit > v_package_follow_session/);
  assert.match(migration, /v_settings\.max_follow_per_run > least\(v_package_follow_session, v_settings\.follow_limit\)/);
  assert.match(migration, /v_unfollow\.unfollow_per_day_limit > v_package_unfollow_day/);
  assert.match(migration, /v_unfollow\.unfollow_per_session_limit > v_package_unfollow_session/);
  assert.match(migration, /positive_account_override_lte_package/);
});

test("package-owned source rotation and Like fields remain exact", () => {
  assert.match(migration, /max_follows_per_target_per_run is distinct from v_runtime\.max_follows_per_target_per_run/);
  assert.match(migration, /max_targets_per_run is distinct from v_runtime\.max_targets_per_run/);
  assert.match(migration, /likes_per_follow_min is distinct from v_runtime\.likes_per_follow_min/);
  assert.match(migration, /total_likes_limit is distinct from v_runtime\.likes_per_day_limit/);
});

test("reconciliation is generic, skips archived accounts and backfills open assignments", () => {
  assert.match(migration, /account_archived_skipped/);
  assert.match(migration, /aa\.status in \('pending', 'reserved', 'active'\)/);
  assert.match(migration, /a\.archived_at is null and a\.trashed_at is null/);
  assert.match(migration, /migration_backfill_v1/);
  assert.match(migration, /package_runtime_contract_already_compliant/);
});

test("legacy active subscriptions are reconciled without inventing checkout entitlements", () => {
  assert.match(migration, /legacy_active_subscription_package/);
  assert.match(migration, /reconcile_legacy_account_assignment_binding_v1/);
  assert.match(migration, /legacy_assignment_package_binding_reconciled/);
  assert.doesNotMatch(migration, /insert into public\.client_account_entitlements/);
  assert.match(migration, /consumed_entitlement_package_code/);
  assert.match(migration, /grant execute on function public\.reconcile_legacy_account_assignment_binding_v1\(uuid, text\)[\s\S]+to service_role/);
});

test("future assignment, package, entitlement and contract-setting changes are covered", () => {
  for (const trigger of [
    "account_assignment_package_runtime_contract",
    "account_commercial_package_runtime_contract",
    "client_entitlement_package_runtime_contract",
    "ig_settings_package_runtime_contract",
    "follow_sources_package_runtime_contract",
    "unfollow_settings_package_runtime_contract",
    "dm_settings_package_runtime_contract",
  ]) {
    assert.match(migration, new RegExp(trigger));
  }
  assert.match(migration, /bmb\.package_contract_reconcile/);
});

test("retry RPC is bounded, versioned, natural-scheduler-only and concurrency-safe", () => {
  assert.match(migration, /create_schedule_session_pre_run_retry_v1/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /package_settings_incomplete', 'runtime_contract_not_ready/);
  assert.match(migration, /instagram_schedule_session_cron/);
  assert.match(migration, /:retry:v1:/);
  assert.match(migration, /v_retry_limit integer := least\(greatest\(coalesce\(p_retry_limit, 1\), 1\), 3\)/);
  assert.match(migration, /v_base\.run_id is not null/);
  assert.match(migration, /lease_expires_at > v_now/);
  assert.match(migration, /manual_stop_requested/);
});

test("historical request is retained and linked through safe retry metadata", () => {
  assert.doesNotMatch(migration, /delete from public\.account_run_requests/);
  assert.doesNotMatch(migration, /update public\.account_run_requests[\s\S]{0,250}status/);
  assert.match(migration, /retry_of_request_id/);
  assert.match(migration, /retry_reason/);
  assert.match(migration, /schedule_retry_ordinal/);
});

test("RPCs are hardened to service role and audit events remain private", () => {
  assert.match(migration, /set search_path = public/);
  assert.match(migration, /revoke all on function public\.reconcile_account_package_runtime_contract\(uuid, text\) from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.create_schedule_session_pre_run_retry_v1[\s\S]+from public, anon, authenticated/);
  assert.match(migration, /revoke all on table public\.account_package_runtime_contract_events from public, anon, authenticated/);
  assert.match(migration, /grant select, insert on table public\.account_package_runtime_contract_events to service_role/);
});

test("scheduler only delegates a repaired terminal pre-run block to the atomic retry RPC", () => {
  assert.match(scheduler, /RETRYABLE_PRE_RUN_BLOCK_REASONS/);
  assert.match(scheduler, /status !== "blocked"/);
  assert.match(scheduler, /create_schedule_session_pre_run_retry_v1/);
  assert.match(scheduler, /SCHEDULE_PRE_RUN_RETRY_LIMIT = 1/);
  assert.match(scheduler, /scheduled_retry_created_count/);
});

test("no Worker, device or Instagram primitive is introduced", () => {
  assert.doesNotMatch(migration + scheduler, /uiautomator2|\badb\b|am start|force-stop|input tap|open instagram/i);
});
