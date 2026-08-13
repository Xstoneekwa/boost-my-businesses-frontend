begin;

drop function if exists public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text);

alter function public.confirm_instagram_login_operator_pre_post_onboarding_ct_contract_v1(uuid,uuid,uuid,uuid,text,text,text)
  rename to confirm_instagram_login_operator_v1;

revoke all on function public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text)
  to service_role;

drop function if exists public.reconcile_connected_instagram_growth_readiness_v1(uuid,text);

alter function public.reconcile_connected_instagram_growth_readiness_pre_post_onboarding_ct_contract_v1(uuid,text)
  rename to reconcile_connected_instagram_growth_readiness_v1;

revoke all on function public.reconcile_connected_instagram_growth_readiness_v1(uuid,text)
  from public, anon, authenticated;
grant execute on function public.reconcile_connected_instagram_growth_readiness_v1(uuid,text)
  to service_role;

commit;
