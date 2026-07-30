import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260731003500_target_followers_resume_commit_provenance_v4.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL(
    "../supabase/rollback/20260731003500_target_followers_resume_commit_provenance_v4.down.sql",
    import.meta.url,
  ),
  "utf8",
);
const transactionTest = readFileSync(
  new URL(
    "../supabase/tests/target-followers-resume-commit-provenance-v4.sql",
    import.meta.url,
  ),
  "utf8",
);
const compact = migration.replace(/\s+/g, " ");
const signatureCompact = compact
  .replace(/\(\s+/g, "(")
  .replace(/\s+\)/g, ")")
  .replace(/,\s+/g, ",");

const v3Signature =
  "commit_target_followers_resume_checkpoint_v3(uuid,uuid,text,uuid,text,bigint,integer,text,text,jsonb,text,text,boolean,text,integer)";
const v4Signature =
  "commit_target_followers_resume_checkpoint_v4(uuid,uuid,text,uuid,text,bigint,integer,jsonb,text,text,jsonb,text,text,boolean,text,integer)";

test("migration is explicitly prepared, additive and preserves V3 history", () => {
  assert.match(migration, /^-- PREPARED ONLY — NOT APPLIED TO PRODUCTION\./);
  assert.match(compact, new RegExp(v3Signature.replace(/[()]/g, "\\$&"), "i"));
  assert.doesNotMatch(migration, /drop\s+function[^;]*commit_target_followers_resume_checkpoint_v3/i);
  assert.doesNotMatch(migration, /drop\s+table[^;]*ig_target_followers_resume/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.ig_target_followers_resume/i);
  assert.doesNotMatch(migration, /truncate\s+(?:table\s+)?public\.ig_target_followers_resume/i);
});

test("V4 is a distinct named-argument-compatible provenance RPC", () => {
  assert.match(migration, /create or replace function public\.commit_target_followers_resume_checkpoint_v4\s*\(/i);
  assert.match(
    compact,
    /p_last_safe_depth integer, p_commit_context jsonb, p_last_safe_anchor text default null/i,
  );
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /alter column checkpoint_version set default 3/i);
});

test("commit context is exact, bounded and contains no raw social identity", () => {
  for (const key of [
    "source_request_id",
    "source_attempt_id",
    "release_sha",
    "observed_scroll_index",
    "overlap_count",
    "new_unique_rows",
    "viewport_fingerprint_before",
    "viewport_fingerprint_after",
  ]) {
    assert.match(migration, new RegExp(`'${key}'`), key);
  }
  assert.match(migration, /select count\(\*\)\s+from jsonb_object_keys\(p_commit_context\)\s*\) <> 8/i);
  assert.match(migration, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(migration, /\^\[0-9a-f\]\{20\}\$/);
  assert.match(migration, /pg_column_size\(p_commit_context\) > 2048/i);
  assert.doesNotMatch(migration, /target_username|raw_xml|screenshot/i);
});

test("request, run, account and target lineage are checked explicitly", () => {
  assert.match(migration, /from public\.account_run_requests as request_row/i);
  assert.match(migration, /request_row\.id = v_source_request_id/i);
  assert.match(migration, /v_request\.account_id is distinct from p_account_id/i);
  assert.match(migration, /v_request\.run_id is distinct from p_run_id/i);
  assert.match(migration, /v_request\.requested_run_type <> 'account_session'/i);
  assert.match(migration, /v_request\.status is distinct from 'running'/i);
  assert.match(migration, /from public\.ig_runs as run_row/i);
  assert.match(migration, /v_run\.account_id is distinct from p_account_id/i);
  assert.match(migration, /v_run\.status is distinct from 'running'/i);
  assert.match(migration, /from public\.ig_targets as target_row/i);
  assert.match(migration, /target_row\.account_id = p_account_id/i);
  assert.doesNotMatch(migration, /performance_summary/i);
});

test("request metadata is the canonical attempt and retry source", () => {
  assert.match(migration, /v_request_metadata -> 'attempt_id'/i);
  assert.match(migration, /v_resume_plan -> 'current_attempt_id'/i);
  assert.match(migration, /v_top_level_attempt_present/i);
  assert.match(migration, /v_retry_contract_present :=[\s\S]*v_request_metadata \? 'attempt_id'/i);
  assert.match(migration, /attempts\.layer = 'top'/i);
  assert.match(migration, /attempts\.layer = 'embedded'/i);
  assert.match(migration, /stale embedded projection/i);
  assert.match(migration, /next_retry_index projection is deliberately not authoritative/i);
  assert.match(migration, /source_attempt_missing_for_retry/i);
  assert.match(migration, /source_attempt_divergence/i);
  assert.match(migration, /source_attempt_mismatch/i);
  assert.match(migration, /v_retry_index_candidate <> v_canonical_attempt_id - 1/i);
  assert.match(migration, /v_canonical_attempt_id := 1/i);
});

