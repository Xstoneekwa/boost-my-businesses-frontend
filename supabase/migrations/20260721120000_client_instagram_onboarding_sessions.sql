create table if not exists public.client_instagram_onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  entitlement_id uuid not null references public.client_account_entitlements(id) on delete restrict,
  account_id uuid null references public.ig_accounts(id) on delete restrict,
  created_by uuid not null,
  idempotency_key uuid not null,
  requested_username text not null,
  package_code text not null,
  status text not null default 'creating'
    check (status in ('active', 'creating', 'completed', 'failed_retryable', 'expired', 'abandoned')),
  current_step text not null default 'connection'
    check (current_step in ('connection', 'analysis', 'targeting', 'targets', 'complete')),
  public_analysis jsonb not null default '{}'::jsonb,
  targeting_criteria jsonb not null default '{}'::jsonb,
  last_error_code text null,
  failure_reason text null,
  attempt_id uuid not null default gen_random_uuid(),
  lease_owner text null,
  lease_expires_at timestamptz null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  last_progress_at timestamptz not null default now(),
  abandoned_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, idempotency_key)
);

create unique index if not exists client_instagram_onboarding_one_active_per_entitlement_idx
  on public.client_instagram_onboarding_sessions (entitlement_id)
  where status in ('active', 'creating');

create unique index if not exists client_instagram_onboarding_one_active_per_account_idx
  on public.client_instagram_onboarding_sessions (account_id)
  where account_id is not null and status in ('active', 'creating');

create index if not exists client_instagram_onboarding_client_updated_idx
  on public.client_instagram_onboarding_sessions (client_id, updated_at desc);

alter table public.client_instagram_onboarding_sessions enable row level security;
revoke all on table public.client_instagram_onboarding_sessions from public, anon, authenticated;

comment on table public.client_instagram_onboarding_sessions is
  'Server-owned resumable client Instagram onboarding state. Never stores credentials or recovery secrets.';

