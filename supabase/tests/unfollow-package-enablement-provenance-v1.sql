\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;

create table public.ig_accounts (
  id uuid primary key,
  username text not null
);

create table public.package_state (
  account_id uuid primary key references public.ig_accounts(id),
  package_code text not null,
  package_caps jsonb not null,
  active boolean not null default true
);

create view public.account_package_summary as
select account_id, package_code, package_caps
from public.package_state
where active;

create table public.ig_account_unfollow_settings (
  account_id uuid primary key references public.ig_accounts(id),
  unfollow_enabled boolean not null default false,
  unfollow_mode text not null default 'unfollow',
  unfollow_per_session_limit integer not null,
  unfollow_per_day_limit integer not null,
  unfollow_after_days integer not null default 3,
  updated_at timestamptz not null default now()
);

create table public.ig_account_settings (
  account_id uuid primary key references public.ig_accounts(id),
  app_package text,
  follow_enabled boolean not null default true,
  like_enabled boolean not null default true,
  mute_posts_after_follow boolean not null default true,
  mute_stories_after_follow boolean not null default true,
  welcome_dm_enabled boolean not null default false,
  cold_dm_enabled boolean not null default false,
  unfollow_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.ig_account_dm_settings (
  account_id uuid primary key references public.ig_accounts(id),
  welcome_enabled boolean not null default false,
  outreach_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.phone_app_instances (
  id uuid primary key,
  device_id uuid not null,
  package_name text not null
);

create table public.account_assignments (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id),
  app_instance_id uuid not null references public.phone_app_instances(id),
  status text not null,
  released_at timestamptz,
  assigned_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.ig_action_logs (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id),
  action_type text not null,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.account_package_runtime_contract_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id),
  event_type text not null,
  source text not null,
  details_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function public.reconcile_account_package_runtime_contract(
  p_account_id uuid,
  p_source text default 'canonical_reconcile'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.account_package_summary where account_id = p_account_id) then
    raise exception 'package_settings_incomplete';
  end if;
  return jsonb_build_object('ok', true, 'source', p_source);
end;
$$;

insert into public.ig_accounts (id, username) values
  ('10000000-0000-4000-8000-000000000001', 'growth_default_false'),
  ('10000000-0000-4000-8000-000000000002', 'pro_explicit_false'),
  ('10000000-0000-4000-8000-000000000003', 'premium_explicit_true'),
  ('10000000-0000-4000-8000-000000000004', 'growth_healthy_true'),
  ('10000000-0000-4000-8000-000000000005', 'growth_cancel_reactivate');

insert into public.package_state (account_id, package_code, package_caps) values
  ('10000000-0000-4000-8000-000000000001', 'growth',  '{"unfollow_day":80,"unfollow_session":80}'),
  ('10000000-0000-4000-8000-000000000002', 'pro',     '{"unfollow_day":120,"unfollow_session":120}'),
  ('10000000-0000-4000-8000-000000000003', 'premium', '{"unfollow_day":120,"unfollow_session":120}'),
  ('10000000-0000-4000-8000-000000000004', 'growth',  '{"unfollow_day":80,"unfollow_session":80}'),
  ('10000000-0000-4000-8000-000000000005', 'growth',  '{"unfollow_day":80,"unfollow_session":80}');

insert into public.ig_account_unfollow_settings (
  account_id, unfollow_enabled, unfollow_per_session_limit, unfollow_per_day_limit
) values
  ('10000000-0000-4000-8000-000000000001', false, 40, 80),
  ('10000000-0000-4000-8000-000000000002', false, 50, 120),
  ('10000000-0000-4000-8000-000000000003', false, 60, 120),
  ('10000000-0000-4000-8000-000000000004', true,  30, 80),
  ('10000000-0000-4000-8000-000000000005', false, 20, 80);

insert into public.ig_account_settings (account_id, unfollow_enabled)
select account_id, unfollow_enabled from public.ig_account_unfollow_settings;

insert into public.ig_account_dm_settings (account_id)
select id from public.ig_accounts;

-- Only these audit events prove explicit human intent. The invalid actor UUID
-- also certifies that historical no-leak audit payloads cannot abort migration.
insert into public.ig_action_logs (id, account_id, action_type, status, payload, created_at) values
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'unfollow_domain_settings_saved', 'success',
    '{"actor_id":"not-a-uuid","source_surface":"instagram_dashboard_settings","fields_changed":["unfollow_enabled"],"new_summary":{"unfollow_enabled":false}}',
    '2026-08-17T10:00:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    'unfollow_domain_settings_saved', 'success',
    '{"fields_changed":["unfollow_enabled"],"new_summary":{"unfollow_enabled":true}}',
    '2026-08-17T11:00:00Z'
  );

