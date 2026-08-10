begin;

-- Existing rows were backfilled to generation 1 when the monotonic login-state
-- contract was introduced, but the column default remained 0. Canonical
-- onboarding omits this internal field, so every future account link failed
-- the login_state_version >= 1 constraint.
alter table public.client_instagram_accounts
  alter column login_state_version set default 1;

comment on column public.client_instagram_accounts.login_state_version is
  'Monotonic per-account login state generation. New account links start at generation 1; verified success or explicit canonical invalidation advances it.';

commit;