create or replace function public.begin_client_instagram_onboarding(
  p_client_id uuid,
  p_actor_id uuid,
  p_entitlement_id uuid,
  p_idempotency_key uuid,
  p_attempt_id uuid,
  p_lease_owner text,
  p_requested_username text,
  p_login_email text,
  p_password text,
  p_public_analysis jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_session public.client_instagram_onboarding_sessions%rowtype;
  v_entitlement public.client_account_entitlements%rowtype;
  v_account_id uuid;
  v_client_account_id uuid;
  v_subscription_id uuid;
  v_secret_id uuid;
  v_package_code text;
  v_username text := lower(trim(coalesce(p_requested_username, '')));
  v_failure text;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'client_instagram_onboarding:idempotency:' || p_client_id::text || ':' || p_idempotency_key::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'client_instagram_onboarding:entitlement:' || p_entitlement_id::text,
    0
  ));

  if not exists (
    select 1
      from public.client_users cu
      join public.clients c on c.id = cu.client_id and c.status = 'active'
     where cu.client_id = p_client_id
       and cu.auth_user_id = p_actor_id
       and cu.status = 'active'
       and cu.role in ('owner', 'admin', 'assistant')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'client_access_denied');
  end if;
  if v_username = '' or trim(coalesce(p_password, '')) = '' then
    return jsonb_build_object('ok', false, 'reason', 'credentials_required');
  end if;
  if p_attempt_id is null or nullif(trim(coalesce(p_lease_owner, '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'attempt_lease_required');
  end if;

  select * into v_session
    from public.client_instagram_onboarding_sessions
   where client_id = p_client_id
     and idempotency_key = p_idempotency_key
   for update;

  if found then
    if v_session.entitlement_id <> p_entitlement_id then
      return jsonb_build_object('ok', false, 'reason', 'idempotency_entitlement_mismatch');
    end if;
    if v_session.status in ('active', 'completed') then
      return jsonb_build_object(
        'ok', true,
        'already_started', true,
        'session_id', v_session.id,
        'account_id', v_session.account_id,
        'status', v_session.status
      );
    end if;
    if v_session.status = 'creating'
       and v_session.lease_expires_at is not null
       and v_session.lease_expires_at > now() then
      return jsonb_build_object(
        'ok', false,
        'reason', 'creation_lease_active',
        'session_id', v_session.id,
        'status', v_session.status
      );
    end if;
    if v_session.status in ('expired', 'abandoned') then
      return jsonb_build_object('ok', false, 'reason', 'terminal_session_requires_restart');
    end if;

  end if;

  select * into v_entitlement
    from public.client_account_entitlements
   where id = p_entitlement_id
     and client_id = p_client_id
   for update;
  if not found or v_entitlement.status <> 'entitlement_reserved' then
    return jsonb_build_object('ok', false, 'reason', 'entitlement_not_reserved');
  end if;

  v_package_code := lower(trim(coalesce(v_entitlement.commercial_package_code, '')));
  if v_package_code not in ('growth', 'pro', 'premium') then
    return jsonb_build_object('ok', false, 'reason', 'entitlement_package_invalid');
  end if;

  if v_session.id is not null then
    update public.client_instagram_onboarding_sessions
       set package_code = v_package_code,
           status = 'creating',
           attempt_id = p_attempt_id,
           lease_owner = left(trim(p_lease_owner), 160),
           lease_expires_at = now() + interval '90 seconds',
           last_error_code = null,
           failure_reason = null,
           updated_at = now()
     where id = v_session.id
     returning * into v_session;
  else
    insert into public.client_instagram_onboarding_sessions (
      client_id,
      entitlement_id,
      created_by,
      idempotency_key,
      requested_username,
      package_code,
      status,
      current_step,
      attempt_id,
      lease_owner,
      lease_expires_at,
      expires_at,
      last_progress_at
    ) values (
      p_client_id,
      p_entitlement_id,
      p_actor_id,
      p_idempotency_key,
      v_username,
      v_package_code,
      'creating',
      'connection',
      p_attempt_id,
      left(trim(p_lease_owner), 160),
      now() + interval '90 seconds',
      now() + interval '7 days',
      now()
    ) returning * into v_session;
  end if;

  begin
    select cs.id into v_subscription_id
      from public.client_subscriptions cs
     where cs.client_id = p_client_id
       and cs.subscription_type = 'full_cycle'
       and cs.status = 'active'
       and (cs.ends_at is null or cs.ends_at > now())
     order by cs.starts_at desc
     limit 1
     for update;
    if v_subscription_id is null then
      raise exception 'active_subscription_required';
    end if;

    if exists (
      select 1 from public.ig_accounts a
       where lower(trim(a.username)) = v_username
    ) then
      raise exception 'username_already_linked';
    end if;

    insert into public.ig_accounts (
      username,
      display_name,
      status,
      login_method,
      avatar_url,
      followers_count,
      is_private,
      is_verified,
      username_verified_at,
      username_verification_status,
      public_profile_metadata
    ) values (
      v_username,
      coalesce(p_public_analysis->>'displayName', ''),
      'inactive',
      'credentials',
      nullif(trim(coalesce(p_public_analysis->>'avatarUrl', '')), ''),
      case when (p_public_analysis->>'followersCount') ~ '^\d+$' then (p_public_analysis->>'followersCount')::integer else null end,
      case when jsonb_typeof(p_public_analysis->'isPrivate') = 'boolean' then (p_public_analysis->>'isPrivate')::boolean else null end,
      case when jsonb_typeof(p_public_analysis->'isVerified') = 'boolean' then (p_public_analysis->>'isVerified')::boolean else null end,
      now(),
      'verified',
      jsonb_build_object(
        'source', 'client_instagram_onboarding',
        'lookup_status', coalesce(p_public_analysis->>'lookupStatus', 'found'),
        'provider_biography', nullif(trim(coalesce(p_public_analysis->>'biography', '')), '')
      )
    ) returning id into v_account_id;

    insert into public.ig_account_settings (
      account_id, username, display_name, email, password, account_status,
      app_package, dry_run_enabled, follow_enabled, like_enabled,
      welcome_dm_enabled, cold_dm_enabled, unfollow_enabled
    ) values (
      v_account_id, v_username, coalesce(p_public_analysis->>'displayName', ''),
      lower(trim(coalesce(p_login_email, ''))), '', 'inactive',
      'com.instagram.android', true, false, false, false, false, false
    );
    insert into public.ig_account_filters (account_id) values (v_account_id);
    insert into public.ig_account_follow_settings (account_id) values (v_account_id);
    insert into public.ig_account_unfollow_settings (account_id, unfollow_enabled)
      values (v_account_id, false);
    insert into public.ig_account_dm_settings (account_id, welcome_enabled, outreach_enabled)
      values (v_account_id, false, false);

    v_secret_id := public.create_instagram_credentials_vault_secret(
      p_password,
      'instagram:' || v_account_id::text || ':v1',
      'Client onboarding Instagram credentials'
    );
    perform public.rotate_instagram_account_credentials(
      v_account_id,
      p_client_id,
      v_username,
      'supabase_vault://' || v_secret_id::text,
      'supabase_vault',
      1,
      'submit',
      p_attempt_id::text,
      v_session.id::text,
      p_actor_id,
      'client_dashboard'
    );

    insert into public.client_instagram_accounts (
      client_id, account_id, label, onboarding_status, provisioning_status, login_status
    ) values (
      p_client_id, v_account_id, 'Client onboarding - ' || v_username,
      'pending', 'not_started', 'unknown'
    ) returning id into v_client_account_id;

    insert into public.account_commercial_packages (
      account_id, package_code, status, source, metadata_safe
    ) values (
      v_account_id, v_package_code, 'active', 'client_onboarding',
      jsonb_build_object(
        'source', 'client_instagram_onboarding',
        'entitlement_id', p_entitlement_id,
        'runtime_activation_requested', false
      )
    );

    insert into public.client_subscription_accounts (
      subscription_id, client_instagram_account_id, account_id, status
    ) values (
      v_subscription_id, v_client_account_id, v_account_id, 'active'
    );

    update public.client_account_entitlements
       set status = 'entitlement_consumed',
           account_id = v_account_id,
           consumed_at = now(),
           updated_at = now()
     where id = p_entitlement_id
       and client_id = p_client_id
       and status = 'entitlement_reserved';
    if not found then
      raise exception 'entitlement_consume_conflict';
    end if;

    update public.client_instagram_onboarding_sessions
       set account_id = v_account_id,
           requested_username = v_username,
           package_code = v_package_code,
           status = 'active',
           current_step = 'analysis',
           public_analysis = coalesce(p_public_analysis, '{}'::jsonb),
           last_error_code = null,
           failure_reason = null,
           lease_owner = null,
           lease_expires_at = null,
           last_progress_at = now(),
           expires_at = now() + interval '7 days',
           updated_at = now()
     where id = v_session.id;

    insert into public.commercial_checkout_audit_events (
      entitlement_id, event_type, client_id, payload
    ) values (
      p_entitlement_id,
      'client_instagram_onboarding_started',
      p_client_id,
      jsonb_build_object(
        'onboarding_session_id', v_session.id,
        'account_id', v_account_id,
        'attempt_id', p_attempt_id,
        'package_code', v_package_code,
        'credentials_stored_in_vault', true,
        'runtime_activation_requested', false
      )
    );
  exception when others then
    v_failure := left(sqlerrm, 160);
    update public.client_instagram_onboarding_sessions
       set status = 'failed_retryable',
           last_error_code = 'atomic_provisioning_failed',
           failure_reason = v_failure,
           lease_owner = null,
           lease_expires_at = null,
           updated_at = now()
     where id = v_session.id;
    return jsonb_build_object(
      'ok', false,
      'reason', 'atomic_provisioning_failed',
      'session_id', v_session.id
    );
  end;

  return jsonb_build_object(
    'ok', true,
    'session_id', v_session.id,
    'account_id', v_account_id,
    'status', 'active'
  );
end;
$$;

create or replace function public.advance_client_instagram_onboarding(
  p_session_id uuid,
  p_client_id uuid,
  p_actor_id uuid,
  p_action text,
  p_value jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.client_instagram_onboarding_sessions%rowtype;
  v_eligible_count integer := 0;
begin
  if not exists (
    select 1 from public.client_users cu
     where cu.client_id = p_client_id
       and cu.auth_user_id = p_actor_id
       and cu.status = 'active'
       and cu.role in ('owner', 'admin', 'assistant')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'client_access_denied');
  end if;

  select * into v_session
    from public.client_instagram_onboarding_sessions
   where id = p_session_id and client_id = p_client_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'onboarding_not_found');
  end if;

  if v_session.status in ('active', 'creating', 'failed_retryable')
     and v_session.expires_at <= now() then
    update public.client_instagram_onboarding_sessions
       set status = 'expired', lease_owner = null, lease_expires_at = null, updated_at = now()
     where id = p_session_id;
    return jsonb_build_object('ok', false, 'reason', 'onboarding_expired', 'status', 'expired');
  end if;
  if v_session.status = 'completed' then
    return jsonb_build_object('ok', true, 'already_completed', true, 'status', 'completed');
  end if;
  if v_session.status in ('expired', 'abandoned') then
    return jsonb_build_object('ok', false, 'reason', 'onboarding_terminal', 'status', v_session.status);
  end if;
  if v_session.status = 'creating'
     and v_session.lease_expires_at is not null
     and v_session.lease_expires_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'creation_lease_active', 'status', 'creating');
  end if;
  if v_session.account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'account_not_created');
  end if;

  if p_action = 'abandon' then
    update public.client_instagram_onboarding_sessions
       set status = 'abandoned', abandoned_at = now(), lease_owner = null,
           lease_expires_at = null, updated_at = now()
     where id = p_session_id;
    return jsonb_build_object('ok', true, 'status', 'abandoned');
  elsif p_action = 'save_analysis' then
    if nullif(trim(coalesce(p_value->>'username', '')), '') is null then
      return jsonb_build_object('ok', false, 'reason', 'public_analysis_required');
    end if;
    update public.client_instagram_onboarding_sessions
       set status = 'active', current_step = 'targeting', public_analysis = p_value,
           last_progress_at = now(), expires_at = now() + interval '7 days', updated_at = now()
     where id = p_session_id;
  elsif p_action = 'save_targeting' then
    if jsonb_typeof(p_value) <> 'object' or p_value = '{}'::jsonb then
      return jsonb_build_object('ok', false, 'reason', 'targeting_criteria_required');
    end if;
    update public.client_instagram_onboarding_sessions
       set status = 'active', current_step = 'targets', targeting_criteria = p_value,
           last_progress_at = now(), expires_at = now() + interval '7 days', updated_at = now()
     where id = p_session_id;
  elsif p_action = 'open_targets' then
    update public.client_instagram_onboarding_sessions
       set status = 'active', current_step = 'targets',
           last_progress_at = now(), expires_at = now() + interval '7 days', updated_at = now()
     where id = p_session_id;
  elsif p_action = 'complete' then
    if nullif(trim(coalesce(v_session.public_analysis->>'username', '')), '') is null then
      return jsonb_build_object('ok', false, 'reason', 'public_analysis_required');
    end if;
    if jsonb_typeof(v_session.targeting_criteria) <> 'object'
       or v_session.targeting_criteria = '{}'::jsonb then
      return jsonb_build_object('ok', false, 'reason', 'targeting_criteria_required');
    end if;

    select count(*)::integer into v_eligible_count
      from public.ig_targets t
     where t.account_id = v_session.account_id
       and lower(trim(coalesce(t.status, ''))) in ('valid', 'active')
       and lower(trim(coalesce(t.quality_status, ''))) = 'eligible'
       and lower(trim(coalesce(t.verification_status, ''))) = 'found'
       and t.archived_at is null
       and t.deleted_at is null;
    if v_eligible_count < 15 then
      return jsonb_build_object(
        'ok', false, 'reason', 'target_minimum_not_met',
        'eligible_count', v_eligible_count, 'required_count', 15
      );
    end if;

    update public.client_instagram_onboarding_sessions
       set status = 'completed', current_step = 'complete', completed_at = now(),
           lease_owner = null, lease_expires_at = null,
           last_progress_at = now(), updated_at = now()
     where id = p_session_id;
    update public.client_instagram_accounts
       set onboarding_status = 'configured', provisioning_status = 'not_started', updated_at = now()
     where client_id = p_client_id and account_id = v_session.account_id;
    insert into public.commercial_checkout_audit_events (
      entitlement_id, event_type, client_id, payload
    ) values (
      v_session.entitlement_id,
      'client_instagram_onboarding_completed',
      p_client_id,
      jsonb_build_object(
        'onboarding_session_id', p_session_id,
        'account_id', v_session.account_id,
        'actor_id', p_actor_id,
        'eligible_target_count', v_eligible_count,
        'required_target_count', 15,
        'runtime_activation_requested', false
      )
    );
    return jsonb_build_object('ok', true, 'status', 'completed', 'eligible_count', v_eligible_count);
  else
    return jsonb_build_object('ok', false, 'reason', 'onboarding_action_invalid');
  end if;

  return jsonb_build_object('ok', true, 'status', 'active');
end;
$$;

create or replace function public.restart_client_instagram_onboarding(
  p_previous_session_id uuid,
  p_client_id uuid,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous public.client_instagram_onboarding_sessions%rowtype;
  v_existing public.client_instagram_onboarding_sessions%rowtype;
  v_new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'client_instagram_onboarding:restart:' || p_previous_session_id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'client_instagram_onboarding:idempotency:' || p_client_id::text || ':' || p_idempotency_key::text,
    0
  ));

  if not exists (
    select 1 from public.client_users cu
     where cu.client_id = p_client_id
       and cu.auth_user_id = p_actor_id
       and cu.status = 'active'
       and cu.role in ('owner', 'admin', 'assistant')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'client_access_denied');
  end if;

  select * into v_previous
    from public.client_instagram_onboarding_sessions
   where id = p_previous_session_id and client_id = p_client_id
   for update;
  if not found or v_previous.status not in ('expired', 'abandoned') then
    return jsonb_build_object('ok', false, 'reason', 'restart_not_allowed');
  end if;
  if v_previous.account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'account_not_created');
  end if;

  select * into v_existing
    from public.client_instagram_onboarding_sessions
   where client_id = p_client_id
     and idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_existing.account_id = v_previous.account_id
       and v_existing.entitlement_id = v_previous.entitlement_id then
      return jsonb_build_object(
        'ok', true,
        'already_restarted', true,
        'session_id', v_existing.id,
        'account_id', v_existing.account_id
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'restart_idempotency_mismatch');
  end if;

  select * into v_existing
    from public.client_instagram_onboarding_sessions
   where client_id = p_client_id
     and status in ('active', 'creating')
     and (account_id = v_previous.account_id or entitlement_id = v_previous.entitlement_id)
   order by created_at desc
   limit 1
   for update;
  if found then
    return jsonb_build_object(
      'ok', true,
      'already_restarted', true,
      'session_id', v_existing.id,
      'account_id', v_existing.account_id
    );
  end if;

  insert into public.client_instagram_onboarding_sessions (
    client_id, entitlement_id, account_id, created_by, idempotency_key,
    requested_username, package_code, status, current_step,
    public_analysis, targeting_criteria, expires_at, last_progress_at
  ) values (
    p_client_id, v_previous.entitlement_id, v_previous.account_id, p_actor_id, p_idempotency_key,
    v_previous.requested_username, v_previous.package_code, 'active', v_previous.current_step,
    v_previous.public_analysis, v_previous.targeting_criteria, now() + interval '7 days', now()
  ) returning id into v_new_id;

  insert into public.commercial_checkout_audit_events (
    entitlement_id, event_type, client_id, payload
  ) values (
    v_previous.entitlement_id,
    'client_instagram_onboarding_restarted',
    p_client_id,
    jsonb_build_object(
      'previous_session_id', p_previous_session_id,
      'onboarding_session_id', v_new_id,
      'account_id', v_previous.account_id,
      'entitlement_reconsumed', false,
      'credentials_replayed', false
    )
  );

  return jsonb_build_object('ok', true, 'session_id', v_new_id, 'account_id', v_previous.account_id);
