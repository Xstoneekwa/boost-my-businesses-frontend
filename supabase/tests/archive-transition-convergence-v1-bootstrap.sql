create schema if not exists extensions;
create schema if not exists auth;
create extension if not exists pgcrypto with schema extensions;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
do $$ begin create role archive_transition_attacker nologin; exception when duplicate_object then null; end $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user) $$;
create or replace function public.ct_assert_service_role_v1() returns void language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' and not pg_has_role(current_user,'service_role','member') then
    raise exception 'service_role_required' using errcode='42501';
  end if;
end $$;

create table public.clients(id uuid primary key);
create table public.ig_accounts(id uuid primary key);
create table public.client_instagram_accounts(
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  account_id uuid not null references public.ig_accounts(id),
  active boolean not null default true,
  unique(client_id,account_id)
);
create table public.ig_targets(
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id),
  status text not null,
  archived_at timestamptz,
  deleted_at timestamptz,
  archive_reason text,
  updated_at timestamptz not null default now(),
  periodic_revalidation_next_due_at timestamptz,
  periodic_revalidation_window_key text,
  auto_archived_at timestamptz,
  last_error text,
  readd_blocked_until timestamptz,
  readd_blocked_permanently boolean not null default false,
  readd_block_reason text,
  readd_blocked_at timestamptz,
  verification_status text,
  verification_reason text,
  quality_status text,
  canonical_username text,
  avatar_url text,
  followers_count integer,
  is_verified boolean,
  is_private boolean,
  provider_checked_at timestamptz,
  rejected_reason text,
  metadata_safe jsonb not null default '{}'::jsonb,
  unique(account_id,id)
);
create table public.ct_target_availability_current(
  tenant_id uuid not null,
  account_id uuid not null,
  target_id uuid not null,
  availability_status text,
  confidence text,
  identity_status text,
  confirmed_at timestamptz,
  valid_until timestamptz,
  primary key(tenant_id,account_id,target_id)
);
create table public.ct_target_lifecycle_assessments(
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.clients(id),
  account_id uuid not null references public.ig_accounts(id),
  target_id uuid not null references public.ig_targets(id),
  assessment_key text not null,
  status text not null,
  utilization_ratio numeric,
  unique_profiles_evaluated integer not null,
  estimated_exploitable_audience integer,
  denominator_source text not null,
  denominator_version text not null,
  confidence text not null,
  reason_codes text[] not null default '{}',
  replacement_state text not null default 'none',
  assessed_at timestamptz not null,
  archived_at timestamptz,
  archive_reason text,
  explanation_safe jsonb not null default '{}'::jsonb,
  enforcement_allowed boolean not null default false,
  business_action_allowed boolean not null default false,
  mutation_executed boolean not null default false,
  constraint ct_target_lifecycle_assessments_counts_check
    check(unique_profiles_evaluated >= 0 and (estimated_exploitable_audience is null or estimated_exploitable_audience > 0)),
  unique(tenant_id,account_id,target_id,assessment_key)
);
create table public.ct_target_lifecycle_current(
  tenant_id uuid not null,
  account_id uuid not null,
  target_id uuid not null,
  assessment_id uuid not null unique references public.ct_target_lifecycle_assessments(id),
  status text,
  updated_at timestamptz not null default now(),
  primary key(tenant_id,account_id,target_id)
);

grant all on table public.client_instagram_accounts to service_role;
grant all on table public.ig_targets to service_role;
grant select, insert, update on table public.ct_target_availability_current to service_role;
grant select, insert on table public.ct_target_lifecycle_assessments to service_role;
grant select, insert, update on table public.ct_target_lifecycle_current to service_role;

-- Reproduce the relevant production RLS surface before installing the archive
-- candidate. These policies intentionally authorize service_role only; phase A
-- must fail until the scoped archive writer compatibility migration is applied.
alter table public.client_instagram_accounts enable row level security;
alter table public.ig_targets enable row level security;
alter table public.ct_target_availability_current enable row level security;
alter table public.ct_target_availability_current force row level security;
alter table public.ct_target_lifecycle_assessments enable row level security;
alter table public.ct_target_lifecycle_assessments force row level security;
alter table public.ct_target_lifecycle_current enable row level security;
alter table public.ct_target_lifecycle_current force row level security;

create policy client_instagram_accounts_service_role_all
  on public.client_instagram_accounts for all to public
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy ig_targets_service_role_all
  on public.ig_targets for all to public
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy ct_target_availability_current_service_role_all
  on public.ct_target_availability_current for all to service_role using (true) with check (true);
create policy ct_target_lifecycle_assessments_service_role_all
  on public.ct_target_lifecycle_assessments for all to service_role using (true) with check (true);
create policy ct_target_lifecycle_current_service_role_all
  on public.ct_target_lifecycle_current for all to service_role using (true) with check (true);

create function public.persist_target_lifecycle_shadow_v1(jsonb,text default null)
returns jsonb language sql as $$ select jsonb_build_object('outcome','processed','business_actions',0) $$;
create function public.ct_recompute_target_lifecycle_v1(uuid,uuid,integer,text,text,text,text,timestamptz default now())
returns jsonb language sql as $$ select jsonb_build_object('outcome','processed') $$;
create function public.rollback_test_instagram_onboarding_v1(uuid,uuid,uuid,text,uuid,text,text,text,text,boolean default true)
returns jsonb language sql security definer as $$ select jsonb_build_object('ok',true,'reason',case when $10 then 'dry_run_pass' else 'rolled_back' end) $$;

insert into public.clients values
 ('10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000001');
insert into public.ig_accounts values
 ('10000000-0000-4000-8000-000000000002'),
 ('20000000-0000-4000-8000-000000000002');
insert into public.client_instagram_accounts(client_id,account_id) values
 ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),
 ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002');
insert into public.ig_targets(id,account_id,status,quality_status) values
 ('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000002','active','eligible'),
 ('10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000002','active','eligible'),
 ('542b758f-004e-4e88-a381-dd441b60ad5e','10000000-0000-4000-8000-000000000002','archived','eligible'),
 ('20000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000002','active','eligible');

update public.ig_targets set archived_at='2026-08-01T12:00:00Z',archive_reason='dashboard_archive'
where id='542b758f-004e-4e88-a381-dd441b60ad5e';
insert into public.ct_target_lifecycle_assessments(
  tenant_id,account_id,target_id,assessment_key,status,utilization_ratio,
  unique_profiles_evaluated,estimated_exploitable_audience,denominator_source,denominator_version,
  confidence,assessed_at
) values (
  '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
  '542b758f-004e-4e88-a381-dd441b60ad5e','legacy-insufficient','insufficient_data',null,
  0,null,'legacy','v1','unknown','2026-08-01T11:00:00Z'
);
insert into public.ct_target_lifecycle_current(tenant_id,account_id,target_id,assessment_id,status)
select tenant_id,account_id,target_id,id,status from public.ct_target_lifecycle_assessments
where target_id='542b758f-004e-4e88-a381-dd441b60ad5e';
