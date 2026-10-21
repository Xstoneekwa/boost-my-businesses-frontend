import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationPath = new URL("./20260903200257_target_evidence_revalidation_v1.sql", import.meta.url);
const sql = fs.readFileSync(migrationPath, "utf8");

test("evidence revalidation RPCs are service-role-only security definers", () => {
  assert.equal((sql.match(/security definer/gi) ?? []).length, 4);
  assert.equal((sql.match(/set search_path = ''/gi) ?? []).length, 5);
  for (const name of [
    "enqueue_ct_target_evidence_revalidation_job_v1",
    "claim_ct_target_evidence_revalidation_jobs_v1",
    "terminalize_invalid_ct_target_evidence_jobs_v1",
    "persist_ct_target_evidence_refresh_v1",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\(`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^;]+to service_role;`));
  }
});

test("invalid old jobs are fail-closed with a durable safe lineage audit", () => {
  assert.match(sql, /last_error_code = 'invalid_target_lineage'/i);
  assert.match(sql, /'trigger_source', 'legacy_lineage_hygiene'/i);
  assert.match(sql, /not exists \(\s*select 1\s*from public\.ig_targets/i);
});

test("periodic lineage never writes a text marker into UUID batch_id", () => {
  assert.doesNotMatch(sql, /batch_id\s*=\s*['"]periodic_weekly/i);
  assert.match(sql, /batch_id\s*=\s*null/i);
  assert.match(sql, /'trigger_source',\s*'periodic_weekly'/i);
});

test("evidence claim is isolated from legacy and business jobs", () => {
  assert.match(sql, /metadata_safe->>'trigger_source'[^\n]+periodic_weekly/i);
  assert.match(sql, /metadata_safe->>'mode'[^\n]+evidence_only/i);
  assert.match(sql, /t\.account_id\s*=\s*j\.account_id/i);
  assert.match(sql, /normalized_username[^\n]+normalized_username/i);
  assert.match(sql, /j\.created_at < now\(\) - interval '7 days'/i);
  assert.match(sql, /j\.attempt_count = 0/i);
  assert.match(sql, /quality_status[^\n]+eligible/i);
  assert.match(sql, /verification_status[^\n]+found/i);
});

test("business claim cannot cross into evidence-only work", () => {
  const start = sql.indexOf("create or replace function public.claim_ct_target_verification_jobs(");
  const end = sql.indexOf("$function$;", start);
  const body = sql.slice(start, end);
  assert.match(body, /metadata_safe->>'mode'[^\n]+<> 'evidence_only'/i);
  assert.match(body, /t\.account_id\s*=\s*j\.account_id/i);
  assert.match(body, /normalized_username[^\n]+normalized_username/i);
});

test("evidence persistence cannot mutate business classification fields", () => {
  const start = sql.indexOf("create or replace function public.persist_ct_target_evidence_refresh_v1");
  const end = sql.indexOf("$function$;", start);
  const body = sql.slice(start, end);
  for (const forbidden of [
    "quality_status =",
    "verification_status =",
    "archived_at =",
    "archive_reason =",
    "pool_eligible",
    "replacement",
  ]) {
    assert.equal(body.includes(forbidden), false, `forbidden mutation: ${forbidden}`);
  }
  assert.match(body, /followers_count\s*=\s*p_followers_count/i);
  assert.match(body, /provider_checked_at\s*=\s*p_provider_checked_at/i);
});