end;
$$;

create or replace function public.expire_client_instagram_onboarding_sessions(
  p_client_id uuid,
  p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1 from public.client_users cu
     where cu.client_id = p_client_id
       and cu.auth_user_id = p_actor_id
       and cu.status = 'active'
  ) then
    return 0;
  end if;

  update public.client_instagram_onboarding_sessions
     set status = 'expired', lease_owner = null, lease_expires_at = null, updated_at = now()
   where client_id = p_client_id
     and status in ('active', 'creating', 'failed_retryable')
     and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.begin_client_instagram_onboarding(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb) from public;
revoke all on function public.advance_client_instagram_onboarding(uuid, uuid, uuid, text, jsonb) from public;
revoke all on function public.restart_client_instagram_onboarding(uuid, uuid, uuid, uuid) from public;
revoke all on function public.expire_client_instagram_onboarding_sessions(uuid, uuid) from public;
grant execute on function public.begin_client_instagram_onboarding(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb) to service_role;
grant execute on function public.advance_client_instagram_onboarding(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.restart_client_instagram_onboarding(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.expire_client_instagram_onboarding_sessions(uuid, uuid) to service_role;

comment on function public.begin_client_instagram_onboarding(uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb) is
  'Creates the account, Vault secret, ownership, entitlement consumption, and resumable session in one PostgreSQL transaction.';
comment on function public.advance_client_instagram_onboarding(uuid, uuid, uuid, text, jsonb) is
  'Advances or completes onboarding from server-owned state; completion always recounts 15 strict eligible targets in PostgreSQL.';
comment on function public.restart_client_instagram_onboarding(uuid, uuid, uuid, uuid) is
  'Starts a new resumable session after explicit abandonment or expiry without recreating the account or consuming entitlement twice.';
