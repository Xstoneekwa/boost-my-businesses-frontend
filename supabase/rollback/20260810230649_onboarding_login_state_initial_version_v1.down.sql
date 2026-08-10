begin;

alter table public.client_instagram_accounts
  alter column login_state_version set default 0;

comment on column public.client_instagram_accounts.login_state_version is
  'Monotonic per-account login state generation incremented on verified success or explicit invalidation.';

commit;
