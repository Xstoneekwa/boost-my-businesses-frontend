import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const baseMigrationSql = readFileSync(
  new URL("../../supabase/migrations/20260704120000_client_email_materialize_outbox_rpc.sql", import.meta.url),
  "utf8",
);

const correctiveMigrationSql = readFileSync(
  new URL("../../supabase/migrations/20260705120000_client_email_materialize_from_email_consistency.sql", import.meta.url),
  "utf8",
);

const migrationSql = correctiveMigrationSql;

const contractDoc = readFileSync(
  new URL("../../docs/client-email-materialize-dispatch-contract.md", import.meta.url),
  "utf8",
);

const materializerSource = readFileSync(
  new URL("./client-email-outbox-materializer.ts", import.meta.url),
  "utf8",
);

test("migration defines materialize RPC with account advisory lock before parent/intent work", () => {
  assert.match(migrationSql, /materialize_client_email_outbox_candidate_v1/);
  assert.match(migrationSql, /pg_advisory_xact_lock/);
  assert.match(migrationSql, /hashtext\('client_email_materialize'\)/);
  assert.match(migrationSql, /hashtext\(p_account_id::text\)/);
  const lockPos = migrationSql.indexOf("pg_advisory_xact_lock");
  const parentInsertPos = migrationSql.indexOf("insert into public.client_email_lifecycle_episodes");
  assert.ok(lockPos >= 0 && parentInsertPos > lockPos);
});

test("migration verifies account client ownership via client_instagram_accounts", () => {
  assert.match(migrationSql, /public\.client_instagram_accounts cia/);
  assert.match(migrationSql, /client_email_account_client_ownership_mismatch/);
  assert.match(contractDoc, /client_instagram_accounts/);
});

test("migration uses security definer with safe search_path qualified tables and service_role grant", () => {
  assert.match(migrationSql, /security definer/i);
  assert.match(migrationSql, /set search_path = public, pg_temp/i);
  assert.match(migrationSql, /from public\.client_email_send_intents/i);
  assert.match(migrationSql, /revoke all on function public\.materialize_client_email_outbox_candidate_v1/);
  assert.match(migrationSql, /from public, anon, authenticated/);
  assert.match(migrationSql, /grant execute on function public\.materialize_client_email_outbox_candidate_v1/);
  assert.match(migrationSql, /to service_role/);
});

test("idempotency conflict compares business identity and raises stable conflict code", () => {
  assert.match(migrationSql, /client_email_idempotency_identity_conflict/);
  assert.match(migrationSql, /v_existing_intent\.account_id is distinct from p_account_id/);
  assert.match(migrationSql, /v_existing_intent\.client_id is distinct from p_client_id/);
  assert.match(migrationSql, /v_existing_intent\.intent_kind is distinct from 'client'/);
  assert.match(migrationSql, /v_existing_intent\.category is distinct from p_category/);
  assert.match(migrationSql, /v_existing_intent\.trigger is distinct from p_trigger/);
  assert.match(migrationSql, /v_existing_intent\.reminder_index is distinct from v_reminder_index/);
  assert.doesNotMatch(migrationSql, /snapshot_subject is distinct from/i);
});

test("intent insert is pending-only with on conflict do nothing and no snapshot rewrite", () => {
  assert.match(migrationSql, /'pending'/);
  assert.match(migrationSql, /on conflict \(idempotency_key\) do nothing/i);
  assert.doesNotMatch(migrationSql, /on conflict \(idempotency_key\) do update/i);
  assert.doesNotMatch(migrationSql, /update public\.client_email_send_intents/i);
});

test("strict lifecycle and needs-more operations are enforced", () => {
  assert.match(migrationSql, /open_lifecycle_episode/);
  assert.match(migrationSql, /create_lifecycle_initial_intent/);
  assert.match(migrationSql, /open_needs_more_sequence/);
  assert.match(migrationSql, /create_needs_more_initial_intent/);
  assert.match(migrationSql, /create_needs_more_reminder_intent/);
  assert.match(migrationSql, /lifecycle_initial_index_required/);
  assert.match(migrationSql, /needs_more_active_sequence_required/);
  assert.match(migrationSql, /needs_more_reminder_index_out_of_range/);
});

test("closed parent episodes or sequences are not reopened", () => {
  assert.match(migrationSql, /parent_episode_not_reopenable/);
  assert.match(migrationSql, /status <> 'active'/);
});

