-- Supabase project defaults grant new functions to API roles. Keep onboarding
-- orchestration server-only even when those defaults are present.

revoke all on function public.begin_client_instagram_onboarding(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb
) from public, anon, authenticated;

revoke all on function public.advance_client_instagram_onboarding(
  uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;

revoke all on function public.restart_client_instagram_onboarding(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;

revoke all on function public.expire_client_instagram_onboarding_sessions(
  uuid, uuid
) from public, anon, authenticated;

grant execute on function public.begin_client_instagram_onboarding(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb
) to service_role;

grant execute on function public.advance_client_instagram_onboarding(
  uuid, uuid, uuid, text, jsonb
) to service_role;

grant execute on function public.restart_client_instagram_onboarding(
  uuid, uuid, uuid, uuid
) to service_role;

grant execute on function public.expire_client_instagram_onboarding_sessions(
  uuid, uuid
) to service_role;
