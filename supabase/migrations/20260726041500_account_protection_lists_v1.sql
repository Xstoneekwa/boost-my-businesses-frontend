-- Account-scoped canonical protection lists. Intentionally contains no legacy backfill.

create table if not exists public.account_protection_list_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  list_kind text not null,
  normalized_username text not null,
  active boolean not null default true,
  source_surface text not null,
  created_by_auth_user_id uuid null references auth.users(id) on delete set null,
  updated_by_auth_user_id uuid null references auth.users(id) on delete set null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_protection_list_entries_kind_check
    check (list_kind in ('interaction_blacklist', 'unfollow_whitelist')),
  constraint account_protection_list_entries_username_check
    check (
      normalized_username = lower(normalized_username)
      and normalized_username = btrim(normalized_username)
      and char_length(normalized_username) between 1 and 30
      and normalized_username ~ '^[a-z0-9._]+$'
      and normalized_username !~ '^\.'
      and normalized_username !~ '\.$'
      and normalized_username !~ '\.\.'
      and normalized_username !~ '://'
      and normalized_username !~ '/'
      and normalized_username !~ '^@'
    ),
  constraint account_protection_list_entries_source_check
    check (char_length(btrim(source_surface)) between 1 and 64),
  constraint account_protection_list_entries_version_check check (version >= 1),
  constraint account_protection_list_entries_account_kind_username_key
    unique (account_id, list_kind, normalized_username)
);

create table if not exists public.account_protection_list_versions (
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  list_kind text not null,
  version bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint account_protection_list_versions_pkey primary key (account_id, list_kind),
  constraint account_protection_list_versions_kind_check
    check (list_kind in ('interaction_blacklist', 'unfollow_whitelist')),
  constraint account_protection_list_versions_version_check check (version >= 0)
);

create table if not exists public.account_protection_list_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  list_kind text not null,
  normalized_username text null,
  action text not null,
  source_surface text not null,
  actor_auth_user_id uuid null references auth.users(id) on delete set null,
  request_id text null,
  idempotency_key text null,
  previous_version bigint null,
  new_version bigint null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint account_protection_list_events_kind_check
    check (list_kind in ('interaction_blacklist', 'unfollow_whitelist')),
  constraint account_protection_list_events_action_check
    check (action in ('add', 'remove', 'reactivate', 'replace', 'clear')),
  constraint account_protection_list_events_username_check
    check (
      normalized_username is null
      or (
        normalized_username = lower(normalized_username)
        and normalized_username = btrim(normalized_username)
        and char_length(normalized_username) between 1 and 30
        and normalized_username ~ '^[a-z0-9._]+$'
        and normalized_username !~ '^\.'
        and normalized_username !~ '\.$'
        and normalized_username !~ '\.\.'
        and normalized_username !~ '://'
        and normalized_username !~ '/'
        and normalized_username !~ '^@'
      )
    ),
  constraint account_protection_list_events_source_check
    check (char_length(btrim(source_surface)) between 1 and 64),
  constraint account_protection_list_events_request_id_check
    check (request_id is null or char_length(request_id) between 1 and 200),
  constraint account_protection_list_events_idempotency_key_check
    check (idempotency_key is null or char_length(idempotency_key) between 1 and 200),
  constraint account_protection_list_events_versions_check
    check (
      (previous_version is null and new_version is null)
      or (previous_version >= 0 and new_version >= previous_version)
    ),
  constraint account_protection_list_events_metadata_check
    check (jsonb_typeof(metadata_safe) = 'object' and pg_column_size(metadata_safe) <= 4096)
);

create index if not exists account_protection_list_entries_account_kind_active_idx
  on public.account_protection_list_entries (account_id, list_kind, active);

create index if not exists account_protection_list_entries_account_updated_idx
  on public.account_protection_list_entries (account_id, updated_at desc);

create index if not exists account_protection_list_versions_account_idx
  on public.account_protection_list_versions (account_id);

create index if not exists account_protection_list_events_account_kind_created_idx
  on public.account_protection_list_events (account_id, list_kind, created_at desc);

create unique index if not exists account_protection_list_events_idempotency_idx
  on public.account_protection_list_events (account_id, list_kind, idempotency_key)
  where idempotency_key is not null;

alter table public.account_protection_list_entries enable row level security;
alter table public.account_protection_list_versions enable row level security;
alter table public.account_protection_list_events enable row level security;

revoke all on table public.account_protection_list_entries from public, anon, authenticated;
revoke all on table public.account_protection_list_versions from public, anon, authenticated;
revoke all on table public.account_protection_list_events from public, anon, authenticated;

grant select, insert, update, delete on table public.account_protection_list_entries to service_role;
grant select, insert, update, delete on table public.account_protection_list_versions to service_role;
grant select, insert on table public.account_protection_list_events to service_role;
revoke update, delete, truncate on table public.account_protection_list_events from service_role;

drop policy if exists account_protection_list_entries_service_role on public.account_protection_list_entries;
create policy account_protection_list_entries_service_role
  on public.account_protection_list_entries
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists account_protection_list_versions_service_role on public.account_protection_list_versions;
create policy account_protection_list_versions_service_role
  on public.account_protection_list_versions
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists account_protection_list_events_service_role_select on public.account_protection_list_events;
create policy account_protection_list_events_service_role_select
  on public.account_protection_list_events
  for select
  to service_role
  using (true);