test("migration creates no trigger cron queue postmark or public execute grant", () => {
  assert.doesNotMatch(migrationSql, /create\s+trigger/i);
  assert.doesNotMatch(migrationSql, /pg_cron/i);
  assert.doesNotMatch(migrationSql, /cron\.schedule/i);
  assert.doesNotMatch(migrationSql, /postmark/i);
  assert.doesNotMatch(migrationSql, /grant execute[\s\S]*to anon/i);
  assert.doesNotMatch(migrationSql, /grant execute[\s\S]*to authenticated/i);
});

test("identity conflict uses raise exception for transactional rollback", () => {
  assert.match(migrationSql, /raise exception 'client_email_idempotency_identity_conflict'/i);
  assert.doesNotMatch(migrationSql, /exception\s+when others/i);
});

test("contract doc documents hardened materialize rules", () => {
  assert.match(contractDoc, /client_email_idempotency_identity_conflict/);
  assert.match(contractDoc, /parent_episode_not_reopenable/);
  assert.match(contractDoc, /buildMaterializeCandidateCommand/);
  assert.match(contractDoc, /20260704120000_client_email_materialize_outbox_rpc\.sql/);
});

test("materializer module is not wired to HTTP routes in its source file", () => {
  assert.match(materializerSource, /Internal-only RPC caller/);
  assert.doesNotMatch(materializerSource, /from ['"].*app\/api\//);
  assert.doesNotMatch(materializerSource, /from ['"]@\/app\/api\//);
});

test("no historical test intent seed data in migration", () => {
  assert.doesNotMatch(migrationSql, /intent_kind=test/i);
  assert.doesNotMatch(migrationSql, /insert into public\.client_email_delivery_events/i);
});

test("corrective migration is create or replace function only with no table DDL", () => {
  assert.match(correctiveMigrationSql, /create or replace function public\.materialize_client_email_outbox_candidate_v1/i);
  assert.doesNotMatch(correctiveMigrationSql, /create\s+table/i);
  assert.doesNotMatch(correctiveMigrationSql, /alter\s+table/i);
  assert.doesNotMatch(correctiveMigrationSql, /select\s+public\.materialize_client_email_outbox_candidate_v1/i);
});

test("from_email validation runs before first parent or intent insert on create-intent paths", () => {
  const validationPos = migrationSql.indexOf("client_email_from_email_snapshot_missing");
  const firstParentInsertPos = Math.min(
    migrationSql.indexOf("insert into public.client_email_lifecycle_episodes"),
    migrationSql.indexOf("insert into public.client_email_needs_more_targets_sequences"),
  );
  const firstIntentInsertPos = migrationSql.indexOf("insert into public.client_email_send_intents");
  assert.ok(validationPos >= 0);
  assert.ok(firstParentInsertPos > validationPos);
  assert.ok(firstIntentInsertPos > validationPos);
});

test("from_email mismatch raises stable P0001 exception before ok:false sender paths", () => {
  assert.match(
    migrationSql,
    /raise exception using[\s\S]*errcode = 'P0001'[\s\S]*message = 'client_email_from_email_snapshot_mismatch'/i,
  );
  assert.match(
    migrationSql,
    /raise exception using[\s\S]*errcode = 'P0001'[\s\S]*message = 'client_email_from_email_snapshot_missing'/i,
  );
  assert.match(migrationSql, /btrim\(p_from_email\) is distinct from btrim\(p_from_email_snapshot\)/);
  assert.doesNotMatch(migrationSql, /'code', 'client_email_from_email_snapshot_mismatch'/);
  assert.doesNotMatch(migrationSql, /'code', 'client_email_from_email_snapshot_missing'/);
});

test("identical from_email values after btrim pass validation guard for create intent operations", () => {
  assert.match(migrationSql, /btrim\(p_from_email\) is distinct from btrim\(p_from_email_snapshot\)/);
  assert.match(migrationSql, /btrim\(p_from_email_snapshot\)/);
  assert.match(migrationSql, /create_lifecycle_initial_intent/);
  assert.match(migrationSql, /create_needs_more_initial_intent/);
  assert.match(migrationSql, /create_needs_more_reminder_intent/);
});

test("materialize RPC signature remains 21 parameters with jsonb return", () => {
  const signatureBlock = migrationSql.slice(
    migrationSql.indexOf("create or replace function public.materialize_client_email_outbox_candidate_v1"),
    migrationSql.indexOf("returns jsonb"),
  );
  const paramMatches = signatureBlock.match(/^  p_\w+/gm);
  assert.equal(paramMatches?.length, 21);
  assert.match(migrationSql, /returns jsonb/i);
});

test("base migration preserved without from_email consistency guard", () => {
  assert.doesNotMatch(baseMigrationSql, /client_email_from_email_snapshot_mismatch/);
  assert.doesNotMatch(baseMigrationSql, /client_email_from_email_snapshot_missing/);
});
