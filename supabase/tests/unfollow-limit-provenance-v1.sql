\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;

create table public.ig_accounts (
  id uuid primary key,
  username text not null,
  created_at timestamptz not null
);

create table public.ig_account_unfollow_settings (
  account_id uuid primary key references public.ig_accounts(id) on delete cascade,
  unfollow_per_session_limit integer not null default 50,
  unfollow_per_day_limit integer not null default 200,
  package_default_snapshot jsonb not null default '{}'::jsonb,
  runtime_cap_mode text not null default 'prod_normal',
  runtime_safety_cap integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.account_package_summary (
  account_id uuid primary key references public.ig_accounts(id),
  package_caps jsonb not null
);

create table public.client_instagram_onboarding_sessions (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id),
  status text not null,
  created_at timestamptz not null
);

create table public.account_package_runtime_contract_events (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id),
  event_type text not null,
  source text not null,
  details_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create table public.ig_action_logs (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id),
  action_type text not null,
  status text not null,
  created_at timestamptz not null
);

create function public.reconcile_account_package_runtime_contract(
  p_account_id uuid,
  p_source text default 'canonical_reconcile'
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'account_id', p_account_id, 'source', p_source)
$$;

insert into public.ig_accounts (id, username, created_at) values
  ('10000000-0000-4000-8000-000000000001', 'canonical_default_drift', '2026-08-09T22:00:13Z'),
  ('10000000-0000-4000-8000-000000000002', 'ambiguous_legacy_lower', '2026-07-01T00:00:00Z'),
  ('10000000-0000-4000-8000-000000000003', 'package_exact', '2026-08-09T22:00:13Z');

insert into public.account_package_summary (account_id, package_caps) values
  ('10000000-0000-4000-8000-000000000001', '{"unfollow_day":80,"unfollow_session":80}'),
  ('10000000-0000-4000-8000-000000000002', '{"unfollow_day":80,"unfollow_session":80}'),
  ('10000000-0000-4000-8000-000000000003', '{"unfollow_day":80,"unfollow_session":80}');

insert into public.ig_account_unfollow_settings (
  account_id, unfollow_per_session_limit, unfollow_per_day_limit,
  package_default_snapshot, runtime_cap_mode, runtime_safety_cap,
  created_at, updated_at
) values
  (
    '10000000-0000-4000-8000-000000000001', 50, 80,
    '{"source":"commercial_packages","package_code":"growth","unfollow_day":80,"unfollow_session":80}',
    'prod_normal', null, '2026-08-09T22:00:13Z', '2026-08-09T22:09:14Z'
  ),
  (
    '10000000-0000-4000-8000-000000000002', 50, 80,
    '{"source":"commercial_packages","package_code":"growth","unfollow_day":80,"unfollow_session":80}',
    'prod_normal', null, '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000003', 80, 80,
    '{"source":"commercial_packages","package_code":"growth","unfollow_day":80,"unfollow_session":80}',
    'prod_normal', null, '2026-08-09T22:00:13Z', '2026-08-09T22:09:14Z'
  );

insert into public.client_instagram_onboarding_sessions (id, account_id, status, created_at) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'completed', '2026-08-09T22:00:13Z');

insert into public.account_package_runtime_contract_events (
  id, account_id, event_type, source, details_safe, created_at
) values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'package_runtime_contract_reconciled',
  'assignment_trigger',
  '{"override_policy":"positive_account_override_lte_package"}',
  '2026-08-09T22:09:14Z'
);

\ir ../migrations/20260810010000_unfollow_limit_provenance_and_canonical_onboarding_defaults_v1.sql

do $$
begin
  if (select unfollow_per_session_limit from public.ig_account_unfollow_settings
      where account_id = '10000000-0000-4000-8000-000000000001') <> 80 then
    raise exception 'canonical_onboarding_schema_default_not_repaired';
  end if;
  if exists (select 1 from public.ig_account_unfollow_limit_overrides
             where account_id = '10000000-0000-4000-8000-000000000001') then
    raise exception 'canonical_onboarding_contamination_became_override';
  end if;
  if (select unfollow_per_session_limit from public.ig_account_unfollow_settings
      where account_id = '10000000-0000-4000-8000-000000000002') <> 50 then
    raise exception 'ambiguous_legacy_lower_value_not_preserved';
  end if;
  if (select classification from public.ig_account_unfollow_limit_overrides
      where account_id = '10000000-0000-4000-8000-000000000002') <> 'legacy_unclassified' then
    raise exception 'ambiguous_legacy_provenance_missing';
  end if;
end $$;

select public.set_account_unfollow_limit_override_v1(
  '10000000-0000-4000-8000-000000000001', 40, 40,
  'admin', 'instagram_dashboard_settings', null, 'test_explicit_override'
);

do $$
begin
  if (select classification from public.ig_account_unfollow_limit_overrides
      where account_id = '10000000-0000-4000-8000-000000000001') <> 'explicit'
     or (select unfollow_per_session_limit from public.ig_account_unfollow_settings
         where account_id = '10000000-0000-4000-8000-000000000001') <> 40 then
    raise exception 'explicit_override_not_applied';
  end if;
end $$;

select public.set_account_unfollow_limit_override_v1(
  '10000000-0000-4000-8000-000000000001', 80, 80,
  'admin', 'instagram_dashboard_settings', null, 'test_return_to_package'
);

do $$
begin
  if exists (select 1 from public.ig_account_unfollow_limit_overrides
             where account_id = '10000000-0000-4000-8000-000000000001')
     or (select unfollow_per_session_limit from public.ig_account_unfollow_settings
         where account_id = '10000000-0000-4000-8000-000000000001') <> 80 then
    raise exception 'return_to_package_inheritance_failed';
  end if;
  if has_function_privilege('anon', 'public.set_account_unfollow_limit_override_v1(uuid,integer,integer,text,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.set_account_unfollow_limit_override_v1(uuid,integer,integer,text,text,uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.set_account_unfollow_limit_override_v1(uuid,integer,integer,text,text,uuid,text)', 'EXECUTE') then
    raise exception 'rpc_grants_invalid';
  end if;
  if not (select relrowsecurity and relforcerowsecurity
          from pg_class where oid = 'public.ig_account_unfollow_limit_overrides'::regclass) then
    raise exception 'rls_contract_invalid';
  end if;
end $$;

\ir ../rollback/20260810010000_unfollow_limit_provenance_and_canonical_onboarding_defaults_v1.down.sql

do $$
begin
  if to_regclass('public.ig_account_unfollow_limit_overrides') is not null then
    raise exception 'rollback_table_remains';
  end if;
  if to_regprocedure('public.reconcile_account_package_runtime_contract(uuid,text)') is null then
    raise exception 'rollback_canonical_reconciler_missing';
  end if;
end $$;

select 'unfollow_limit_provenance_v1_ok' as result;
