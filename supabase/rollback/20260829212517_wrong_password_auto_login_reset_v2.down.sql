begin;

revoke all on function public.reset_client_instagram_auto_login_workflow_v2(uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
drop function if exists public.reset_client_instagram_auto_login_workflow_v2(uuid, text, text, text, jsonb);

commit;
