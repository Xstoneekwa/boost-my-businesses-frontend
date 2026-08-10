begin;

drop trigger if exists enforce_client_instagram_login_monotonic_v1
  on public.client_instagram_accounts;
drop function if exists public.invalidate_client_instagram_login_v1(uuid, text, timestamptz, text, text, text, boolean, text, text, text, jsonb);
drop function if exists public.enforce_client_instagram_login_monotonic_v1();
drop function if exists public.normalize_instagram_login_invalidation_reason_v1(text);

alter table public.client_instagram_accounts
  drop constraint if exists client_instagram_accounts_login_state_version_check,
  drop constraint if exists client_instagram_accounts_login_state_invalidation_reason_check,
  drop column if exists login_state_source_at,
  drop column if exists login_state_version,
  drop column if exists login_state_invalidation_reason;

commit;
