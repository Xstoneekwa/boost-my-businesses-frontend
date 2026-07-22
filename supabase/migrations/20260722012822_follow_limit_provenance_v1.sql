-- Follow Limit Provenance V1 (candidate only).
-- Absence of a row means no account override; callers must resolve package caps.

create table public.ig_account_follow_limit_overrides (
  account_id uuid primary key references public.ig_accounts(id) on delete cascade,
  follow_day_cap_override integer null,
  follow_session_cap_override integer null,
  source text not null,
  source_surface text null,
  updated_by uuid null,
  reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ig_account_follow_limit_overrides_day_positive
    check (follow_day_cap_override is null or follow_day_cap_override > 0),
  constraint ig_account_follow_limit_overrides_session_positive
    check (follow_session_cap_override is null or follow_session_cap_override > 0),
  constraint ig_account_follow_limit_overrides_cap_present
    check (follow_day_cap_override is not null or follow_session_cap_override is not null),
  constraint ig_account_follow_limit_overrides_source_bounded
    check (source in ('admin', 'support', 'migration_confirmed'))
);

comment on table public.ig_account_follow_limit_overrides is
  'Explicit account Follow business-limit overrides only. No row means package defaults; warmup and legacy settings never seed this table.';
comment on column public.ig_account_follow_limit_overrides.updated_by is
  'Operator identity supplied by the authenticated server route. Deliberately not a foreign key so audit history survives identity lifecycle changes.';

alter table public.ig_account_follow_limit_overrides enable row level security;
revoke all on table public.ig_account_follow_limit_overrides from public, anon, authenticated;
revoke insert, update, delete on table public.ig_account_follow_limit_overrides from service_role;
grant select on table public.ig_account_follow_limit_overrides to service_role;

create or replace function public.save_account_follow_limit_override_v1(
  p_account_id uuid,
  p_follow_day_cap_override integer,
  p_follow_session_cap_override integer,
  p_source text,
  p_source_surface text,
  p_updated_by uuid,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_action text;
begin
  if p_account_id is null then raise exception 'account_id_required'; end if;
  if coalesce(trim(p_idempotency_key), '') = '' then raise exception 'idempotency_key_required'; end if;
  if p_source not in ('admin', 'support', 'migration_confirmed') then raise exception 'invalid_override_source'; end if;
  if p_follow_day_cap_override is null and p_follow_session_cap_override is null then
    raise exception 'follow_override_cap_required';
  end if;
  if coalesce(p_follow_day_cap_override, 1) < 1 or coalesce(p_follow_session_cap_override, 1) < 1 then
    raise exception 'follow_override_cap_must_be_positive';
  end if;

  -- Serializes first insert as well as later updates for one account.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_account_id::text));

  if exists (
    select 1
      from public.ig_action_logs
     where account_id = p_account_id
       and action_type in ('follow_limit_override_created', 'follow_limit_override_updated')
       and payload ->> 'idempotency_key' = p_idempotency_key
  ) then
    return jsonb_build_object('changed', false, 'idempotent', true);
  end if;

  select to_jsonb(o) into v_before
    from public.ig_account_follow_limit_overrides o
   where o.account_id = p_account_id
   for update;
  v_action := case when v_before is null then 'create_override' else 'update_override' end;

  insert into public.ig_account_follow_limit_overrides (
    account_id,
    follow_day_cap_override,
    follow_session_cap_override,
    source,
    source_surface,
    updated_by,
    reason,
    created_at,
    updated_at
  ) values (
    p_account_id,
    p_follow_day_cap_override,
    p_follow_session_cap_override,
    p_source,
    nullif(trim(p_source_surface), ''),
    p_updated_by,
    nullif(trim(p_reason), ''),
    now(),
    now()
  ) on conflict (account_id) do update set
    follow_day_cap_override = excluded.follow_day_cap_override,
    follow_session_cap_override = excluded.follow_session_cap_override,
    source = excluded.source,
    source_surface = excluded.source_surface,
    updated_by = excluded.updated_by,
    reason = excluded.reason,
    updated_at = now();

  select to_jsonb(o) into v_after
    from public.ig_account_follow_limit_overrides o
   where o.account_id = p_account_id;

  insert into public.ig_action_logs (
    account_id, run_id, target_username, action_type, status, message, payload, created_at
  ) values (
    p_account_id,
    null,
    null,
    case when v_action = 'create_override' then 'follow_limit_override_created' else 'follow_limit_override_updated' end,
    'success',
    'Explicit Follow limit override saved from a server-side surface.',
    jsonb_build_object(
      'domain', 'follow_limit_provenance_v1',
      'action', v_action,
      'actor_type', p_source,
      'actor_id', p_updated_by,
      'source_surface', nullif(trim(p_source_surface), ''),
      'reason', nullif(trim(p_reason), ''),
      'idempotency_key', p_idempotency_key,
      'before', coalesce(v_before, 'null'::jsonb),
      'after', v_after
    ),
    now()
  );

  return jsonb_build_object('changed', true, 'idempotent', false, 'action', v_action, 'data', v_after);
end;
$$;

create or replace function public.reset_account_follow_limit_override_v1(
  p_account_id uuid,
  p_source_surface text,
  p_updated_by uuid,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  if p_account_id is null then raise exception 'account_id_required'; end if;
  if coalesce(trim(p_idempotency_key), '') = '' then raise exception 'idempotency_key_required'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_account_id::text));

  if exists (
    select 1
      from public.ig_action_logs
     where account_id = p_account_id
       and action_type = 'follow_limit_override_reset'
       and payload ->> 'idempotency_key' = p_idempotency_key
  ) then
    return jsonb_build_object('changed', false, 'idempotent', true);
  end if;

  delete from public.ig_account_follow_limit_overrides o
   where o.account_id = p_account_id
   returning to_jsonb(o) into v_before;

  if v_before is null then
    return jsonb_build_object('changed', false, 'idempotent', false, 'action', 'reset_to_package_defaults');
  end if;

  insert into public.ig_action_logs (
    account_id, run_id, target_username, action_type, status, message, payload, created_at
  ) values (
    p_account_id,
    null,
    null,
    'follow_limit_override_reset',
    'success',
    'Explicit Follow limit override removed; package defaults become canonical.',
    jsonb_build_object(
      'domain', 'follow_limit_provenance_v1',
      'action', 'reset_to_package_defaults',
      'actor_type', 'admin',
      'actor_id', p_updated_by,
      'source_surface', nullif(trim(p_source_surface), ''),
      'reason', nullif(trim(p_reason), ''),
      'idempotency_key', p_idempotency_key,
      'before', v_before,
      'after', 'null'::jsonb
    ),
    now()
  );

  return jsonb_build_object('changed', true, 'idempotent', false, 'action', 'reset_to_package_defaults');
end;
$$;

revoke all on function public.save_account_follow_limit_override_v1(uuid,integer,integer,text,text,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.reset_account_follow_limit_override_v1(uuid,text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.save_account_follow_limit_override_v1(uuid,integer,integer,text,text,uuid,text,text)
  to service_role;
grant execute on function public.reset_account_follow_limit_override_v1(uuid,text,uuid,text,text)
  to service_role;
