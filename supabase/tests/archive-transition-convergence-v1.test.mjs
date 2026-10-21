import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const PG = "/opt/homebrew/opt/postgresql@17/bin";
const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const TENANT = "10000000-0000-4000-8000-000000000001";
const ACCOUNT = "10000000-0000-4000-8000-000000000002";
const TARGET = "10000000-0000-4000-8000-000000000010";
const TARGET_2 = "10000000-0000-4000-8000-000000000011";
const OTHER_TARGET = "20000000-0000-4000-8000-000000000010";

function request(intent, targetIds = [TARGET], overrides = {}) {
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

test("archive transition is atomic, idempotent, concurrent, and tenant safe under a non-superuser postgres owner", { timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "archive-transition-pg17-"));
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
  const adminProbe = async (sql, { reject = true } = {}) => {
    try {
      const { stdout } = await adminPsql(sql);
      return { ok: true, output: stdout.trim() };
    } catch (error) {
      if (reject) throw error;
      return { ok: false, output: `${error.stderr ?? ""}${error.stdout ?? ""}` };
    }
  };
  const file = async (name) => run(`${PG}/psql`, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", socket, "-U", "postgres", "-d", "postgres", "-f", path.join(ROOT, name)]);
  const call = (value) => `set role service_role; set request.jwt.claim.role='service_role'; select public.archive_targets_transition_batch_v1($request$${JSON.stringify(value)}$request$::jsonb)::text`;

  await adminPsql("create role postgres login superuser createrole createdb bypassrls; alter database postgres owner to postgres");
  await file("supabase/tests/archive-transition-convergence-v1-bootstrap.sql");
  await adminPsql("grant service_role to postgres");
  await adminPsql("alter role postgres nosuperuser nocreatedb createrole bypassrls");
  assert.equal((await psql("select rolsuper::text||'|'||rolcreaterole::text||'|'||rolbypassrls::text from pg_roles where rolname='postgres'")).output, "false|true|true");
  await file("supabase/migrations/20260910215408_archive_transition_convergence_phase_a.sql");
  await file("supabase/migrations/20260910232624_archive_transition_postgres_owner_guard_off_v1.sql");
  assert.equal((await psql("select exists(select 1 from pg_trigger where tgname='ig_targets_archive_transition_guard_v1')")).output, "f");
  assert.equal((await psql("select to_regprocedure('archive_internal.reject_direct_archive_v1()') is null")).output, "t");
  assert.equal((await psql("select count(*) from pg_roles where rolname like 'archive_transition_%writer%'")).output, "0");
  assert.equal((await psql("select relrowsecurity::text||'|'||relforcerowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='archive_internal' and c.relname='archive_transition_requests'")).output, "true|true");
  assert.equal((await psql("select r.rolname||'|'||p.prosecdef::text||'|'||array_to_string(p.proconfig,',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='archive_internal' and p.proname='archive_target_transition_kernel_v1'")).output, 'postgres|true|search_path=""');
  assert.equal((await psql("select has_function_privilege('service_role','archive_internal.archive_target_transition_kernel_v1(jsonb)','EXECUTE')")).output, "f");
  assert.equal((await psql("select has_function_privilege('authenticated','archive_internal.archive_target_transition_kernel_v1(jsonb)','EXECUTE')")).output, "f");
  assert.equal((await psql("select has_function_privilege('anon','archive_internal.archive_target_transition_kernel_v1(jsonb)','EXECUTE')")).output, "f");
  assert.equal((await psql("select has_function_privilege('service_role','public.archive_targets_transition_batch_v1(jsonb)','EXECUTE')::text||'|'||has_function_privilege('authenticated','public.archive_targets_transition_batch_v1(jsonb)','EXECUTE')::text||'|'||has_function_privilege('anon','public.archive_targets_transition_batch_v1(jsonb)','EXECUTE')::text")).output, "true|false|false");
  const roleIdentity = (await psql("set role service_role; select current_user||'|'||session_user")).output.split("|");
  assert.equal(roleIdentity[0], "service_role");
  assert.notEqual(roleIdentity[1], "service_role");
  assert.equal((await psql("select exists(select 1 from pg_trigger where tgname='ig_targets_archive_transition_guard')")).output, "f");

  const firstIntent = "11111111-1111-4111-8111-111111111111";
  const availabilityBefore = (await psql("select md5(coalesce(jsonb_agg(to_jsonb(a) order by target_id)::text,'null')) from ct_target_availability_current a")).output;
  const first = JSON.parse((await psql(call(request(firstIntent)))).output.split("\n").at(-1));
  assert.equal(first.archived, 1);
  assert.equal(first.replayed, false);
  const replay = JSON.parse((await psql(call(request(firstIntent)))).output.split("\n").at(-1));
  assert.equal(replay.replayed, true);
  assert.equal((await psql(`select count(*) from ct_target_lifecycle_assessments where target_id='${TARGET}' and assessment_kind='terminal_archive'`)).output, "1");
  assert.equal((await psql("select count(*) from archive_internal.archive_transition_requests")).output, "1");
  assert.equal((await psql("select md5(coalesce(jsonb_agg(to_jsonb(a) order by target_id)::text,'null')) from ct_target_availability_current a")).output, availabilityBefore);

  const sourceTargets = [
    "10000000-0000-4000-8000-000000000020",
    "10000000-0000-4000-8000-000000000021",
    "10000000-0000-4000-8000-000000000022",
    "10000000-0000-4000-8000-000000000023",
    "10000000-0000-4000-8000-000000000024",
  ];
  await psql(`insert into ig_targets(id,account_id,status,quality_status) values
    ('${sourceTargets[0]}','${ACCOUNT}','active','eligible'),
    ('${sourceTargets[1]}','${ACCOUNT}','active','eligible'),
    ('${sourceTargets[2]}','${ACCOUNT}','active','eligible'),
    ('${sourceTargets[3]}','${ACCOUNT}','active','eligible'),
    ('${sourceTargets[4]}','${ACCOUNT}','active','eligible')`);
  const batchResult = JSON.parse((await psql(call(request(
    "10101010-1010-4010-8010-101010101010",
    sourceTargets.slice(0, 2),
  )))).output.split("\n").at(-1));
  assert.equal(batchResult.archived, 2);
  for (const [index, source] of ["private_streak", "verification_ineligible", "low_fbr"].entries()) {
    const result = JSON.parse((await psql(call(request(
      `20202020-2020-4020-8020-20202020202${index}`,
      [sourceTargets[index + 2]],
      {
        source,
        reason: source === "private_streak" ? "consecutive_private_opened_profiles" : `${source}_confirmed`,
        actor_type: "system",
      },
    )))).output.split("\n").at(-1));
    assert.equal(result.archived, 1);
  }
  assert.equal((await psql(`select count(*) from ct_target_lifecycle_assessments where target_id=any(array[${sourceTargets.map((id) => `'${id}'::uuid`).join(",")}]) and assessment_kind='terminal_archive'`)).output, "5");

  const invalidOrdinaryAssessment = await psql(`insert into ct_target_lifecycle_assessments(
    tenant_id,account_id,target_id,assessment_key,status,unique_profiles_evaluated,
    denominator_source,denominator_version,confidence,assessed_at
  ) values ('${TENANT}','${ACCOUNT}','${sourceTargets[0]}','invalid-evaluation','active',null,null,null,'unknown',now())`, { reject: false });
  assert.equal(invalidOrdinaryAssessment.ok, false);
  assert.match(invalidOrdinaryAssessment.output, /ct_target_lifecycle_assessments_typed_payload_check/);

  const unauthorizedFacade = await adminProbe(`set role authenticated; select public.archive_targets_transition_batch_v1('{}'::jsonb)`, { reject: false });
  assert.equal(unauthorizedFacade.ok, false);
  assert.match(unauthorizedFacade.output, /permission denied for function archive_targets_transition_batch_v1/);
  const directHistoryMutation = await adminProbe(`set role authenticated; update public.ct_target_lifecycle_assessments set status='active'`, { reject: false });
  assert.equal(directHistoryMutation.ok, false);
  assert.match(directHistoryMutation.output, /permission denied|row-level security/);
  for (const operation of ["delete from public.ct_target_lifecycle_assessments", "truncate public.ct_target_lifecycle_assessments"]) {
    const denied = await adminProbe(`set role authenticated; ${operation}`, { reject: false });
    assert.equal(denied.ok, false);
    assert.match(denied.output, /permission denied|row-level security/);
  }
  const receiptDisclosure = await psql(`set role service_role; select result from archive_internal.archive_transition_requests limit 1`, { reject: false });
  assert.equal(receiptDisclosure.ok, false);
  assert.match(receiptDisclosure.output, /permission denied for schema archive_internal/);

  const conflict = await psql(call(request(firstIntent, [TARGET], { reason: "changed_reason" })), { reject: false });
  assert.equal(conflict.ok, false);
  assert.match(conflict.output, /archive_transition_replay_conflict/);

  await psql(`update ig_targets set status='active',archived_at=null,archive_reason=null where id='${TARGET}'`);
  const oldRetry = JSON.parse((await psql(call(request(firstIntent)))).output.split("\n").at(-1));
  assert.equal(oldRetry.replayed, true);
  assert.equal((await psql(`select status from ig_targets where id='${TARGET}'`)).output, "active");
  const secondIntent = "22222222-2222-4222-8222-222222222222";
  assert.equal(JSON.parse((await psql(call(request(secondIntent)))).output.split("\n").at(-1)).archived, 1);

  const wrongScope = await psql(call(request("33333333-3333-4333-8333-333333333333", [OTHER_TARGET])), { reject: false });
  assert.equal(wrongScope.ok, false);
  assert.match(wrongScope.output, /archive_transition_target_scope_rejected/);
  const mixedLocalTarget = "10000000-0000-4000-8000-000000000025";
  await psql(`insert into ig_targets(id,account_id,status,quality_status) values ('${mixedLocalTarget}','${ACCOUNT}','active','eligible')`);
  const mixedScope = await psql(call(request(
    "34343434-3434-4434-8434-343434343434",
    [mixedLocalTarget, OTHER_TARGET],
  )), { reject: false });
  assert.equal(mixedScope.ok, false);
  assert.match(mixedScope.output, /archive_transition_target_scope_rejected/);
  assert.equal((await psql(`select status||'|'||(archived_at is null)::text from ig_targets where id='${mixedLocalTarget}'`)).output, "active|true");
  const wrongTenant = await psql(call(request(firstIntent, [TARGET], { tenant_id: "20000000-0000-4000-8000-000000000001" })), { reject: false });
  assert.equal(wrongTenant.ok, false);
  assert.match(wrongTenant.output, /archive_transition_scope_rejected/);

  await psql(`update ig_targets set status='active',archived_at=null,archive_reason=null where id='${TARGET_2}'; delete from ct_target_lifecycle_current where target_id='${TARGET_2}'; delete from ct_target_lifecycle_assessments where target_id='${TARGET_2}';`);
  const concurrentA = request("44444444-4444-4444-8444-444444444444", [TARGET_2]);
  const concurrentB = request("55555555-5555-4555-8555-555555555555", [TARGET_2]);
  const concurrent = await Promise.all([psql(call(concurrentA)), psql(call(concurrentB))]);
  const outcomes = concurrent.map((item) => JSON.parse(item.output.split("\n").at(-1)).items[0].outcome).sort();
  assert.deepEqual(outcomes, ["already_archived", "archived"]);
  assert.equal((await psql(`select count(*) from archive_internal.archive_transition_requests where archive_intent_id in ('${concurrentA.archive_intent_id}','${concurrentB.archive_intent_id}') and result is not null`)).output, "2");

  await psql(String.raw`
    create function public.fail_archive_stage_v1() returns trigger language plpgsql as $$
    begin if current_setting('test.archive_fail_stage',true)=tg_argv[0] then raise exception 'injected_%',tg_argv[0]; end if; return new; end $$;
    create trigger fail_target before update on ig_targets for each row execute function fail_archive_stage_v1('target_update');
    create trigger fail_assessment before insert on ct_target_lifecycle_assessments for each row execute function fail_archive_stage_v1('assessment_insert');
    create trigger fail_current before insert or update on ct_target_lifecycle_current for each row execute function fail_archive_stage_v1('current_write');
    create trigger fail_receipt before update on archive_internal.archive_transition_requests for each row execute function fail_archive_stage_v1('receipt_finalize');
  `);
  for (const [index, stage] of ["target_update", "assessment_insert", "current_write", "receipt_finalize"].entries()) {
    await psql(`update ig_targets set status='active',archived_at=null,archive_reason=null where id='${TARGET_2}'; delete from ct_target_lifecycle_current where target_id='${TARGET_2}'; delete from ct_target_lifecycle_assessments where target_id='${TARGET_2}';`);
    const intent = `66666666-6666-4666-8666-66666666666${index}`;
    const failed = await psql(`set test.archive_fail_stage='${stage}'; ${call(request(intent, [TARGET_2]))}`, { reject: false });
    assert.equal(failed.ok, false);
    assert.match(failed.output, new RegExp(`injected_${stage}`));
    assert.equal((await psql(`select status from ig_targets where id='${TARGET_2}'`)).output, "active");
    assert.equal((await psql(`select count(*) from ct_target_lifecycle_assessments where target_id='${TARGET_2}'`)).output, "0");
    assert.equal((await psql(`select count(*) from archive_internal.archive_transition_requests where archive_intent_id='${intent}'`)).output, "0");
  }

  await psql(`update ig_targets set status='active',archived_at=null,archive_reason=null where id='${TARGET_2}'; delete from ct_target_lifecycle_current where target_id='${TARGET_2}'; delete from ct_target_lifecycle_assessments where target_id='${TARGET_2}';`);
  const unavailableIntent = "77777777-7777-4777-8777-777777777777";
  const unavailableRequest = request(unavailableIntent, [TARGET_2], {
    source: "verification_not_found",
    reason: "account_not_found",
    actor_type: "system",
    target_patch: { verification_status: "rejected", quality_status: "rejected" },
  });
  const staleProof = await psql(call(unavailableRequest), { reject: false });
  assert.equal(staleProof.ok, false);
  assert.match(staleProof.output, /archive_transition_not_found_proof_stale/);
  await psql(`insert into ct_target_availability_current(tenant_id,account_id,target_id,availability_status,confidence,identity_status,confirmed_at,valid_until) values ('${TENANT}','${ACCOUNT}','${TARGET_2}','unavailable_confirmed','high','identity_confirmed',now(),now()+interval '1 hour')`);
  assert.equal(JSON.parse((await psql(call(unavailableRequest))).output.split("\n").at(-1)).archived, 1);
  assert.equal((await psql(`select verification_status||'|'||quality_status from ig_targets where id='${TARGET_2}'`)).output, "rejected|rejected");

  const projectorTarget = "10000000-0000-4000-8000-000000000030";
  await psql(`insert into ig_targets(id,account_id,status,quality_status) values ('${projectorTarget}','${ACCOUNT}','active','eligible')`);
  const projectorBundle = JSON.stringify({ tenant_id: TENANT, account_id: ACCOUNT, target_id: projectorTarget });
  assert.match((await psql(`set role service_role; set request.jwt.claim.role='service_role'; select public.persist_target_lifecycle_shadow_v1($bundle$${projectorBundle}$bundle$::jsonb,null)::text`)).output, /processed/);
  assert.equal(JSON.parse((await psql(call(request(
    "30303030-3030-4030-8030-303030303030",
    [projectorTarget],
  )))).output.split("\n").at(-1)).archived, 1);
  const projectorAfterArchive = (await psql(`set role service_role; set request.jwt.claim.role='service_role'; select public.persist_target_lifecycle_shadow_v1($bundle$${projectorBundle}$bundle$::jsonb,null)::text`)).output;
  assert.match(projectorAfterArchive, /out_of_order_skipped/);
  const recomputeAfterArchive = (await psql(`set role service_role; set request.jwt.claim.role='service_role'; select public.ct_recompute_target_lifecycle_v1('${ACCOUNT}','${projectorTarget}',10,'test','v1','high','archived-projector-check',now())::text`)).output;
  assert.match(recomputeAfterArchive, /target_archived/);

  const onboardingTarget = "10000000-0000-4000-8000-000000000031";
  await psql(`insert into ig_targets(id,account_id,status,quality_status) values ('${onboardingTarget}','${ACCOUNT}','active','eligible')`);
  const onboarding = JSON.parse((await psql(`set role service_role; set request.jwt.claim.role='service_role'; select public.rollback_test_instagram_onboarding_v1(
    '${ACCOUNT}','${TENANT}','40404040-4040-4040-8040-404040404040','test-user',
    '50505050-5050-4050-8050-505050505050','test','test_onboarding_rollback','request-rls',
    'idempotency-rls',false
  )::text`)).output.split("\n").at(-1));
  assert.equal(onboarding.ok, true);
  assert.equal((await psql(`select status from ig_targets where id='${onboardingTarget}'`)).output, "archived");

  const historicalTarget = "542b758f-004e-4e88-a381-dd441b60ad5e";
  const reconciliationIntent = "88888888-8888-4888-8888-888888888888";
  const reconciliationRequest = {
    contract: "archive_transition_reconciliation_v1",
    tenant_id: TENANT,
    account_id: ACCOUNT,
    target_id: historicalTarget,
    archive_intent_id: reconciliationIntent,
    evidence_reference: "approved-three-target-reconciliation",
  };
  const reconcileSql = `set request.jwt.claim.role='service_role'; select public.reconcile_archived_target_lifecycle_v1($request$${JSON.stringify(reconciliationRequest)}$request$::jsonb)::text`;
  const availabilityBeforeReconciliation = (await psql("select md5(coalesce(jsonb_agg(to_jsonb(a) order by target_id)::text,'null')) from ct_target_availability_current a")).output;
  const reconciliation = JSON.parse((await psql(reconcileSql)).output.split("\n").at(-1));
  assert.equal(reconciliation.outcome, "reconciled");
  assert.equal(reconciliation.mutation_kind, "BACKFILL_RECONCILIATION");
  assert.equal((await psql(`select status from ct_target_lifecycle_current where target_id='${historicalTarget}'`)).output, "archived");
  assert.equal((await psql(`select (assessed_at=(select archived_at from ig_targets where id='${historicalTarget}'))::text||'|'||(archived_at=(select archived_at from ig_targets where id='${historicalTarget}'))::text||'|'||transition_source from ct_target_lifecycle_assessments where target_id='${historicalTarget}' and assessment_kind='terminal_archive'`)).output, "true|true|reconciliation");
  assert.equal((await psql("select md5(coalesce(jsonb_agg(to_jsonb(a) order by target_id)::text,'null')) from ct_target_availability_current a")).output, availabilityBeforeReconciliation);
  assert.equal(JSON.parse((await psql(reconcileSql)).output.split("\n").at(-1)).replayed, true);
  const unapprovedReconciliation = { ...reconciliationRequest, target_id: TARGET, archive_intent_id: "99999999-9999-4999-8999-999999999999" };
  const rejectedReconciliation = await psql(`set request.jwt.claim.role='service_role'; select public.reconcile_archived_target_lifecycle_v1($request$${JSON.stringify(unapprovedReconciliation)}$request$::jsonb)`, { reject: false });
  assert.equal(rejectedReconciliation.ok, false);
  assert.match(rejectedReconciliation.output, /archive_reconciliation_request_rejected/);

  await file("supabase/migrations/20260910215408_archive_transition_convergence_phase_a.sql");
  await file("supabase/migrations/20260910232624_archive_transition_postgres_owner_guard_off_v1.sql");
  assert.equal((await psql("select count(*) from pg_roles where rolname like 'archive_transition_%writer%'")).output, "0");
});
