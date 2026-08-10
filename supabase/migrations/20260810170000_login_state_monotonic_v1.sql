begin;

-- Login identity is an ordered state machine. Social collection, readiness
-- refreshes and delayed pre-login observations are not allowed to invalidate a
-- newer exact own-profile proof.
alter table public.client_instagram_accounts
  add column if not exists login_state_source_at timestamptz,
  add column if not exists login_state_version bigint not null default 0,
  add column if not exists login_state_invalidation_reason text;

update public.client_instagram_accounts
set login_state_source_at = coalesce(login_identity_verified_at, updated_at, created_at, now()),
    login_state_version = greatest(login_state_version, 1)
where login_state_source_at is null
   or login_state_version < 1;

alter table public.client_instagram_accounts
  alter column login_state_source_at set default now(),
  alter column login_state_source_at set not null,
  drop constraint if exists client_instagram_accounts_login_state_version_check,
  add constraint client_instagram_accounts_login_state_version_check
    check (login_state_version >= 1),
  drop constraint if exists client_instagram_accounts_login_state_invalidation_reason_check,
  add constraint client_instagram_accounts_login_state_invalidation_reason_check
    check (
      login_state_invalidation_reason is null
      or login_state_invalidation_reason in (
        'explicit_logout',
        'identity_mismatch',
        'auth_session_invalidated',
        'instagram_login_screen_confirmed',
        'credential_invalidation',
        'account_disabled',
        'security_challenge_requires_login',
        'other_explicit_canonical_invalidation'
      )
    );

comment on column public.client_instagram_accounts.login_state_source_at is
  'Canonical observation time for the current ordered login state. Older events cannot overwrite it.';
comment on column public.client_instagram_accounts.login_state_version is
  'Monotonic per-account login state generation incremented on verified success or explicit invalidation.';
comment on column public.client_instagram_accounts.login_state_invalidation_reason is
  'Approved canonical reason that invalidated a previously verified login; social metrics are never valid reasons.';

