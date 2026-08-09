drop function if exists public.set_account_unfollow_limit_override_v1(uuid, integer, integer, text, text, uuid, text);
drop function if exists public.reconcile_account_package_runtime_contract(uuid, text);
alter function public.reconcile_account_package_runtime_contract_follow_provenance_v1(uuid, text)
  rename to reconcile_account_package_runtime_contract;
revoke all on function public.reconcile_account_package_runtime_contract(uuid, text) from public, anon, authenticated;
grant execute on function public.reconcile_account_package_runtime_contract(uuid, text) to service_role;
drop function if exists public.apply_account_unfollow_limit_provenance_v1(uuid);
drop table if exists public.ig_account_unfollow_limit_overrides;
