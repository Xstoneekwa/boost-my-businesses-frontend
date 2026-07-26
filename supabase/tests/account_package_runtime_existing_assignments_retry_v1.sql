\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end;
$roles$;

create table public.ig_accounts (
  id uuid primary key,
  username text not null,
  status text not null default 'active',
  clone_mode text,
  device_name text,
  archived_at timestamptz,
  trashed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.phone_devices (
  id uuid primary key,
  name text,
  device_name text
);

create table public.phone_app_instances (
  id uuid primary key,
  device_id uuid not null,
  package_name text not null,
  instance_type text not null,
  instance_index integer not null default 0,
  is_launchable boolean not null default true,
  usable_for_auto_login boolean not null default true
);

create table public.account_assignments (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id),
  device_id uuid,
  app_instance_id uuid references public.phone_app_instances(id),
  status text not null,
  assignment_type text not null,
  schedule_mode text not null,
  slot_kind text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.account_run_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id),
  requested_by uuid,
  actor_type text,
  source_surface text not null,
  requested_run_type text not null,
  idempotency_key text not null unique,
  priority integer not null default 0,
  metadata_safe jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  error_code text,
  run_id uuid,
  created_at timestamptz not null default now()
);

create table public.commercial_package_runtime_settings (
  package_code text primary key,
  max_follows_per_target_per_run integer not null,
  max_targets_per_run integer not null,
  likes_per_follow_min integer not null,
  likes_per_follow_max integer not null,
  likes_per_day_limit integer not null
);

