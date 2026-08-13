begin;

drop trigger if exists login_blocker_terminal_growth_readiness_v1
  on public.account_dashboard_actions;
drop trigger if exists login_request_terminal_growth_readiness_v1
  on public.account_run_requests;
drop trigger if exists client_instagram_account_growth_readiness_v1
  on public.client_instagram_accounts;

drop function if exists public.trigger_connected_instagram_growth_readiness_v1();
drop function if exists public.reconcile_connected_instagram_growth_readiness_v1(uuid,text);

drop function if exists public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text);
alter function public.confirm_instagram_login_operator_pre_target_minimum_v1(uuid,uuid,uuid,uuid,text,text,text)
  rename to confirm_instagram_login_operator_v1;

revoke all on function public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text)
  to service_role;

commit;
