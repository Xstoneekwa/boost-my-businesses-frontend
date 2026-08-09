-- Point 2 source-only candidate. Apply only after the explicit activation GO.
-- It keeps the proven client transaction as the storage engine and exposes one
-- actor-aware contract to Client, Admin and BotApp.

alter table public.client_instagram_onboarding_sessions
  add column if not exists actor_type text not null default 'client'
    check (actor_type in ('client', 'admin', 'botapp_operator')),
  add column if not exists source_surface text not null default 'client_dashboard'
    check (source_surface in ('client_dashboard', 'admin_dashboard', 'botapp')),
  add column if not exists initiated_by_actor_id uuid null,
  add column if not exists source_context jsonb not null default '{}'::jsonb;

update public.client_instagram_onboarding_sessions
   set initiated_by_actor_id = coalesce(initiated_by_actor_id, created_by),
       actor_type = coalesce(nullif(actor_type, ''), 'client'),
       source_surface = coalesce(nullif(source_surface, ''), 'client_dashboard'),
       source_context = coalesce(source_context, '{}'::jsonb)
 where initiated_by_actor_id is null
    or actor_type = ''
    or source_surface = ''
    or source_context is null;

comment on column public.client_instagram_onboarding_sessions.actor_type is
  'Canonical initiating actor class; never used as a substitute for server-side ownership checks.';
comment on column public.client_instagram_onboarding_sessions.source_surface is
  'UX surface that called the single canonical onboarding engine.';
comment on column public.client_instagram_onboarding_sessions.source_context is
  'Non-authoritative deferred operator intent such as assignment target; applied only after gate 15 completion.';

create or replace function public.authorize_instagram_account_onboarding_actor_v1(
  p_client_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_source_surface text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_effective_client_actor_id uuid;
begin
  if p_client_id is null or p_actor_id is null then
    return jsonb_build_object('ok', false, 'reason', 'onboarding_actor_access_denied');
  end if;
  if not exists (
    select 1 from public.clients c where c.id = p_client_id and c.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'client_not_active');
  end if;

  if p_actor_type = 'client' and p_source_surface = 'client_dashboard' then
    select cu.auth_user_id into v_effective_client_actor_id
      from public.client_users cu
     where cu.client_id = p_client_id
       and cu.auth_user_id = p_actor_id
       and cu.status = 'active'
       and cu.role in ('owner', 'admin', 'assistant')
     limit 1;
  elsif p_actor_type in ('admin', 'botapp_operator')
        and ((p_actor_type = 'admin' and p_source_surface = 'admin_dashboard')
          or (p_actor_type = 'botapp_operator' and p_source_surface = 'botapp'))
        and exists (
          select 1
            from public.tenant_users tu
           where tu.user_id = p_actor_id
             and tu.role = 'superadmin'
        ) then
    select cu.auth_user_id into v_effective_client_actor_id
      from public.client_users cu
     where cu.client_id = p_client_id
       and cu.status = 'active'
       and cu.role in ('owner', 'admin', 'assistant')
     order by case cu.role when 'owner' then 0 when 'admin' then 1 else 2 end, cu.auth_user_id
     limit 1;
  else
    return jsonb_build_object('ok', false, 'reason', 'onboarding_actor_access_denied');
  end if;

  if v_effective_client_actor_id is null then
    return jsonb_build_object('ok', false, 'reason', 'client_ownership_principal_missing');
  end if;

  return jsonb_build_object(
    'ok', true,
    'effective_client_actor_id', v_effective_client_actor_id,
    'actor_type', p_actor_type,
    'source_surface', p_source_surface
  );
end;
$$;

create or replace function public.begin_instagram_account_onboarding_v1(
  p_client_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_source_surface text,
  p_entitlement_id uuid,
  p_idempotency_key uuid,
  p_attempt_id uuid,
  p_lease_owner text,
  p_requested_username text,
  p_login_email text,
  p_password text,
  p_public_analysis jsonb,
  p_source_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth jsonb;
  v_result jsonb;
  v_session_id uuid;
  v_existing public.client_instagram_onboarding_sessions%rowtype;
begin
  v_auth := public.authorize_instagram_account_onboarding_actor_v1(
    p_client_id, p_actor_type, p_actor_id, p_source_surface
  );
  if v_auth->>'ok' <> 'true' then return v_auth; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'canonical_instagram_onboarding:idempotency:' || p_client_id::text || ':' || p_idempotency_key::text, 0
  ));
  select * into v_existing
    from public.client_instagram_onboarding_sessions
   where client_id = p_client_id and idempotency_key = p_idempotency_key
   for update;
  if found and v_existing.initiated_by_actor_id is not null
     and (v_existing.initiated_by_actor_id <> p_actor_id
       or v_existing.actor_type <> p_actor_type
       or v_existing.source_surface <> p_source_surface) then
    return jsonb_build_object('ok', false, 'reason', 'idempotency_actor_mismatch');
  end if;

  v_result := public.begin_client_instagram_onboarding(
    p_client_id,
    (v_auth->>'effective_client_actor_id')::uuid,
    p_entitlement_id,
    p_idempotency_key,
    p_attempt_id,
    p_lease_owner,
    p_requested_username,
    p_login_email,
    p_password,
    coalesce(p_public_analysis, '{}'::jsonb)
  );
  if v_result->>'ok' <> 'true' then return v_result; end if;

  v_session_id := (v_result->>'session_id')::uuid;
  update public.client_instagram_onboarding_sessions
     set actor_type = p_actor_type,
         source_surface = p_source_surface,
         initiated_by_actor_id = p_actor_id,
         source_context = coalesce(p_source_context, '{}'::jsonb),
         updated_at = now()
   where id = v_session_id and client_id = p_client_id;

  if coalesce((v_result->>'already_started')::boolean, false) = false then
    insert into public.commercial_checkout_audit_events (
      entitlement_id, event_type, client_id, payload
    ) values (
      p_entitlement_id,
      'canonical_instagram_account_onboarding_started',
      p_client_id,
      jsonb_build_object(
        'onboarding_session_id', v_session_id,
        'account_id', v_result->>'account_id',
        'actor_type', p_actor_type,
        'actor_id', p_actor_id,
        'source_surface', p_source_surface,
        'runtime_activation_requested', false
      )
    );
  end if;

  return v_result || jsonb_build_object(
    'canonical_engine', 'canonical_instagram_account_onboarding_v1',
    'actor_type', p_actor_type,
    'source_surface', p_source_surface
  );