create table public.ig_account_settings (
  account_id uuid primary key references public.ig_accounts(id),
  app_package text,
  clone_mode text,
  cloned_app_mode boolean,
  max_actions_per_day integer,
  follow_limit integer,
  max_follow_per_run integer,
  likes_per_follow_min integer,
  likes_per_follow_max integer,
  total_likes_limit integer,
  manual_stop_requested boolean not null default false,
  dry_run_enabled boolean not null default false,
  send_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.account_follow_source_settings (
  account_id uuid primary key references public.ig_accounts(id),
  max_follows_per_target_per_run integer,
  max_targets_per_run integer,
  updated_at timestamptz not null default now()
);

create table public.ig_account_unfollow_settings (
  account_id uuid primary key references public.ig_accounts(id),
  unfollow_enabled boolean not null default true,
  unfollow_after_days integer not null default 7,
  unfollow_per_session_limit integer,
  unfollow_per_day_limit integer,
  updated_at timestamptz not null default now()
);

create table public.ig_account_dm_settings (
  account_id uuid primary key references public.ig_accounts(id),
  welcome_enabled boolean not null default true,
  outreach_enabled boolean not null default true,
  welcome_per_session_limit integer,
  welcome_per_day_limit integer,
  outreach_per_session_limit integer,
  outreach_per_day_limit integer,
  total_dm_per_day_limit integer,
  updated_at timestamptz not null default now()
);

create table public.client_account_entitlements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id),
  commercial_package_code text,
  status text not null,
  outreach_addon_key text,
  outreach_variant text,
  backend_addon_code text,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.client_subscriptions (
  id uuid primary key,
  status text not null,
  subscription_type text not null,
  starts_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.client_subscription_accounts (
  subscription_id uuid not null references public.client_subscriptions(id),
  account_id uuid not null references public.ig_accounts(id),
  status text not null
);

create table public.account_commercial_packages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.ig_accounts(id),
  package_code text not null,
  status text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.auto_restart_device_locks (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null,
  lease_expires_at timestamptz not null
);

create table public.package_summary_fixture (
  account_id uuid primary key references public.ig_accounts(id),
  commercial_package_code text not null,
  package_caps jsonb not null,
  effective_caps_preview jsonb not null,
  runtime_profiles jsonb not null
);

create view public.account_package_summary as
select * from public.package_summary_fixture;

create function public.account_has_active_ig_run(p_account_id uuid)
returns boolean language sql stable as $$ select false $$;

create function public.create_account_run_request(
  p_account_id uuid,
  p_requested_by uuid,
  p_actor_type text,
  p_source_surface text,
  p_requested_run_type text,
  p_idempotency_key text,
  p_priority integer,
  p_metadata_safe jsonb
)
returns public.account_run_requests
language plpgsql
as $function$
declare v_row public.account_run_requests%rowtype;
begin
  select * into v_row from public.account_run_requests where idempotency_key = p_idempotency_key;
  if v_row.id is not null then return v_row; end if;
  insert into public.account_run_requests (
    account_id, requested_by, actor_type, source_surface, requested_run_type,
    idempotency_key, priority, metadata_safe
  ) values (
    p_account_id, p_requested_by, p_actor_type, p_source_surface, p_requested_run_type,
    p_idempotency_key, p_priority, p_metadata_safe
  ) returning * into v_row;
  return v_row;
end;
$function$;

-- Test double for the exact materializer installed by the previous migration.
create function public.reconcile_account_package_runtime_contract(
  p_account_id uuid,
  p_source text default 'canonical_reconcile'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_assignment public.account_assignments%rowtype;
  v_instance public.phone_app_instances%rowtype;
  v_package_code text;
  v_caps jsonb;
  v_runtime public.commercial_package_runtime_settings%rowtype;
  v_clone text;
begin
  select * into v_assignment from public.account_assignments
  where account_id = p_account_id and status in ('pending','reserved','active')
  order by updated_at desc limit 1;
  select * into v_instance from public.phone_app_instances where id = v_assignment.app_instance_id;
  select commercial_package_code, package_caps into v_package_code, v_caps
  from public.account_package_summary where account_id = p_account_id;
  select * into v_runtime from public.commercial_package_runtime_settings where package_code = v_package_code;
  v_clone := case when v_instance.instance_index = 0 then 'off' else 'clone_' || v_instance.instance_index::text end;

  insert into public.ig_account_settings (
    account_id, app_package, clone_mode, cloned_app_mode, max_actions_per_day,
    follow_limit, max_follow_per_run, likes_per_follow_min, likes_per_follow_max,
    total_likes_limit
  ) values (
    p_account_id, v_instance.package_name, v_clone, v_clone <> 'off',
    (v_caps->>'follow_day')::integer, (v_caps->>'follow_session')::integer,
    (v_caps->>'follow_session')::integer, v_runtime.likes_per_follow_min,
    v_runtime.likes_per_follow_max, v_runtime.likes_per_day_limit
  ) on conflict (account_id) do update set
    app_package = excluded.app_package, clone_mode = excluded.clone_mode,
    cloned_app_mode = excluded.cloned_app_mode,
    max_actions_per_day = excluded.max_actions_per_day,
    follow_limit = excluded.follow_limit, max_follow_per_run = excluded.max_follow_per_run,
    likes_per_follow_min = excluded.likes_per_follow_min,
    likes_per_follow_max = excluded.likes_per_follow_max,
    total_likes_limit = excluded.total_likes_limit, updated_at = now();

  insert into public.account_follow_source_settings (
    account_id, max_follows_per_target_per_run, max_targets_per_run
  ) values (p_account_id, v_runtime.max_follows_per_target_per_run, v_runtime.max_targets_per_run)
  on conflict (account_id) do update set
    max_follows_per_target_per_run = excluded.max_follows_per_target_per_run,
    max_targets_per_run = excluded.max_targets_per_run, updated_at = now();

  insert into public.ig_account_unfollow_settings (
    account_id, unfollow_per_day_limit, unfollow_per_session_limit
  ) values (p_account_id, (v_caps->>'unfollow_day')::integer, (v_caps->>'unfollow_session')::integer)
  on conflict (account_id) do update set
    unfollow_per_day_limit = excluded.unfollow_per_day_limit,
    unfollow_per_session_limit = excluded.unfollow_per_session_limit, updated_at = now();

  insert into public.ig_account_dm_settings (
    account_id, welcome_enabled, outreach_enabled, welcome_per_day_limit,
    welcome_per_session_limit, outreach_per_day_limit, outreach_per_session_limit,
    total_dm_per_day_limit
  ) values (p_account_id, true, true, 10, 5, 30, 5, 40)
  on conflict (account_id) do update set
    welcome_enabled = excluded.welcome_enabled, outreach_enabled = excluded.outreach_enabled,
    welcome_per_day_limit = excluded.welcome_per_day_limit,
    welcome_per_session_limit = excluded.welcome_per_session_limit,
    outreach_per_day_limit = excluded.outreach_per_day_limit,
    outreach_per_session_limit = excluded.outreach_per_session_limit,
    total_dm_per_day_limit = excluded.total_dm_per_day_limit, updated_at = now();

  return jsonb_build_object('ok', true, 'source', p_source);
end;
$function$;

insert into public.commercial_package_runtime_settings values ('growth', 30, 4, 0, 2, 100);

insert into public.ig_accounts (id, username) values
  ('00000000-0000-0000-0000-000000000001', 'legacy_active'),
  ('00000000-0000-0000-0000-000000000002', 'missing_settings'),
  ('00000000-0000-0000-0000-000000000003', 'archived_account'),
  ('00000000-0000-0000-0000-000000000004', 'legacy_subscription_without_checkout_entitlement');
update public.ig_accounts set status = 'archived', archived_at = now()
where id = '00000000-0000-0000-0000-000000000003';

insert into public.phone_app_instances values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'com.instagram.android', 'primary_app', 0, true, true),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'com.instagram.clone', 'clone', 2, true, true),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'com.instagram.archived', 'clone', 3, true, true),
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'com.instagram.legacyclone', 'clone', 1, true, true);

