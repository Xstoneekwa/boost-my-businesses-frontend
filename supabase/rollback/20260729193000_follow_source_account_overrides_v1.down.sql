-- Emergency rollback for 20260729193000_follow_source_account_overrides_v1.
-- This restores the previous reconciler and the package-exact source rotation
-- readiness clauses. It does not update account rows.

begin;

drop function public.reconcile_account_package_runtime_contract(uuid, text);

alter function public.reconcile_package_runtime_contract_pre_source_override_v1(uuid, text)
  rename to reconcile_account_package_runtime_contract;

revoke all on function public.reconcile_account_package_runtime_contract(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_account_package_runtime_contract(uuid, text)
  to service_role;

do $rollback$
declare
  v_current text;
  v_restored text;
begin
  select pg_get_functiondef(
    'public.account_package_runtime_contract_status(uuid)'::regprocedure
  ) into v_current;

  v_restored := replace(
    v_current,
    'or v_sources.max_follows_per_target_per_run > v_runtime.max_follows_per_target_per_run',
    'or v_sources.max_follows_per_target_per_run is distinct from v_runtime.max_follows_per_target_per_run'
  );
  v_restored := replace(
    v_restored,
    'or v_sources.max_targets_per_run > v_runtime.max_targets_per_run',
    'or v_sources.max_targets_per_run is distinct from v_runtime.max_targets_per_run'
  );
  v_restored := replace(
    v_restored,
    $$'max_follows_per_target_per_run', jsonb_build_object('db', v_sources.max_follows_per_target_per_run, 'package', v_runtime.max_follows_per_target_per_run, 'effective', v_sources.max_follows_per_target_per_run, 'rule', 'positive_account_override_lte_package')$$,
    $$'max_follows_per_target_per_run', jsonb_build_object('db', v_sources.max_follows_per_target_per_run, 'package', v_runtime.max_follows_per_target_per_run, 'effective', v_sources.max_follows_per_target_per_run, 'rule', 'package_exact')$$
  );
  v_restored := replace(
    v_restored,
    $$'max_targets_per_run', jsonb_build_object('db', v_sources.max_targets_per_run, 'package', v_runtime.max_targets_per_run, 'effective', v_sources.max_targets_per_run, 'rule', 'positive_account_override_lte_package')$$,
    $$'max_targets_per_run', jsonb_build_object('db', v_sources.max_targets_per_run, 'package', v_runtime.max_targets_per_run, 'effective', v_sources.max_targets_per_run, 'rule', 'package_exact')$$
  );

  if v_restored = v_current
     or position('max_follows_per_target_per_run > v_runtime.max_follows_per_target_per_run' in v_restored) > 0
     or position('max_targets_per_run > v_runtime.max_targets_per_run' in v_restored) > 0 then
    raise exception 'follow_source_override_rollback_definition_mismatch';
  end if;

  execute v_restored;
end;
$rollback$;

revoke all on function public.account_package_runtime_contract_status(uuid)
  from public, anon, authenticated;
grant execute on function public.account_package_runtime_contract_status(uuid)
  to service_role;

commit;