test("V3 CAS, lease and monotonic depth remain fail closed", () => {
  assert.match(migration, /p_surface is distinct from 'followers'/i);
  assert.match(migration, /p_mode is null/i);
  assert.match(migration, /p_status is null/i);
  assert.match(migration, /jsonb_typeof\(a\.value\) is distinct from 'string'/i);
  assert.match(migration, /jsonb_array_length\(p_last_visible_anchor_hashes\) not between 1 and 12/i);
  assert.match(migration, /p_last_safe_anchor is distinct from/i);
  assert.match(migration, /\^a3:\[0-9a-f\]\{32\}\$/i);
  assert.match(migration, /\^v3:\[0-9a-f\]\{32\}\$/i);
  assert.match(migration, /for update;/i);
  assert.match(migration, /v_row\.optimistic_version <> p_expected_version/i);
  assert.match(migration, /lease_owner_run_id is distinct from p_run_id/i);
  assert.match(migration, /lease_expires_at is null or v_row\.lease_expires_at <= now\(\)/i);
  assert.match(migration, /lease_expired/i);
  assert.match(migration, /p_last_safe_depth <= v_previous_depth/i);
  assert.match(migration, /no_safe_progress_rejected/i);
  assert.match(migration, /p_last_safe_depth > v_previous_depth \+ 1/i);
  assert.match(migration, /p_lease_seconds not between 300 and 7200/i);
});

test("checkpoint update and immutable provenance event are atomic", () => {
  assert.match(migration, /update public\.ig_target_followers_resume_checkpoints as checkpoint_row[\s\S]*insert into public\.ig_target_followers_resume_checkpoint_events/i);
  assert.match(migration, /'committed'[\s\S]*returning id, created_at into v_commit_event_id, v_committed_at/i);
  assert.match(migration, /'provenance_persisted', true/i);
  assert.match(migration, /'commit_event_id', v_commit_event_id/i);
  assert.match(migration, /'lease_generation', v_new_lease_generation/i);
  assert.match(migration, /p_commit_context \|\| jsonb_build_object/i);
  assert.doesNotMatch(migration, /exception\s+when[\s\S]*commit_event/i);
});

test("V4 execute is service-role only", () => {
  assert.match(
    signatureCompact,
    new RegExp(
      `revoke all on function public\\.${v4Signature.replace(/[()]/g, "\\$&")} from public,anon,authenticated,service_role`,
      "i",
    ),
  );
  assert.match(
    signatureCompact,
    new RegExp(
      `grant execute on function public\\.${v4Signature.replace(/[()]/g, "\\$&")} to service_role`,
      "i",
    ),
  );
  assert.doesNotMatch(migration, /grant\s+execute[^;]*to\s+(?:public|anon|authenticated)/i);
});

test("rollback drops only V4 and preserves the valid version-3 default", () => {
  assert.match(rollback, /^-- PREPARED ONLY — NOT APPLIED TO PRODUCTION\./);
  assert.match(rollback, /drop function if exists public\.commit_target_followers_resume_checkpoint_v4/i);
  assert.doesNotMatch(rollback, /drop\s+function[^;]*_v3/i);
  assert.doesNotMatch(rollback, /drop\s+table|delete\s+from|truncate\s+table/i);
  assert.doesNotMatch(rollback, /alter column checkpoint_version set default 2/i);
  assert.match(rollback, /Do not delete or rewrite any V4 event already committed/i);
});

test("transactional scenario covers provenance, CAS, grants and event rollback", () => {
  assert.match(transactionTest, /\\set ON_ERROR_STOP on/);
  assert.match(transactionTest, /\\ir \.\.\/migrations\/20260727094636_target_followers_resume_v2_lease_privacy\.sql/);
  assert.match(transactionTest, /\\ir \.\.\/migrations\/20260731003500_target_followers_resume_commit_provenance_v4\.sql/);
  assert.match(transactionTest, /source_attempt_mismatch/);
  assert.match(transactionTest, /top_level_attempt_3_did_not_override_stale_plan/);
  assert.match(transactionTest, /embedded_only_current_attempt_2_not_accepted/);
  assert.match(transactionTest, /top_level_attempt_divergence_not_rejected/);
  assert.match(transactionTest, /zero_depth_commit_not_rejected/);
  assert.match(transactionTest, /terminal_request_not_rejected/);
  assert.match(transactionTest, /terminal_run_not_rejected/);
  assert.match(transactionTest, /expired_lease_not_rejected/);
  assert.match(transactionTest, /whitespace_top_attempt_fell_back_to_embedded/);
  assert.match(transactionTest, /null_status_not_rejected_stably/);
  assert.match(transactionTest, /null_anchor_hash_not_rejected/);
  assert.match(transactionTest, /depth_jump_not_rejected/);
  assert.match(transactionTest, /optimistic_version_conflict/);
  assert.match(transactionTest, /ct_resume_v4_forced_event_failure/);
  assert.match(transactionTest, /event_failure_did_not_rollback_checkpoint/);
  assert.match(transactionTest, /has_function_privilege\(\s*'anon'/i);
  assert.match(transactionTest, /has_function_privilege\(\s*'service_role'/i);
  assert.match(transactionTest, /rollback;/i);
});
