drop function if exists public.expire_instagram_account_onboarding_sessions_v1(uuid, text, uuid, text);
drop function if exists public.restart_instagram_account_onboarding_v1(uuid, uuid, text, uuid, text, uuid);
drop function if exists public.save_instagram_account_onboarding_protection_lists_v1(uuid, uuid, text, uuid, text, text, text[], text[], bigint, bigint, text, text, text, text);
drop function if exists public.advance_instagram_account_onboarding_v1(uuid, uuid, text, uuid, text, text, jsonb);
drop function if exists public.begin_instagram_account_onboarding_v1(uuid, text, uuid, text, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb);
drop function if exists public.authorize_instagram_account_onboarding_actor_v1(uuid, text, uuid, text);

alter table public.client_instagram_onboarding_sessions
  drop column if exists source_context,
  drop column if exists initiated_by_actor_id,
  drop column if exists source_surface,
  drop column if exists actor_type;