\ir ../migrations/20260818130124_unfollow_package_enablement_provenance_v1.sql

do $$
begin
  if not (select unfollow_enabled from public.ig_account_unfollow_settings where account_id = '10000000-0000-4000-8000-000000000001') then
    raise exception 'growth_package_default_not_enabled';
  end if;
  if (select unfollow_per_session_limit from public.ig_account_unfollow_settings where account_id = '10000000-0000-4000-8000-000000000001') <> 40 then
    raise exception 'explicit_lower_cap_was_changed';
  end if;
  if (select unfollow_enabled from public.ig_account_unfollow_settings where account_id = '10000000-0000-4000-8000-000000000002') then
    raise exception 'explicit_disable_not_preserved';
  end if;
  if not (select unfollow_enabled from public.ig_account_unfollow_settings where account_id = '10000000-0000-4000-8000-000000000003') then
    raise exception 'explicit_enable_not_preserved';
  end if;
  if not (select unfollow_enabled from public.ig_account_unfollow_settings where account_id = '10000000-0000-4000-8000-000000000004') then
    raise exception 'healthy_account_changed';
  end if;
  if exists (
    select 1 from public.ig_account_unfollow_enablement_overrides
    where account_id in ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004')
  ) then
    raise exception 'package_default_misclassified_as_override';
  end if;
end;
$$;

-- New accounts of every supported package inherit true without an override.
insert into public.ig_accounts (id, username) values
  ('10000000-0000-4000-8000-000000000006', 'new_growth'),
  ('10000000-0000-4000-8000-000000000007', 'new_pro'),
  ('10000000-0000-4000-8000-000000000008', 'new_premium');
insert into public.package_state (account_id, package_code, package_caps) values
  ('10000000-0000-4000-8000-000000000006', 'growth',  '{"unfollow_day":80,"unfollow_session":80}'),
  ('10000000-0000-4000-8000-000000000007', 'pro',     '{"unfollow_day":120,"unfollow_session":120}'),
  ('10000000-0000-4000-8000-000000000008', 'premium', '{"unfollow_day":120,"unfollow_session":120}');
insert into public.ig_account_unfollow_settings (account_id, unfollow_enabled, unfollow_per_session_limit, unfollow_per_day_limit) values
  ('10000000-0000-4000-8000-000000000006', false, 80, 80),
  ('10000000-0000-4000-8000-000000000007', false, 120, 120),
  ('10000000-0000-4000-8000-000000000008', false, 120, 120);
insert into public.ig_account_settings (account_id, unfollow_enabled) select id, false from public.ig_accounts where id in (
  '10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000008'
);
select public.apply_account_unfollow_enablement_provenance_v1(account_id)
from public.package_state
where account_id in (
  '10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000008'
);

do $$
begin
  if exists (
    select 1 from public.ig_account_unfollow_settings
    where account_id in ('10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000008')
      and not unfollow_enabled
  ) then
    raise exception 'future_package_inheritance_failed';
  end if;
end;
$$;

