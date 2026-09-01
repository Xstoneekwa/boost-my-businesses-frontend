\set ON_ERROR_STOP on

do $verify$
declare
  v_expected text;
  v_actual text;
begin
  if to_regprocedure('public.canonical_active_blocking_incidents_v1(uuid[])') is not null then
    raise exception 'canonical function survived failed migration';
  end if;

  select definition_hash into v_expected
  from public.restriction_drift_snapshot where function_name = 'admission';
  select md5(pg_get_functiondef(
    'public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)'::regprocedure
  )) into v_actual;
  if v_actual is distinct from v_expected then
    raise exception 'admission changed despite failed migration';
  end if;

  select definition_hash into v_expected
  from public.restriction_drift_snapshot where function_name = 'recovery';
  select md5(pg_get_functiondef(
    'public.certify_zero_work_and_enqueue_recovery_v1(uuid,uuid,text,integer)'::regprocedure
  )) into v_actual;
  if v_actual is distinct from v_expected then
    raise exception 'recovery changed despite failed migration';
  end if;
end
$verify$;

select jsonb_build_object(
  'expected_failure', true,
  'canonical_absent', to_regprocedure('public.canonical_active_blocking_incidents_v1(uuid[])') is null,
  'admission_unchanged', (
    select definition_hash = md5(pg_get_functiondef(
      'public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)'::regprocedure
    )) from public.restriction_drift_snapshot where function_name = 'admission'
  ),
  'recovery_unchanged', (
    select definition_hash = md5(pg_get_functiondef(
      'public.certify_zero_work_and_enqueue_recovery_v1(uuid,uuid,text,integer)'::regprocedure
    )) from public.restriction_drift_snapshot where function_name = 'recovery'
  )
) as drift_fail_closed_evidence;
