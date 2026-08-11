begin;

revoke all on function public.reset_client_instagram_login_to_preconnect_v1(uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
drop function if exists public.reset_client_instagram_login_to_preconnect_v1(uuid, text, text, text, jsonb);

commit;