-- Upgrade and downgrade only alter capability inputs; enablement remains
-- inherited and the helper never changes limits or after_days.
update public.package_state
set package_code = 'premium', package_caps = '{"unfollow_day":120,"unfollow_session":120}'
where account_id = '10000000-0000-4000-8000-000000000001';
select public.apply_account_unfollow_enablement_provenance_v1('10000000-0000-4000-8000-000000000001');
update public.package_state
set package_code = 'growth', package_caps = '{"unfollow_day":80,"unfollow_session":80}'
where account_id = '10000000-0000-4000-8000-000000000001';
select public.apply_account_unfollow_enablement_provenance_v1('10000000-0000-4000-8000-000000000001');

do $$
begin
  if (select unfollow_per_session_limit from public.ig_account_unfollow_settings where account_id = '10000000-0000-4000-8000-000000000001') <> 40
     or (select unfollow_after_days from public.ig_account_unfollow_settings where account_id = '10000000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'upgrade_downgrade_changed_unrelated_settings';
  end if;
end;
$$;

-- Cancellation removes capability; reactivation restores inheritance. An
-- explicit disable remains disabled across the same lifecycle.
update public.package_state set active = false where account_id = '10000000-0000-4000-8000-000000000005';
select public.apply_account_unfollow_enablement_provenance_v1('10000000-0000-4000-8000-000000000005');
do $$ begin
  if (select unfollow_enabled from public.ig_account_unfollow_settings where account_id = '10000000-0000-4000-8000-000000000005') then
    raise exception 'cancel_did_not_disable_capability';
  end if;
end $$;
update public.package_state set active = true where account_id = '10000000-0000-4000-8000-000000000005';
select public.apply_account_unfollow_enablement_provenance_v1('10000000-0000-4000-8000-000000000005');
do $$ begin
  if not (select unfollow_enabled from public.ig_account_unfollow_settings where account_id = '10000000-0000-4000-8000-000000000005')
     or (select unfollow_enabled from public.ig_account_unfollow_settings where account_id = '10000000-0000-4000-8000-000000000002') then
    raise exception 'reactivation_or_explicit_disable_contract_failed';
  end if;
end $$;

-- Provisioning sync must no longer reset inherited Unfollow to false.
insert into public.phone_app_instances (id, device_id, package_name) values
  ('30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'com.instagram.android');
insert into public.account_assignments (id, account_id, app_instance_id, status, assigned_at) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'active', now());
select public.sync_instagram_account_runtime_settings_after_provisioning('10000000-0000-4000-8000-000000000001');
do $$ begin
  if not (select unfollow_enabled from public.ig_account_unfollow_settings where account_id = '10000000-0000-4000-8000-000000000001') then
    raise exception 'provisioning_reset_inherited_enablement';
  end if;
end $$;

-- Idempotence includes keeping updated_at stable when effective state is stable.
create temp table enablement_state_before_second_run as
select account_id, unfollow_enabled, unfollow_per_session_limit, unfollow_per_day_limit, unfollow_after_days, updated_at
from public.ig_account_unfollow_settings;
\ir ../migrations/20260818130124_unfollow_package_enablement_provenance_v1.sql
do $$ begin
  if exists (
    select 1
    from public.ig_account_unfollow_settings u
    join enablement_state_before_second_run b using (account_id)
    where row(u.unfollow_enabled, u.unfollow_per_session_limit, u.unfollow_per_day_limit, u.unfollow_after_days, u.updated_at)
      is distinct from row(b.unfollow_enabled, b.unfollow_per_session_limit, b.unfollow_per_day_limit, b.unfollow_after_days, b.updated_at)
  ) then
    raise exception 'second_migration_execution_changed_state';
  end if;
  if has_function_privilege('anon', 'public.set_account_unfollow_enablement_override_v1(uuid,boolean,text,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.set_account_unfollow_enablement_override_v1(uuid,boolean,text,text,uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.set_account_unfollow_enablement_override_v1(uuid,boolean,text,text,uuid,text)', 'EXECUTE') then
    raise exception 'enablement_rpc_grants_invalid';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.ig_account_unfollow_enablement_overrides'::regclass) then
    raise exception 'enablement_override_rls_invalid';
  end if;
end $$;

select 'unfollow_package_enablement_provenance_v1_ok' as result;