insert into public.phone_devices values
  ('20000000-0000-0000-0000-000000000001', 'phone-1', 'phone-1'),
  ('20000000-0000-0000-0000-000000000002', 'phone-2', 'phone-2'),
  ('20000000-0000-0000-0000-000000000003', 'phone-3', 'phone-3'),
  ('20000000-0000-0000-0000-000000000004', 'phone-4', 'phone-4');

insert into public.account_assignments (
  id, account_id, device_id, app_instance_id, status, assignment_type,
  schedule_mode, slot_kind, starts_at, ends_at
) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'reserved', 'full_cycle', 'scheduled', 'full_cycle_6h', now() - interval '5 minutes', now() + interval '1 hour'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'reserved', 'full_cycle', 'scheduled', 'full_cycle_6h', now() - interval '5 minutes', now() + interval '1 hour'),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'reserved', 'full_cycle', 'scheduled', 'full_cycle_6h', now() - interval '5 minutes', now() + interval '1 hour'),
  ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'reserved', 'full_cycle', 'manual_only', 'manual_only', null, null);

insert into public.package_summary_fixture
select id, 'growth', '{"follow_day":80,"follow_session":80,"unfollow_day":80,"unfollow_session":80}',
  '{"follow_day":80}', '{"full_cycle":true}' from public.ig_accounts;

insert into public.client_account_entitlements (account_id, commercial_package_code, status, consumed_at)
select id, 'growth', 'entitlement_consumed', now()
from public.ig_accounts
where id <> '00000000-0000-0000-0000-000000000004';

insert into public.client_subscriptions values
  ('40000000-0000-0000-0000-000000000001', 'active', 'full_cycle', now(), now());
insert into public.client_subscription_accounts
select '40000000-0000-0000-0000-000000000001', id, 'active' from public.ig_accounts;
insert into public.account_commercial_packages (account_id, package_code, status, starts_at, ends_at)
select id, 'growth', 'active', now(), null from public.ig_accounts;

insert into public.ig_account_settings (
  account_id, app_package, clone_mode, cloned_app_mode, max_actions_per_day,
  follow_limit, max_follow_per_run, likes_per_follow_min, likes_per_follow_max,
  total_likes_limit
) values
  ('00000000-0000-0000-0000-000000000001', 'wrong.package', 'clone_9', true, 120, 50, 10, 9, 9, 999),
  ('00000000-0000-0000-0000-000000000003', 'archived.value', 'clone_3', true, 999, 999, 999, 9, 9, 999),
  ('00000000-0000-0000-0000-000000000004', 'com.instagram.android', 'off', false, 80, 20, 1, 0, 2, 100);

insert into public.account_follow_source_settings values
  ('00000000-0000-0000-0000-000000000001', 99, 99, now()),
  ('00000000-0000-0000-0000-000000000003', 99, 99, now()),
  ('00000000-0000-0000-0000-000000000004', 30, 4, now());
insert into public.ig_account_unfollow_settings values
  ('00000000-0000-0000-0000-000000000001', true, 7, 50, 200, now()),
  ('00000000-0000-0000-0000-000000000003', true, 7, 999, 999, now()),
  ('00000000-0000-0000-0000-000000000004', true, 7, 80, 80, now());
