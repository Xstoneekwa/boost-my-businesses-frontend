import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ARCHIVE_TRANSITION_CONTRACT,
  archiveTransitionRequest,
  deterministicArchiveIntentId,
} from "./archive-transition-contract.ts";

const migration = readFileSync(new URL("../../supabase/migrations/20260910215408_archive_transition_convergence_phase_a.sql", import.meta.url), "utf8");
const ownerContract = readFileSync(new URL("../../supabase/migrations/20260910232624_archive_transition_postgres_owner_guard_off_v1.sql", import.meta.url), "utf8");
const validatorContract = readFileSync(new URL("../../supabase/migrations/20260910235901_archive_transition_constraint_validator_guard_off_v1.sql", import.meta.url), "utf8");
const strict = readFileSync(new URL("../../supabase/tests/fixtures/archive-transition-convergence-strict-guard-phase-e.sql.fixture", import.meta.url), "utf8");

test("canonical request normalizes order without transport request identity", () => {
  const request = archiveTransitionRequest({
    tenantId: "tenant", accountId: "account",
    archiveIntentId: "11111111-1111-4111-8111-111111111111",
    targetIds: ["b", "a", "b"], reason: "dashboard_archive",
    source: "admin_dashboard", actorType: "admin", actorId: "actor",
  });
  assert.equal(request.contract, ARCHIVE_TRANSITION_CONTRACT);
  assert.deepEqual(request.target_ids, ["a", "b"]);
  assert.equal("request_id" in request, false);
});

test("deterministic machine intent is stable and UUID-shaped", () => {
  const a = deterministicArchiveIntentId(["policy", "tenant", "account", "target", "decision"]);
  const b = deterministicArchiveIntentId(["policy", "tenant", "account", "target", "decision"]);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("phase A installs the kernel and facades but not the strict trigger", () => {
  assert.match(migration, /archive_internal\.archive_target_transition_kernel_v1/);
  assert.match(migration, /public\.archive_target_transition_v1/);
  assert.match(migration, /public\.archive_targets_transition_batch_v1/);
  assert.doesNotMatch(migration, /create trigger ig_targets_archive_transition_guard/);
  assert.doesNotMatch(migration, /archive_transition_writer/);
  assert.doesNotMatch(migration, /reject_direct_archive_v1/);
  assert.match(migration, /alter function archive_internal\.archive_target_transition_kernel_v1\(jsonb\) owner to postgres/);
  assert.match(strict, /create trigger ig_targets_archive_transition_guard/);
});

test("the delivered migration chain contains no strict-guard activation", () => {
  const migrations = readFileSync(new URL("../../supabase/migrations/20260910215408_archive_transition_convergence_phase_a.sql", import.meta.url), "utf8")
    + readFileSync(new URL("../../supabase/migrations/20260910232624_archive_transition_postgres_owner_guard_off_v1.sql", import.meta.url), "utf8")
    + readFileSync(new URL("../../supabase/migrations/20260910235901_archive_transition_constraint_validator_guard_off_v1.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migrations, /create\s+trigger\s+ig_targets_archive_transition_guard_v1/i);
  assert.doesNotMatch(migrations, /enable\s+trigger\s+ig_targets_archive_transition_guard_v1/i);
  assert.doesNotMatch(migrations, /archive_transition_writer/i);
});

test("terminal history is typed while ordinary assessment requirements remain", () => {
  assert.match(migration, /assessment_kind = 'evaluation'[\s\S]*unique_profiles_evaluated is not null/);
  assert.match(migration, /assessment_kind = 'terminal_archive'[\s\S]*unique_profiles_evaluated is null/);
  assert.match(migration, /contract_version = 'archive_transition_v1'/);
  assert.match(migration, /ct_target_lifecycle_assessments_typed_payload_check/);
});

test("security and projector boundaries fail closed", () => {
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /archive_transition_replay_conflict/);
  assert.match(migration, /archive_transition_not_found_proof_stale/);
  assert.match(migration, /'out_of_order_skipped','reason','target_archived','business_actions',0/);
  assert.match(migration, /rollback_test_instagram_onboarding_unlocked_v1/);
});

test("guard-off ownership keeps the kernel private and facades service-role-only", () => {
  const kernel = migration.match(/create or replace function archive_internal\.archive_target_transition_kernel_v1[\s\S]*?\n\$\$;/i)?.[0] ?? "";
  assert.match(kernel, /security definer[\s\S]*set search_path = ''/i);
  assert.doesNotMatch(kernel, /\bexecute\b/i);
  assert.match(kernel, /c\.client_id = v_tenant and c\.account_id = v_account/);
  assert.match(kernel, /t\.account_id=v_account and t\.id=any\(v_targets\)/);
  assert.match(kernel, /canonical_fingerprint is distinct from v_fingerprint/);
  assert.match(ownerContract, /revoke all on function archive_internal\.archive_target_transition_kernel_v1\(jsonb\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(ownerContract, /grant execute on function public\.archive_targets_transition_batch_v1\(jsonb\) to service_role/i);
  assert.match(ownerContract, /archive_transition_facade_acl_invalid/);
  assert.doesNotMatch(`${migration}${ownerContract}${validatorContract}`, /archive_transition_writer/i);
});