drop policy if exists account_protection_list_events_service_role_insert on public.account_protection_list_events;
create policy account_protection_list_events_service_role_insert
  on public.account_protection_list_events
  for insert
  to service_role
  with check (true);

create or replace function public.mutate_account_protection_list(
  p_account_id uuid,
  p_list_kind text,
  p_operation text,
  p_items text[],
  p_add_items text[],
  p_remove_items text[],
  p_source_surface text,
  p_actor_auth_user_id uuid,
  p_request_id text,
  p_idempotency_key text,
  p_expected_version bigint,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current_version bigint;
  v_new_version bigint;
  v_current_items text[];
  v_desired_items text[];
  v_updated_at timestamptz;
  v_existing_event public.account_protection_list_events%rowtype;
  v_action text;
  v_event_username text;
  v_reactivated boolean := false;
  v_changed boolean;
  v_account_status text;
  v_account_lifecycle text;
  v_account_archived_at timestamptz;
  v_account_trashed_at timestamptz;
begin
  if p_list_kind not in ('interaction_blacklist', 'unfollow_whitelist') then
    return jsonb_build_object('ok', false, 'error', 'invalid_list_kind');
  end if;
  if p_operation not in ('replace', 'patch', 'delete') then
    return jsonb_build_object('ok', false, 'error', 'invalid_operation');
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_expected_version');
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    return jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key');
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_request_fingerprint');
  end if;
  if p_source_surface is null or char_length(btrim(p_source_surface)) not between 1 and 64 then
    return jsonb_build_object('ok', false, 'error', 'invalid_source_surface');
  end if;
  if cardinality(coalesce(p_items, '{}'::text[])) > 1000
    or cardinality(coalesce(p_add_items, '{}'::text[])) > 1000
    or cardinality(coalesce(p_remove_items, '{}'::text[])) > 1000 then
    return jsonb_build_object('ok', false, 'error', 'too_many_items');
  end if;
  if exists (
    select 1
    from unnest(
      coalesce(p_items, '{}'::text[])
      || coalesce(p_add_items, '{}'::text[])
      || coalesce(p_remove_items, '{}'::text[])
    ) as candidate(username)
    where username is null
      or username <> lower(username)
      or username <> btrim(username)
      or char_length(username) not between 1 and 30
      or username !~ '^[a-z0-9._]+$'
      or username ~ '^\.'
      or username ~ '\.$'
      or username ~ '\.\.'
      or username ~ '://'
      or username ~ '/'
      or username ~ '^@'
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_username');
  end if;

  select
    lower(coalesce(status, '')),
    lower(coalesce(admin_lifecycle_status, '')),
    archived_at,
    trashed_at
  into
    v_account_status,
    v_account_lifecycle,
    v_account_archived_at,
    v_account_trashed_at
  from public.ig_accounts
  where id = p_account_id
  for share;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;
  if v_account_archived_at is not null
    or v_account_trashed_at is not null
    or v_account_status in ('archived', 'trashed', 'cancelled', 'canceled', 'deleted')
    or v_account_lifecycle in ('archived', 'trashed', 'cancelled', 'canceled', 'deleted') then
    return jsonb_build_object('ok', false, 'error', 'account_lifecycle_conflict');
  end if;

  insert into public.account_protection_list_versions (account_id, list_kind, version)
  values (p_account_id, p_list_kind, 0)
  on conflict (account_id, list_kind) do nothing;

  select version
    into v_current_version
  from public.account_protection_list_versions
  where account_id = p_account_id and list_kind = p_list_kind
  for update;

  select *
    into v_existing_event
  from public.account_protection_list_events
  where account_id = p_account_id
    and list_kind = p_list_kind
    and idempotency_key = p_idempotency_key;

  select coalesce(array_agg(normalized_username order by normalized_username), '{}'::text[])
    into v_current_items
  from public.account_protection_list_entries
  where account_id = p_account_id and list_kind = p_list_kind and active;

  if v_existing_event.id is not null then
    if v_existing_event.metadata_safe ->> 'request_fingerprint' <> p_request_fingerprint then
      return jsonb_build_object(
        'ok', false,
        'error', 'idempotency_conflict',
        'version', v_current_version
      );
    end if;
    select updated_at into v_updated_at
    from public.account_protection_list_versions
    where account_id = p_account_id and list_kind = p_list_kind;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'items', to_jsonb(v_current_items),
      'size', cardinality(v_current_items),
      'version', v_current_version,
      'mutation_version', v_existing_event.new_version,
      'updated_at', v_updated_at
    );
  end if;

  if v_current_version <> p_expected_version then
    return jsonb_build_object(
      'ok', false,
      'error', 'version_conflict',
      'version', v_current_version
    );
  end if;

  if p_operation = 'replace' then
    select coalesce(array_agg(username order by username), '{}'::text[])
      into v_desired_items
    from (select distinct unnest(coalesce(p_items, '{}'::text[])) as username) desired;
  elsif p_operation = 'patch' then
    select coalesce(array_agg(username order by username), '{}'::text[])
      into v_desired_items
    from (
      select distinct username
      from unnest(v_current_items || coalesce(p_add_items, '{}'::text[])) as added(username)
      where username <> all(coalesce(p_remove_items, '{}'::text[]))
    ) desired;
  else
    select coalesce(array_agg(username order by username), '{}'::text[])
      into v_desired_items
    from unnest(v_current_items) as current_item(username)
    where username <> all(coalesce(p_remove_items, '{}'::text[]));
  end if;

  v_changed := v_current_items is distinct from v_desired_items;
  v_new_version := v_current_version + case when v_changed then 1 else 0 end;
  v_updated_at := now();

  if v_changed then
    if p_operation = 'patch' and cardinality(coalesce(p_add_items, '{}'::text[])) = 1 then
      select exists (
        select 1 from public.account_protection_list_entries
        where account_id = p_account_id
          and list_kind = p_list_kind
          and normalized_username = p_add_items[1]
          and not active
      ) into v_reactivated;
    end if;

    update public.account_protection_list_entries
    set active = false,
        source_surface = p_source_surface,
        updated_by_auth_user_id = p_actor_auth_user_id,
        version = v_new_version,
        updated_at = v_updated_at
    where account_id = p_account_id
      and list_kind = p_list_kind
      and active
      and normalized_username <> all(v_desired_items);

    insert into public.account_protection_list_entries (
      account_id,
      list_kind,
      normalized_username,
      active,
      source_surface,
      created_by_auth_user_id,
      updated_by_auth_user_id,
      version,
      created_at,
      updated_at
    )
    select
      p_account_id,
      p_list_kind,
      username,
      true,
      p_source_surface,
      p_actor_auth_user_id,
      p_actor_auth_user_id,
      v_new_version,
      v_updated_at,
      v_updated_at
    from unnest(v_desired_items) as desired(username)
    on conflict (account_id, list_kind, normalized_username)
    do update set
      active = true,
      source_surface = excluded.source_surface,
      updated_by_auth_user_id = excluded.updated_by_auth_user_id,
      version = excluded.version,
      updated_at = excluded.updated_at
    where not account_protection_list_entries.active;

    update public.account_protection_list_versions
    set version = v_new_version, updated_at = v_updated_at
    where account_id = p_account_id and list_kind = p_list_kind;
  else
    select updated_at into v_updated_at
    from public.account_protection_list_versions
    where account_id = p_account_id and list_kind = p_list_kind;
  end if;

  if p_operation = 'replace' then
    v_action := case when cardinality(v_desired_items) = 0 then 'clear' else 'replace' end;
  elsif p_operation = 'delete' then
    v_action := 'remove';
  elsif cardinality(coalesce(p_add_items, '{}'::text[])) > 0
    and cardinality(coalesce(p_remove_items, '{}'::text[])) = 0 then
    v_action := case when v_reactivated then 'reactivate' else 'add' end;
  elsif cardinality(coalesce(p_add_items, '{}'::text[])) = 0
    and cardinality(coalesce(p_remove_items, '{}'::text[])) > 0 then
    v_action := 'remove';
  else
    v_action := 'replace';
  end if;

  if p_operation = 'delete' and cardinality(coalesce(p_remove_items, '{}'::text[])) = 1 then
    v_event_username := p_remove_items[1];
  elsif p_operation = 'patch'
    and cardinality(coalesce(p_add_items, '{}'::text[])) + cardinality(coalesce(p_remove_items, '{}'::text[])) = 1 then
    v_event_username := coalesce(p_add_items[1], p_remove_items[1]);
  end if;

  insert into public.account_protection_list_events (
    account_id,
    list_kind,
    normalized_username,
    action,
    source_surface,
    actor_auth_user_id,
    request_id,
    idempotency_key,
    previous_version,
    new_version,
    metadata_safe
  ) values (
    p_account_id,
    p_list_kind,
    v_event_username,
    v_action,
    p_source_surface,
    p_actor_auth_user_id,
    p_request_id,
    p_idempotency_key,
    v_current_version,
    v_new_version,
    jsonb_build_object(
      'operation', p_operation,
      'add_count', cardinality(coalesce(p_add_items, '{}'::text[])),
      'remove_count', cardinality(coalesce(p_remove_items, '{}'::text[])),
      'item_count', cardinality(v_desired_items),
      'changed', v_changed,
      'request_fingerprint', p_request_fingerprint
    )
  );

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'items', to_jsonb(v_desired_items),
    'size', cardinality(v_desired_items),
    'version', v_new_version,
    'mutation_version', v_new_version,
    'updated_at', v_updated_at
  );
end;
$$;

revoke execute on function public.mutate_account_protection_list(
  uuid, text, text, text[], text[], text[], text, uuid, text, text, bigint, text
) from public, anon, authenticated;
grant execute on function public.mutate_account_protection_list(
  uuid, text, text, text[], text[], text[], text, uuid, text, text, bigint, text
) to service_role;

notify pgrst, 'reload schema';
