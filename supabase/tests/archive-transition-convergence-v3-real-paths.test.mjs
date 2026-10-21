import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const PG = "/opt/homebrew/opt/postgresql@17/bin";
const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const TENANT = "10000000-0000-0000-0000-000000000000";
const ACCOUNT = "10000000-0000-0000-0001-000000000001";

const BASE_FILES = [
  "supabase/baseline/0000_local_platform_compatibility.sql",
  "supabase/baseline/20260728001632_public_schema.sql",
  "supabase/migrations/20260728132018_ct_target_evaluation_performance_lifecycle_v1.sql",
  "supabase/migrations/20260728132019_ct_premium_proposals_and_action_contracts_v1.sql",
  "supabase/migrations/20260728132020_ct_system_rls_and_grants_v1.sql",
  "supabase/migrations/20260728185253_fix_client_account_notifications_global_grants_v1.sql",
  "supabase/migrations/20260728132021_ct_system_transactional_rpcs_v1.sql",
  "supabase/migrations/20260728220631_ct_target_availability_foundations_v1.sql",
  "supabase/migrations/20260728230641_ct_target_availability_restrict_service_role_and_index_fks_v1.sql",
  "supabase/migrations/20260730123708_ct_target_availability_identity_assessment_current_v1.sql",
  "supabase/migrations/20260731161623_target_lifecycle_v1_global_shadow_runtime_v1.sql",
  "supabase/migrations/20260731180200_target_lifecycle_runtime_service_role_least_privilege_v1.sql",
  "supabase/tests/ct-system-fixtures.sql",
  "supabase/tests/archive-transition-convergence-v3-real-fixtures.sql",
  "supabase/tests/archive-transition-current-onboarding-baseline.sql",
];

const ARCHIVE_FILES = [
  "supabase/migrations/20260910215408_archive_transition_convergence_phase_a.sql",
  "supabase/migrations/20260910232624_archive_transition_postgres_owner_guard_off_v1.sql",
  "supabase/migrations/20260910235901_archive_transition_constraint_validator_guard_off_v1.sql",
];

function request(intent, targetIds, overrides = {}) {
  return {
    contract: "archive_transition_v1",
    tenant_id: TENANT,
    account_id: ACCOUNT,
    archive_intent_id: intent,
    target_ids: targetIds,
    reason: "dashboard_archive",
    source: "admin_dashboard",
    actor_type: "admin",
    actor_id: null,
    evidence_reference: null,
    ...overrides,
  };
}

function lifecycleBundle(targetId, suffix, observedAt = "2026-09-10T12:00:00.000Z") {
  return {
    tenant_id: TENANT,
    account_id: ACCOUNT,
    target_id: targetId,
    normalized_username: `synthetic_${suffix}`,
    assessment_key: `archive-v3-${suffix}-assessment`,
    source_fingerprint: "a".repeat(64),
    source_availability_assessment_id: null,
    source_max_observed_at: observedAt,
    status: "insufficient_data",
    availability_status: "insufficient",
    performance_status: "insufficient",
    utilization_status: "insufficient_data",
    utilization_ratio: null,
    unique_profiles_evaluated: 0,
    estimated_exploitable_audience: null,
    denominator_source: "ig_targets.followers_count",
    denominator_version: "ig-target-followers-v1",
    confidence: "unknown",
    identity_status: "insufficient_identity_evidence",
    reason_codes: ["lifecycle_source_evidence_insufficient"],
    missing_evidence: ["availability", "performance", "utilization"],
    replacement_state: "none",
    recommended_action: "collect_more_evidence",
    assessed_at: observedAt,
    valid_until: "2026-09-24T12:00:00.000Z",
    engine_version: "target-lifecycle-global-shadow-v1",
    rule_version: "target-lifecycle-priority-v1",
    policy_version: "target-lifecycle-no-action-v1",
    engine_revision: 2,
    policy_revision: 2,
    explanation_safe: { mode: "global_shadow", source_fingerprint: "a".repeat(64) },
    enforcement_allowed: false,
    business_action_allowed: false,
    mutation_executed: false,
    performance_observation: {
      source_event_key: `archive-v3-${suffix}-performance`,
      follows: 10,
      followbacks: 1,
      reliability: "strong",
      observed_at: observedAt,
      reason: "legacy_counter",
      metadata_safe: { source: "local_contract_test" },
    },
  };
}