create or replace function public.normalize_instagram_login_invalidation_reason_v1(p_reason text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case lower(trim(coalesce(p_reason, '')))
    when 'explicit_logout' then 'explicit_logout'
    when 'logout_confirmed' then 'explicit_logout'
    when 'account_identity_mismatch' then 'identity_mismatch'
    when 'active_instagram_account_mismatch' then 'identity_mismatch'
    when 'identity_mismatch' then 'identity_mismatch'
    when 'auth_session_invalidated' then 'auth_session_invalidated'
    when 'session_expired' then 'instagram_login_screen_confirmed'
    when 'login_screen_signal' then 'instagram_login_screen_confirmed'
    when 'login_screen_detected' then 'instagram_login_screen_confirmed'
    when 'instagram_login_screen_confirmed' then 'instagram_login_screen_confirmed'
    when 'credentials_invalid' then 'credential_invalidation'
    when 'credential_invalidation' then 'credential_invalidation'
    when 'login_failed' then 'credential_invalidation'
    when 'account_disabled' then 'account_disabled'
    when 'two_factor_required' then 'security_challenge_requires_login'
    when 'checkpoint_required' then 'security_challenge_requires_login'
    when 'verification_code_required' then 'security_challenge_requires_login'
    when 'verification_pending' then 'security_challenge_requires_login'
    when 'unsupported_post_submit_challenge' then 'security_challenge_requires_login'
    when 'security_challenge_requires_login' then 'security_challenge_requires_login'
    when 'other_explicit_canonical_invalidation' then 'other_explicit_canonical_invalidation'
    else null
  end;
$$;

create or replace function public.enforce_client_instagram_login_monotonic_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_verified_connected boolean;
  v_downgrade_requested boolean;
  v_old_ordering_at timestamptz;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- A fresh exact proof starts a new canonical generation. The existing
  -- identity trigger separately verifies username/profile proof correctness.
  if new.login_identity_proof_status = 'verified'
     and new.login_identity_profile_opened is true
     and new.login_identity_username_match is true
     and new.login_identity_verified_at is not null
     and (
       old.login_identity_proof_status is distinct from 'verified'
       or old.login_identity_verified_at is distinct from new.login_identity_verified_at
     )
  then
    new.login_state_source_at := greatest(
      new.login_identity_verified_at,
      coalesce(new.login_state_source_at, new.login_identity_verified_at)
    );
    new.login_state_version := greatest(
      coalesce(new.login_state_version, 0),
      coalesce(old.login_state_version, 0) + 1
    );
    new.login_state_invalidation_reason := null;
  end if;

  v_was_verified_connected :=
    old.login_identity_proof_status = 'verified'
    and old.login_identity_profile_opened is true
    and old.login_identity_username_match is true
    and old.login_identity_verified_at is not null
    and lower(coalesce(old.login_status, '')) = 'connected';

  v_downgrade_requested := v_was_verified_connected and (
    lower(coalesce(new.login_status, '')) <> 'connected'
    or lower(coalesce(new.provisioning_status, '')) <> 'ready'
    or lower(coalesce(new.onboarding_status, '')) <> 'ready'
    or new.login_identity_proof_status <> 'verified'
    or new.login_identity_profile_opened is distinct from true
    or new.login_identity_username_match is distinct from true
  );

  if not v_downgrade_requested then
    return new;
  end if;

  v_old_ordering_at := greatest(
    old.login_identity_verified_at,
    coalesce(old.login_state_source_at, old.login_identity_verified_at)
  );

  if public.normalize_instagram_login_invalidation_reason_v1(new.login_state_invalidation_reason) is null
     or new.login_state_source_at is null
     or new.login_state_source_at <= v_old_ordering_at
     or new.login_state_version <= old.login_state_version
  then
    raise exception 'login_state_downgrade_requires_newer_canonical_invalidation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_client_instagram_login_monotonic_v1
  on public.client_instagram_accounts;
create trigger enforce_client_instagram_login_monotonic_v1
before update of
  login_status,
  provisioning_status,
  onboarding_status,
  login_identity_proof_status,
  login_identity_profile_opened,
  login_identity_username_match,
  login_identity_verified_at,
  login_state_source_at,
  login_state_version,
  login_state_invalidation_reason
on public.client_instagram_accounts
for each row
execute function public.enforce_client_instagram_login_monotonic_v1();

create or replace function public.invalidate_client_instagram_login_v1(
  p_account_id uuid,
  p_invalidation_reason text,
  p_source_timestamp timestamptz,
  p_login_status text default null,
  p_provisioning_status text default null,
  p_onboarding_status text default null,
  p_reauth_required boolean default null,
  p_reauth_reason text default null,
  p_actor_type text default 'worker',
  p_external_request_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.client_instagram_accounts%rowtype;
  v_reason text := public.normalize_instagram_login_invalidation_reason_v1(p_invalidation_reason);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_actor_type text := lower(coalesce(nullif(trim(p_actor_type), ''), 'worker'));
  v_source_run_id uuid;
  v_sync_result jsonb;
  v_new_login_status text;
  v_new_provisioning_status text;
  v_new_onboarding_status text;
begin
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'canonical_login_invalidation_reason_required' using errcode = '22023';
  end if;
  if p_source_timestamp is null then
    raise exception 'login_invalidation_source_timestamp_required' using errcode = '22023';
  end if;
  if p_source_timestamp > now() + interval '5 minutes' then
    raise exception 'login_invalidation_source_timestamp_in_future' using errcode = '22023';
  end if;
  if v_actor_type not in ('admin', 'assistant', 'ops', 'internal', 'system', 'worker', 'provisioner') then
    raise exception 'invalid_status_actor_type' using errcode = '22023';
  end if;
  if jsonb_typeof(v_metadata) is distinct from 'object' then
    raise exception 'metadata must be a json object' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(v_metadata) as k(key)
    where lower(k.key) in (
      'password', 'secret', 'secret_ref', 'raw_secret', 'token', 'cookie',
      'webhook', 'webhook_url', 'vault', 'service_role', 'authorization',
      'bearer', 'raw_xml', 'xml', 'screenshot', 'device_udid', 'adb_serial'
    )
  ) then
    raise exception 'metadata contains a forbidden key' using errcode = '22023';
  end if;

  select * into v_account
  from public.client_instagram_accounts
  where account_id = p_account_id
    and active = true
  for update;

  if v_account.id is null then
    raise exception 'client_instagram_account_not_found' using errcode = 'P0002';
  end if;

  if p_source_timestamp <= greatest(
    coalesce(v_account.login_state_source_at, '-infinity'::timestamptz),
    coalesce(v_account.login_identity_verified_at, '-infinity'::timestamptz)
  ) then
    return jsonb_build_object(
      'ok', true,
      'applied', false,
      'reason', 'newer_verified_login_preserved',
      'account_id', p_account_id,
      'login_status', v_account.login_status,
      'provisioning_status', v_account.provisioning_status,
      'onboarding_status', v_account.onboarding_status,
      'login_state_source_at', v_account.login_state_source_at,
      'login_state_version', v_account.login_state_version
    );
  end if;

  if coalesce(v_metadata ->> 'run_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_source_run_id := (v_metadata ->> 'run_id')::uuid;
  end if;

  v_new_login_status := coalesce(nullif(trim(p_login_status), ''), 'logged_out');
  v_new_provisioning_status := coalesce(nullif(trim(p_provisioning_status), ''), 'login_verification_pending');
  v_new_onboarding_status := coalesce(nullif(trim(p_onboarding_status), ''), 'credentials_submitted');

  update public.client_instagram_accounts
  set login_status = v_new_login_status,
      provisioning_status = v_new_provisioning_status,
      onboarding_status = v_new_onboarding_status,
      login_identity_proof_status = 'failed',
      login_identity_detected_username = nullif(
        public.normalize_instagram_identity_username_v1(v_metadata ->> 'actual_logged_in_username'),
        ''
      ),
      login_identity_profile_opened = coalesce((v_metadata ->> 'profile_opened')::boolean, false),
      login_identity_username_match = false,
      login_identity_source_run_id = coalesce(v_source_run_id, login_identity_source_run_id),
      login_identity_failure_reason = v_reason,
      login_state_source_at = p_source_timestamp,
      login_state_version = login_state_version + 1,
      login_state_invalidation_reason = v_reason,
      updated_at = now()
  where account_id = p_account_id;

  if p_reauth_required is not null then
    update public.account_credentials
    set reauth_required = p_reauth_required,
        reauth_reason = case
          when p_reauth_required then coalesce(nullif(trim(p_reauth_reason), ''), v_reason)
          else null
        end,
        updated_at = now()
    where account_id = p_account_id
      and provider = 'instagram'
      and status = 'active';
  end if;

  v_sync_result := public.sync_account_dashboard_actions_from_status(
    p_account_id := p_account_id,
    p_actor_type := v_actor_type,
    p_reason := v_reason,
    p_external_request_id := p_external_request_id,
    p_metadata := v_metadata || jsonb_build_object(
      'canonical_login_invalidation_reason', v_reason,
      'source_timestamp', p_source_timestamp
    )
  );

  return v_sync_result || jsonb_build_object(
    'ok', true,
    'applied', true,
    'reason', v_reason,
    'account_id', p_account_id,
    'login_status', v_new_login_status,
    'provisioning_status', v_new_provisioning_status,
    'onboarding_status', v_new_onboarding_status,
    'login_state_source_at', p_source_timestamp,
    'login_state_version', v_account.login_state_version + 1
  );
end;
$$;

revoke execute on function
  public.normalize_instagram_login_invalidation_reason_v1(text),
  public.enforce_client_instagram_login_monotonic_v1(),
  public.invalidate_client_instagram_login_v1(uuid, text, timestamptz, text, text, text, boolean, text, text, text, jsonb)
from public, anon, authenticated;

grant execute on function
  public.invalidate_client_instagram_login_v1(uuid, text, timestamptz, text, text, text, boolean, text, text, text, jsonb)
to service_role;

commit;