insert into public.ig_account_dm_settings values
  ('00000000-0000-0000-0000-000000000001', true, true, 2, 5, 4, 20, 25, now()),
  ('00000000-0000-0000-0000-000000000003', true, true, 999, 999, 999, 999, 999, now()),
  ('00000000-0000-0000-0000-000000000004', true, true, 5, 10, 5, 30, 40, now());

\ir ../migrations/20260726111000_account_package_runtime_existing_assignments_retry_v1.sql

do $assert_backfill$
declare
  s public.ig_account_settings%rowtype;
  u public.ig_account_unfollow_settings%rowtype;
  d public.ig_account_dm_settings%rowtype;
  f public.account_follow_source_settings%rowtype;
  status jsonb;
  second jsonb;
begin
  select * into s from public.ig_account_settings where account_id = '00000000-0000-0000-0000-000000000001';
  select * into u from public.ig_account_unfollow_settings where account_id = s.account_id;
  select * into d from public.ig_account_dm_settings where account_id = s.account_id;
  select * into f from public.account_follow_source_settings where account_id = s.account_id;
  if (s.max_actions_per_day, s.follow_limit, s.max_follow_per_run) is distinct from (80, 50, 10) then
    raise exception 'Follow reconciliation failed: %/%/%', s.max_actions_per_day, s.follow_limit, s.max_follow_per_run;
  end if;
  if (u.unfollow_per_day_limit, u.unfollow_per_session_limit) is distinct from (80, 50) then
    raise exception 'Unfollow reconciliation failed: %/%', u.unfollow_per_day_limit, u.unfollow_per_session_limit;
  end if;
  if (f.max_follows_per_target_per_run, f.max_targets_per_run) is distinct from (30, 4) then
    raise exception 'source exact fields failed';
  end if;
  if (s.likes_per_follow_min, s.likes_per_follow_max, s.total_likes_limit) is distinct from (0, 2, 100) then
    raise exception 'Like exact fields failed';
  end if;
  if (d.welcome_per_day_limit, d.welcome_per_session_limit, d.outreach_per_day_limit, d.outreach_per_session_limit, d.total_dm_per_day_limit)
      is distinct from (5, 2, 20, 4, 25) then
    raise exception 'DM lower overrides failed: %', row_to_json(d);
  end if;
  status := public.account_package_runtime_contract_status(s.account_id);
  if not coalesce((status->>'ok')::boolean, false) then raise exception 'contract not ready: %', status; end if;
  second := public.reconcile_account_package_runtime_contract(s.account_id, 'idempotency_check');
  if coalesce((second->>'changed')::boolean, true) then raise exception 'second reconcile was not a no-op'; end if;
  if not exists (select 1 from public.ig_account_settings where account_id = '00000000-0000-0000-0000-000000000002') then
    raise exception 'missing settings row was not initialized';
  end if;
  if (select max_actions_per_day from public.ig_account_settings where account_id = '00000000-0000-0000-0000-000000000003') <> 999 then
    raise exception 'archived account was modified';
  end if;
  status := public.account_package_runtime_contract_status('00000000-0000-0000-0000-000000000004');
  if not coalesce((status->>'ok')::boolean, false)
     or status->>'entitlement_source' <> 'legacy_active_subscription_package' then
    raise exception 'legacy subscription provenance was not certified: %', status;
  end if;
  if exists (
    select 1 from public.client_account_entitlements
    where account_id = '00000000-0000-0000-0000-000000000004'
  ) then
    raise exception 'legacy subscription reconciliation invented an entitlement';
  end if;
  if (
    select (app_package, clone_mode, cloned_app_mode)
    from public.ig_account_settings
    where account_id = '00000000-0000-0000-0000-000000000004'
  ) is distinct from row('com.instagram.legacyclone'::text, 'clone_1'::text, true) then
    raise exception 'legacy assignment/app binding was not reconciled';
  end if;
end;
$assert_backfill$;

-- A future invalid settings write is corrected by the generic trigger.
update public.ig_account_settings set follow_limit = 999
where account_id = '00000000-0000-0000-0000-000000000001';