test("real production-schema archive paths pass under the Supabase-like non-superuser postgres guard-off model", { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp("/private/tmp/archive-convergence-v3-pg17-");
  const data = path.join(root, "data");
  const socket = path.join(root, "socket");
  const log = path.join(root, "postgres.log");
  await run(`${PG}/initdb`, ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust", "--username=bootstrap_admin"]);
  await run("/bin/mkdir", ["-p", socket]);
  await run(`${PG}/pg_ctl`, ["-D", data, "-l", log, "-o", `-c listen_addresses='' -k '${socket}'`, "-w", "start"]);
  t.after(async () => {
    await run(`${PG}/pg_ctl`, ["-D", data, "-m", "fast", "-w", "stop"]).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  const psql = async (sql, { reject = true } = {}) => {
    try {
      const { stdout } = await run(`${PG}/psql`, ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", socket, "-U", "postgres", "-d", "postgres", "-c", sql]);
      return { ok: true, output: stdout.trim() };
    } catch (error) {
      if (reject) throw error;
      return { ok: false, output: `${error.stderr ?? ""}${error.stdout ?? ""}` };
    }
  };
  const adminPsql = async (sql) => run(`${PG}/psql`, ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", socket, "-U", "bootstrap_admin", "-d", "postgres", "-c", sql]);
  const file = async (name) => run(`${PG}/psql`, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", socket, "-U", "postgres", "-d", "postgres", "-f", path.join(ROOT, name)]);
  await adminPsql("create role postgres login superuser createrole createdb bypassrls; alter database postgres owner to postgres");
  for (const name of BASE_FILES) await file(name);
  await adminPsql("grant service_role to postgres");
  await adminPsql("alter role postgres nosuperuser nocreatedb createrole bypassrls");
  assert.equal((await psql("select rolsuper::text||'|'||rolcreaterole::text||'|'||rolbypassrls::text from pg_roles where rolname='postgres'")).output, "false|true|true");
  for (const name of ARCHIVE_FILES) await file(name);

  const archiveSemanticFingerprint = async () => (await psql(`
    with objects(item) as (
      select 'function|'||p.oid::regprocedure::text||'|'||pg_get_functiondef(p.oid)||'|'||
             coalesce(p.proacl::text,'')||'|'||r.rolname
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
      where (n.nspname='archive_internal' and p.proname like '%archive%')
         or (n.nspname='public' and p.proname in (
           'archive_targets_transition_batch_v1','archive_target_transition_v1',
           'reconcile_archived_target_lifecycle_v1','persist_target_lifecycle_shadow_v1',
           'persist_target_lifecycle_shadow_unlocked_v1','ct_recompute_target_lifecycle_v1',
           'ct_recompute_target_lifecycle_unlocked_v1','rollback_test_instagram_onboarding_v1',
           'rollback_test_instagram_onboarding_unlocked_v1'))
      union all
      select 'constraint|'||c.conname||'|'||pg_get_constraintdef(c.oid,true)||'|'||coalesce(obj_description(c.oid,'pg_constraint'),'')
      from pg_constraint c
      where c.conrelid in ('public.ct_target_lifecycle_assessments'::regclass,'archive_internal.archive_transition_requests'::regclass)
      union all
      select 'index|'||c.relname||'|'||pg_get_indexdef(c.oid)||'|'||coalesce(obj_description(c.oid,'pg_class'),'')
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','archive_internal') and c.relname like '%archive_transition%'
    ) select md5(string_agg(item,E'\\n' order by item)) from objects
  `)).output;
  const firstApplyFingerprint = await archiveSemanticFingerprint();
  for (const name of ARCHIVE_FILES) await file(name);
  assert.equal(await archiveSemanticFingerprint(), firstApplyFingerprint);
  assert.equal((await psql("select exists(select 1 from pg_trigger where tgname='ig_targets_archive_transition_guard_v1')")).output, "f");
  assert.equal((await psql("select to_regprocedure('archive_internal.reject_direct_archive_v1()') is null")).output, "t");

  const definitions = await psql(`select proname||'|'||prosrc from pg_proc where pronamespace='public'::regnamespace and proname in ('rollback_test_instagram_onboarding_unlocked_v1','persist_target_lifecycle_shadow_unlocked_v1','ct_recompute_target_lifecycle_unlocked_v1') order by proname`);
  assert.match(definitions.output, /revoke_instagram_account_credentials/);
  assert.match(definitions.output, /stripe_test_subscription_requires_canonical_cancel/);
  assert.match(definitions.output, /capacity_release_delta_not_one/);
  assert.match(definitions.output, /commercial_checkout_sessions_terminalized/);
  assert.match(definitions.output, /ct_target_performance_observations/);
  assert.match(definitions.output, /ct_target_evaluated_profiles/);
  assert.doesNotMatch(definitions.output, /select jsonb_build_object\('outcome','processed'/);

  assert.equal((await psql("select count(*) from pg_roles where rolname like 'archive_transition_%writer%'")).output, "0");
  assert.equal((await psql("select r.rolname||'|'||p.prosecdef::text||'|'||array_to_string(p.proconfig,',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='archive_internal' and p.proname='archive_target_transition_kernel_v1'")).output, 'postgres|true|search_path=""');
  assert.equal((await psql("select has_function_privilege('service_role','archive_internal.archive_target_transition_kernel_v1(jsonb)','EXECUTE')::text||'|'||has_function_privilege('service_role','public.archive_targets_transition_batch_v1(jsonb)','EXECUTE')::text||'|'||has_function_privilege('authenticated','public.archive_targets_transition_batch_v1(jsonb)','EXECUTE')::text||'|'||has_function_privilege('anon','public.archive_targets_transition_batch_v1(jsonb)','EXECUTE')::text")).output, "false|true|false|false");

  const target1 = (await psql("select md5('target:1')::uuid")).output;
  const call = (value) => `set role service_role; set request.jwt.claim.role='service_role'; select public.archive_targets_transition_batch_v1($request$${JSON.stringify(value)}$request$::jsonb)::text`;
  const first = JSON.parse((await psql(call(request("31000000-0000-4000-8000-000000000001", [target1])))).output.split("\n").at(-1));
  assert.equal(first.archived, 1);

  const forbiddenTarget = (await psql("select md5('target:2')::uuid")).output;
  const forbidden = await psql(call(request("31000000-0000-4000-8000-000000000002", [forbiddenTarget], {
    target_patch: { metadata_safe: { password: "never-store" } },
  })), { reject: false });
  assert.equal(forbidden.ok, false);
  assert.match(forbidden.output, /archive_transition_target_patch_invalid/);
  assert.equal((await psql(`select archived_at is null from ig_targets where id='${forbiddenTarget}'`)).output, "t");

  const batchTargets = [];
  for (let index = 0; index < 4; index += 1) batchTargets.push((await psql(`select md5('target:${index + 3}')::uuid`)).output);
  const batch = JSON.parse((await psql(call(request("31000000-0000-4000-8000-000000000003", batchTargets.slice(0, 2))))).output.split("\n").at(-1));
  assert.equal(batch.archived, 2);
  for (const [index, source] of ["private_streak", "verification_ineligible"].entries()) {
    const result = JSON.parse((await psql(call(request(`31000000-0000-4000-8000-00000000000${index + 4}`, [batchTargets[index + 2]], {
      source,
      reason: source === "private_streak" ? "consecutive_private_opened_profiles" : "verified_ineligible_confirmed",
      actor_type: "system",
    })))).output.split("\n").at(-1));
    assert.equal(result.archived, 1);
  }

  const onboardingCall = `public.rollback_test_instagram_onboarding_v1(
    '20000000-0000-0000-0001-000000000001','20000000-0000-0000-0000-000000000000',
    md5('entitlement:'||'20000000-0000-0000-0001-000000000001')::uuid,'synthetic_agency_1',
    md5('checkout:'||'20000000-0000-0000-0001-000000000001')::uuid,'premium',
    'test_onboarding_rollback','request-v3','idempotency-v3',false)`;
  await psql(`begin; set local role service_role; set local request.jwt.claim.role='service_role'; do $body$
    declare r jsonb; begin r := ${onboardingCall};
      if not coalesce((r->>'ok')::boolean,false) or r->>'reason'<>'rolled_back' then raise exception 'real_onboarding_failed:%',r; end if;
      if (select status from ig_targets where id='21000000-0000-4000-8000-000000000020') <> 'archived' then raise exception 'onboarding_target_not_archived'; end if;
      if not exists(select 1 from ct_target_lifecycle_assessments where target_id='21000000-0000-4000-8000-000000000020' and assessment_kind='terminal_archive') then raise exception 'onboarding_terminal_assessment_missing'; end if;
      if (select status from ig_accounts where id='20000000-0000-0000-0001-000000000001') <> 'rolled_back_test_onboarding' then raise exception 'parent_mutations_missing'; end if;
    end $body$; rollback`);

  await psql(`create function public.v3_fail_onboarding_audit() returns trigger language plpgsql as $$ begin raise exception 'v3_injected_after_archive'; end $$;
    create trigger v3_fail_onboarding_audit before insert on public.test_instagram_onboarding_rollbacks for each row execute function public.v3_fail_onboarding_audit()`);
  const failedParent = JSON.parse((await psql(`set role service_role; set request.jwt.claim.role='service_role'; select ${onboardingCall}::text`)).output.split("\n").at(-1));
  assert.equal(failedParent.ok, false);
  assert.equal(failedParent.error_safe, "onboarding_rollback_legacy_transaction_failed");
  assert.equal((await psql("select status from ig_accounts where id='20000000-0000-0000-0001-000000000001'")).output, "active");
  assert.equal((await psql("select status from ig_targets where id='21000000-0000-4000-8000-000000000020'")).output, "valid");
  assert.equal((await psql("select count(*) from archive_internal.archive_transition_requests where account_id='20000000-0000-0000-0001-000000000001'")).output, "0");
  await psql("drop trigger v3_fail_onboarding_audit on public.test_instagram_onboarding_rollbacks; drop function public.v3_fail_onboarding_audit()");

  const target7 = (await psql("select md5('target:7')::uuid")).output;
  const target8 = (await psql("select md5('target:8')::uuid")).output;
  const persistCall = (bundle) => `set role service_role; set request.jwt.claim.role='service_role'; select public.persist_target_lifecycle_shadow_v1($bundle$${JSON.stringify(bundle)}$bundle$::jsonb,'archive-v3-test')::text`;
  const persisted = JSON.parse((await psql(persistCall(lifecycleBundle(target7, "pre-guard")))).output.split("\n").at(-1));
  assert.equal(persisted.outcome, "processed");
  const recomputed = JSON.parse((await psql(`set role service_role; set request.jwt.claim.role='service_role'; select public.ct_recompute_target_lifecycle_v1('${ACCOUNT}','${target8}',100,'fixture','v3','unknown','archive-v3-recompute-pre',clock_timestamp())::text`)).output.split("\n").at(-1));
  assert.ok(["insufficient_data", "stale_data", "healthy"].includes(recomputed.status));
  assert.equal(JSON.parse((await psql(call(request("31000000-0000-4000-8000-000000000007", [target7])))).output.split("\n").at(-1)).archived, 1);
  assert.equal(JSON.parse((await psql(call(request("31000000-0000-4000-8000-000000000008", [target8])))).output.split("\n").at(-1)).archived, 1);
  assert.equal(JSON.parse((await psql(persistCall({ ...lifecycleBundle(target7, "pre-guard-after", "2026-09-10T13:00:00.000Z") }))).output.split("\n").at(-1)).reason, "target_archived");
  assert.equal(JSON.parse((await psql(`set role service_role; set request.jwt.claim.role='service_role'; select public.ct_recompute_target_lifecycle_v1('${ACCOUNT}','${target8}',100,'fixture','v3','unknown','archive-v3-recompute-after',clock_timestamp())::text`)).output.split("\n").at(-1)).outcome, "target_archived");

  const reconciliationTargets = [
    "542b758f-004e-4e88-a381-dd441b60ad5e",
    "1ec040d0-6420-4d50-bd5d-7cc3834c13d3",
    "d108e3aa-4765-45ff-be4b-5152ca5f00a8",
  ];
  for (const [index, targetId] of reconciliationTargets.entries()) {
    await psql(`insert into public.ig_targets(id,account_id,target_username,status,source,input_username,normalized_username,canonical_username,verification_status,quality_status,actor_type)
      values('${targetId}','${ACCOUNT}','reconcile_${index}','valid','fixture','reconcile_${index}','reconcile_${index}','reconcile_${index}','found','eligible','system')`);
    await psql(`set role service_role; set request.jwt.claim.role='service_role'; select public.ct_recompute_target_lifecycle_v1('${ACCOUNT}','${targetId}',null,'fixture','v3','unknown','archive-v3-reconcile-${index}',clock_timestamp())`);
    await psql(`update public.ct_target_lifecycle_current set status='insufficient_data' where tenant_id='${TENANT}' and account_id='${ACCOUNT}' and target_id='${targetId}'`);
    await psql(`update public.ig_targets set status='archived',archived_at=clock_timestamp(),archive_reason='dashboard_archive' where id='${targetId}'`);
    const reconcileRequest = { contract: "archive_transition_reconciliation_v1", tenant_id: TENANT, account_id: ACCOUNT, target_id: targetId, archive_intent_id: `33000000-0000-4000-8000-00000000000${index + 1}`, evidence_reference: "local-v3" };
    const reconciled = JSON.parse((await psql(`set role service_role; set request.jwt.claim.role='service_role'; select public.reconcile_archived_target_lifecycle_v1($request$${JSON.stringify(reconcileRequest)}$request$::jsonb)::text`)).output.split("\n").at(-1));
    assert.equal(reconciled.outcome, "reconciled");
  }

  const target = async (n) => (await psql(`select md5('target:${n}')::uuid`)).output;
  const target9 = await target(9);
  const target9Request = request("32000000-0000-4000-8000-000000000009", [target9]);
  assert.equal(JSON.parse((await psql(call(target9Request))).output.split("\n").at(-1)).archived, 1);
  assert.equal(JSON.parse((await psql(call(target9Request))).output.split("\n").at(-1)).replayed, true);
  const replayConflict = await psql(call({ ...target9Request, reason: "changed_payload" }), { reject: false });
  assert.equal(replayConflict.ok, false);
  assert.match(replayConflict.output, /archive_transition_replay_conflict/);
  const alreadyArchived = JSON.parse((await psql(call(request("32000000-0000-4000-8000-000000000109", [target9])))).output.split("\n").at(-1));
  assert.equal(alreadyArchived.items[0].outcome, "already_archived");
  const target10 = await target(10);
  const target11 = await target(11);
  assert.equal(JSON.parse((await psql(call(request("32000000-0000-4000-8000-000000000010", [target10, target11])))).output.split("\n").at(-1)).archived, 2);
  const target12 = await target(12);
  assert.equal(JSON.parse((await psql(call(request("32000000-0000-4000-8000-000000000012", [target12], { source: "private_streak", reason: "consecutive_private_opened_profiles", actor_type: "system" })))).output.split("\n").at(-1)).archived, 1);

  const target13 = await target(13);
  const availabilityAssessment = "34000000-0000-4000-8000-000000000013";
  await psql(`insert into public.ct_target_availability_assessments(
      id,tenant_id,account_id,target_id,assessment_key,normalized_username,status,confidence,identity_resolution,
      reason_codes,evidence_count,distinct_run_count,distinct_device_count,latest_observed_at,recheck_required,
      quarantine_recommended,terminal_proof,assessed_at,model_version,assessment_status_v3,identity_status_v3,
      repeat_count,rule_version,engine_version,engine_revision,policy_revision,first_evidence_at,last_evidence_at,valid_until
    ) values (
      '${availabilityAssessment}','${TENANT}','${ACCOUNT}','${target13}','archive-v3-not-found-proof','synthetic_target_13',
      'permanently_unavailable','high','unchanged',array['confirmed_not_found'],2,2,1,clock_timestamp(),false,false,true,
      clock_timestamp(),'archive-v3','unavailable_confirmed','identity_confirmed',2,'archive-v3','archive-v3',1,1,
      clock_timestamp()-interval '1 minute',clock_timestamp(),clock_timestamp()+interval '1 day'
    );
    insert into public.ct_target_availability_current(
      tenant_id,account_id,target_id,assessment_id,availability_status,confidence,identity_status,latest_observation_at,
      confirmed_at,valid_until,stale_after,reason_codes,engine_version,policy_version,engine_revision,policy_revision
    ) values ('${TENANT}','${ACCOUNT}','${target13}','${availabilityAssessment}','unavailable_confirmed','high','identity_confirmed',
      clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days',
      array['confirmed_not_found'],'archive-v3','archive-v3',1,1)`);
  assert.equal(JSON.parse((await psql(call(request("32000000-0000-4000-8000-000000000013", [target13], { source: "verification_not_found", reason: "confirmed_not_found", actor_type: "system", target_patch: { verification_status: "not_found", verification_reason: "confirmed_not_found" } })))).output.split("\n").at(-1)).archived, 1);

  const target14 = await target(14);
  assert.equal(JSON.parse((await psql(call(request("32000000-0000-4000-8000-000000000014", [target14], { source: "verification_ineligible", reason: "verified_ineligible_confirmed", actor_type: "system", target_patch: { quality_status: "rejected_verified" } })))).output.split("\n").at(-1)).archived, 1);
  const target15 = await target(15);
  assert.equal(JSON.parse((await psql(call(request("32000000-0000-4000-8000-000000000015", [target15], { source: "low_fbr", reason: "legacy_low_fbr_compatibility", actor_type: "system" })))).output.split("\n").at(-1)).archived, 1);

  const target17 = await target(17);
  assert.equal(JSON.parse((await psql(persistCall(lifecycleBundle(target17, "post-guard")))).output.split("\n").at(-1)).outcome, "processed");
  assert.equal(JSON.parse((await psql(call(request("32000000-0000-4000-8000-000000000017", [target17])))).output.split("\n").at(-1)).archived, 1);
  assert.equal(JSON.parse((await psql(persistCall(lifecycleBundle(target17, "post-guard-after", "2026-09-10T13:00:00.000Z")))).output.split("\n").at(-1)).reason, "target_archived");
  const target18 = await target(18);
  assert.ok(JSON.parse((await psql(`set role service_role; set request.jwt.claim.role='service_role'; select public.ct_recompute_target_lifecycle_v1('${ACCOUNT}','${target18}',100,'fixture','v3','unknown','archive-v3-recompute-post',clock_timestamp())::text`)).output.split("\n").at(-1)).assessmentId);
  assert.equal(JSON.parse((await psql(call(request("32000000-0000-4000-8000-000000000018", [target18])))).output.split("\n").at(-1)).archived, 1);
  assert.equal(JSON.parse((await psql(`set role service_role; set request.jwt.claim.role='service_role'; select public.ct_recompute_target_lifecycle_v1('${ACCOUNT}','${target18}',100,'fixture','v3','unknown','archive-v3-recompute-post-after',clock_timestamp())::text`)).output.split("\n").at(-1)).outcome, "target_archived");

  const crossTenant = await psql(call(request("32000000-0000-4000-8000-000000000019", [await target(19)], { tenant_id: "20000000-0000-0000-0000-000000000000" })), { reject: false });
  assert.equal(crossTenant.ok, false);
  assert.match(crossTenant.output, /archive_transition_scope_rejected/);
  assert.equal((await psql("select has_table_privilege('service_role','archive_internal.archive_transition_requests','SELECT')")).output, "f");

  for (const [index, targetId] of reconciliationTargets.entries()) {
    const reconcileRequest = { contract: "archive_transition_reconciliation_v1", tenant_id: TENANT, account_id: ACCOUNT, target_id: targetId, archive_intent_id: `33000000-0000-4000-8000-00000000000${index + 1}`, evidence_reference: "local-v3" };
    const replay = JSON.parse((await psql(`set role service_role; set request.jwt.claim.role='service_role'; select public.reconcile_archived_target_lifecycle_v1($request$${JSON.stringify(reconcileRequest)}$request$::jsonb)::text`)).output.split("\n").at(-1));
    assert.equal(replay.replayed, true);
    assert.equal((await psql(`select status from public.ct_target_lifecycle_current where tenant_id='${TENANT}' and account_id='${ACCOUNT}' and target_id='${targetId}'`)).output, "archived");
  }

  const target20 = await target(20);
  await psql(`create function public.v3_fail_terminal_assessment() returns trigger language plpgsql as $$ begin
      if new.assessment_kind='terminal_archive' and new.target_id='${target20}' then raise exception 'v3_injected_terminal_assessment'; end if; return new; end $$;
    create trigger v3_fail_terminal_assessment before insert on public.ct_target_lifecycle_assessments for each row execute function public.v3_fail_terminal_assessment()`);
  const injectedIntent = "32000000-0000-4000-8000-000000000020";
  const injected = await psql(call(request(injectedIntent, [target20])), { reject: false });
  assert.equal(injected.ok, false);
  assert.match(injected.output, /v3_injected_terminal_assessment/);
  assert.equal((await psql(`select status='valid' and archived_at is null from public.ig_targets where id='${target20}'`)).output, "t");
  assert.equal((await psql(`select count(*) from archive_internal.archive_transition_requests where archive_intent_id='${injectedIntent}'`)).output, "0");
  assert.equal((await psql(`select count(*) from public.ct_target_lifecycle_assessments where target_id='${target20}' and assessment_kind='terminal_archive'`)).output, "0");
  await psql("drop trigger v3_fail_terminal_assessment on public.ct_target_lifecycle_assessments; drop function public.v3_fail_terminal_assessment()");
  await psql(`begin; set local role service_role; set local request.jwt.claim.role='service_role'; do $body$
    declare r jsonb; begin r := ${onboardingCall};
      if not coalesce((r->>'ok')::boolean,false) then raise exception 'post_guard_onboarding_failed:%',r; end if;
    end $body$; rollback`);

  const historyUpdate = await psql("set role service_role; update ct_target_lifecycle_assessments set status='healthy'", { reject: false });
  assert.equal(historyUpdate.ok, false);
  const historyDelete = await psql("set role service_role; delete from ct_target_lifecycle_assessments", { reject: false });
  assert.equal(historyDelete.ok, false);
  const historyTruncate = await psql("set role service_role; truncate ct_target_lifecycle_assessments", { reject: false });
  assert.equal(historyTruncate.ok, false);
});
