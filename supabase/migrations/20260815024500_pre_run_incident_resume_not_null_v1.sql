-- Forward-only correction for installations that already received
-- pre_run_incident_resume_authorization_v1. The target column is NOT NULL;
-- preserve the existing function verbatim and replace only the invalid value.

do $migration$
declare
  v_definition text;
  v_patched_definition text;
begin
  select pg_get_functiondef(
    'public.reconcile_resolved_pre_run_incident_authorizations_v1()'::regprocedure
  ) into v_definition;

  if strpos(v_definition, 'restart_block_reason = null') = 0 then
    raise exception 'expected pre-run reconciliation definition was not found';
  end if;

  v_patched_definition := replace(
    v_definition,
    'restart_block_reason = null',
    'restart_block_reason = '''''
  );
  execute v_patched_definition;
end
$migration$;

comment on function public.reconcile_resolved_pre_run_incident_authorizations_v1() is
  'Creates one new natural-tick authorization for a resolved non-security incident whose exact prior authorization was consumed by an Auto Restart request that failed before ig_run creation; historical keys and authorizations are never reused. Uses the required non-null empty restart blocker when restoring eligibility.';