do $assert_future_trigger$
begin
  if (select follow_limit from public.ig_account_settings where account_id = '00000000-0000-0000-0000-000000000001') <> 80 then
    raise exception 'future settings trigger did not clamp invalid value';
  end if;
end;
$assert_future_trigger$;

-- Downgrade clamps invalid values; a later upgrade preserves the lower caps.
update public.package_summary_fixture
set package_caps = '{"follow_day":40,"follow_session":40,"unfollow_day":40,"unfollow_session":40}',
    effective_caps_preview = '{"follow_day":40}'
where account_id = '00000000-0000-0000-0000-000000000001';
select public.reconcile_account_package_runtime_contract('00000000-0000-0000-0000-000000000001', 'downgrade_test');

do $assert_downgrade$
begin
  if (select (max_actions_per_day, follow_limit, max_follow_per_run) from public.ig_account_settings where account_id = '00000000-0000-0000-0000-000000000001')
     is distinct from row(40, 40, 10) then raise exception 'downgrade failed'; end if;
end;
$assert_downgrade$;

update public.package_summary_fixture
set package_caps = '{"follow_day":80,"follow_session":80,"unfollow_day":80,"unfollow_session":80}',
    effective_caps_preview = '{"follow_day":80}'
where account_id = '00000000-0000-0000-0000-000000000001';
select public.reconcile_account_package_runtime_contract('00000000-0000-0000-0000-000000000001', 'upgrade_test');

do $assert_upgrade$
begin
  if (select (max_actions_per_day, follow_limit, max_follow_per_run) from public.ig_account_settings where account_id = '00000000-0000-0000-0000-000000000001')
     is distinct from row(40, 40, 10) then raise exception 'upgrade overwrote lower overrides'; end if;
end;
$assert_upgrade$;

insert into public.account_run_requests (
  id, account_id, source_surface, requested_run_type, idempotency_key, status, error_code
) values (
  '50000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'instagram_schedule_session_cron', 'account_session',
  'schedule-session:30000000-0000-0000-0000-000000000001:test-window',
  'blocked', 'package_settings_incomplete'
);

select public.create_schedule_session_pre_run_retry_v1(
  '00000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  (select starts_at from public.account_assignments where id = '30000000-0000-0000-0000-000000000001'),
  (select ends_at from public.account_assignments where id = '30000000-0000-0000-0000-000000000001'),
  'schedule-session:30000000-0000-0000-0000-000000000001:test-window',
  'postgres_test', 'Africa/Johannesburg', 1, 600
);

select public.create_schedule_session_pre_run_retry_v1(
  '00000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  (select starts_at from public.account_assignments where id = '30000000-0000-0000-0000-000000000001'),
  (select ends_at from public.account_assignments where id = '30000000-0000-0000-0000-000000000001'),
  'schedule-session:30000000-0000-0000-0000-000000000001:test-window',
  'postgres_test', 'Africa/Johannesburg', 1, 600
);

do $assert_retry$
declare retry_count integer;
begin
  select count(*) into retry_count from public.account_run_requests
  where metadata_safe->>'retry_of_request_id' = '50000000-0000-0000-0000-000000000001';
  if retry_count <> 1 then raise exception 'retry idempotency failed: %', retry_count; end if;
  if (select status from public.account_run_requests where id = '50000000-0000-0000-0000-000000000001') <> 'blocked' then
    raise exception 'historical request was mutated';
  end if;
  if has_function_privilege('anon', 'public.create_schedule_session_pre_run_retry_v1(uuid,uuid,timestamptz,timestamptz,text,text,text,integer,integer)', 'EXECUTE') then
    raise exception 'anon retains retry RPC execute';
  end if;
  if has_function_privilege('authenticated', 'public.reconcile_account_package_runtime_contract(uuid,text)', 'EXECUTE') then
    raise exception 'authenticated retains reconcile execute';
  end if;
  if not has_function_privilege('service_role', 'public.create_schedule_session_pre_run_retry_v1(uuid,uuid,timestamptz,timestamptz,text,text,text,integer,integer)', 'EXECUTE') then
    raise exception 'service_role missing retry execute';
  end if;
end;
$assert_retry$;

select 'POSTGRES_CONTRACT_RETRY_CERTIFIED' as verdict;