end;
$$;

create or replace function public.advance_instagram_account_onboarding_v1(
  p_session_id uuid,
  p_client_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_source_surface text,
  p_action text,
  p_value jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth jsonb;
  v_result jsonb;
begin
  v_auth := public.authorize_instagram_account_onboarding_actor_v1(
    p_client_id, p_actor_type, p_actor_id, p_source_surface
  );
  if v_auth->>'ok' <> 'true' then return v_auth; end if;
  if not exists (
    select 1 from public.client_instagram_onboarding_sessions s
     where s.id = p_session_id and s.client_id = p_client_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'onboarding_not_found');
  end if;

  v_result := public.advance_client_instagram_onboarding(
    p_session_id,
    p_client_id,
    (v_auth->>'effective_client_actor_id')::uuid,
    p_action,
    coalesce(p_value, '{}'::jsonb)
  );
  if v_result->>'ok' = 'true' then
    insert into public.commercial_checkout_audit_events (event_type, client_id, payload)
    values (
      'canonical_instagram_account_onboarding_action', p_client_id,
      jsonb_build_object(
        'onboarding_session_id', p_session_id, 'action', p_action,
        'actor_type', p_actor_type, 'actor_id', p_actor_id,
        'source_surface', p_source_surface, 'runtime_activation_requested', false
      )
    );
  end if;
  return v_result;
end;
$$;

create or replace function public.save_instagram_account_onboarding_protection_lists_v1(
  p_session_id uuid,
  p_client_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_source_surface text,
  p_mode text,
  p_unfollow_items text[],
  p_blacklist_items text[],
  p_unfollow_expected_version bigint,
  p_blacklist_expected_version bigint,
  p_request_id text,
  p_idempotency_key text,
  p_unfollow_fingerprint text,
  p_blacklist_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth jsonb;
begin
  v_auth := public.authorize_instagram_account_onboarding_actor_v1(
    p_client_id, p_actor_type, p_actor_id, p_source_surface
  );
  if v_auth->>'ok' <> 'true' then return v_auth; end if;
  if not exists (
    select 1 from public.client_instagram_onboarding_sessions s
     where s.id = p_session_id and s.client_id = p_client_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'onboarding_not_found');
  end if;

  return public.save_client_instagram_onboarding_protection_lists(
    p_session_id,
    p_client_id,
    (v_auth->>'effective_client_actor_id')::uuid,
    p_mode,
    p_unfollow_items,
    p_blacklist_items,
    p_unfollow_expected_version,
    p_blacklist_expected_version,
    p_request_id,
    p_idempotency_key,
    p_unfollow_fingerprint,
    p_blacklist_fingerprint
  );
end;
$$;

create or replace function public.restart_instagram_account_onboarding_v1(
  p_previous_session_id uuid,
  p_client_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_source_surface text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth jsonb;
  v_result jsonb;
  v_previous public.client_instagram_onboarding_sessions%rowtype;
begin
  v_auth := public.authorize_instagram_account_onboarding_actor_v1(
    p_client_id, p_actor_type, p_actor_id, p_source_surface
  );
  if v_auth->>'ok' <> 'true' then return v_auth; end if;
  select * into v_previous from public.client_instagram_onboarding_sessions
   where id = p_previous_session_id and client_id = p_client_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'onboarding_not_found');
  end if;
  v_result := public.restart_client_instagram_onboarding(
    p_previous_session_id,
    p_client_id,
    (v_auth->>'effective_client_actor_id')::uuid,
    p_idempotency_key
  );
  if v_result->>'ok' = 'true' then
    update public.client_instagram_onboarding_sessions
       set actor_type = p_actor_type,
           source_surface = p_source_surface,
           initiated_by_actor_id = p_actor_id,
           source_context = coalesce(v_previous.source_context, '{}'::jsonb),
           updated_at = now()
     where id = (v_result->>'session_id')::uuid and client_id = p_client_id;
  end if;
  return v_result;
end;
$$;

create or replace function public.expire_instagram_account_onboarding_sessions_v1(
  p_client_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_source_surface text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth jsonb;
begin
  v_auth := public.authorize_instagram_account_onboarding_actor_v1(
    p_client_id, p_actor_type, p_actor_id, p_source_surface
  );
  if v_auth->>'ok' <> 'true' then return 0; end if;
  return public.expire_client_instagram_onboarding_sessions(
    p_client_id, (v_auth->>'effective_client_actor_id')::uuid
  );
end;
$$;

revoke all on function public.authorize_instagram_account_onboarding_actor_v1(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.begin_instagram_account_onboarding_v1(uuid, text, uuid, text, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.advance_instagram_account_onboarding_v1(uuid, uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.save_instagram_account_onboarding_protection_lists_v1(uuid, uuid, text, uuid, text, text, text[], text[], bigint, bigint, text, text, text, text) from public, anon, authenticated;
revoke all on function public.restart_instagram_account_onboarding_v1(uuid, uuid, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.expire_instagram_account_onboarding_sessions_v1(uuid, text, uuid, text) from public, anon, authenticated;

grant execute on function public.authorize_instagram_account_onboarding_actor_v1(uuid, text, uuid, text) to service_role;
grant execute on function public.begin_instagram_account_onboarding_v1(uuid, text, uuid, text, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb) to service_role;
grant execute on function public.advance_instagram_account_onboarding_v1(uuid, uuid, text, uuid, text, text, jsonb) to service_role;
grant execute on function public.save_instagram_account_onboarding_protection_lists_v1(uuid, uuid, text, uuid, text, text, text[], text[], bigint, bigint, text, text, text, text) to service_role;
grant execute on function public.restart_instagram_account_onboarding_v1(uuid, uuid, text, uuid, text, uuid) to service_role;
grant execute on function public.expire_instagram_account_onboarding_sessions_v1(uuid, text, uuid, text) to service_role;

comment on function public.begin_instagram_account_onboarding_v1(uuid, text, uuid, text, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb) is
  'Single actor-aware onboarding engine for Client Dashboard, Admin Dashboard and BotApp; delegates account/package/Vault/ownership creation to the proven transactional client engine.';
