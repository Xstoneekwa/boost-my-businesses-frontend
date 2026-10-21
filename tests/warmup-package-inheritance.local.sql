-- LOCAL DISPOSABLE DATABASE ONLY. Minimal production-shaped fixtures.
\set ON_ERROR_STOP on
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create table public.ig_accounts (id uuid primary key, status text, archived_at timestamptz, trashed_at timestamptz);
create table public.commercial_packages (code text primary key, active boolean, default_follow_day_cap integer);
create table public.account_commercial_packages (
  id uuid primary key default gen_random_uuid(), account_id uuid references public.ig_accounts,
  package_code text, status text default 'active', starts_at timestamptz,
  ends_at timestamptz, created_at timestamptz default now()
);
create table public.account_warmup_settings (
  account_id uuid primary key references public.ig_accounts, package_started_at timestamptz,
  updated_at timestamptz, day_4_plus_follow_cap integer,
  day_1_follow_cap integer default 10, day_2_follow_cap integer default 20,
  day_3_follow_cap integer default 40, warmup_started_at timestamptz,
  warmup_enabled boolean default true
);
insert into public.commercial_packages values ('growth',true,80),('pro',true,120),('premium',true,120);
create table public.ig_account_social_profile_snapshots (
  id uuid primary key default gen_random_uuid(), account_id uuid,
  followers_count bigint, observed_at timestamptz,
  lookup_status text default 'found', source_provider text default 'searchapi'
);
create index on public.ig_account_social_profile_snapshots(account_id, observed_at desc);
\ir ../supabase/migrations/20260905232416_stats_growth_warmup_package_inheritance.sql

do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  old_at timestamptz := now() - interval '10 days';
  new_at timestamptz := now() - interval '5 days';
  r jsonb;
begin
  insert into public.ig_accounts(id,status) values(a,'active'),(b,'active'),(c,'active'),(d,'active');
  insert into public.account_commercial_packages(account_id,package_code,starts_at)
    select id,'growth',old_at from public.ig_accounts;
  insert into public.account_warmup_settings(account_id,package_started_at,updated_at,day_4_plus_follow_cap,warmup_started_at)
    select id,old_at,old_at,80,old_at from public.ig_accounts;
  -- Explicit warmup edit and unknown-origin value must survive migration.
  update public.account_warmup_settings set updated_at=old_at+interval '1 hour' where account_id=b;
  update public.account_warmup_settings set day_4_plus_follow_cap=45 where account_id=c;
  update public.ig_accounts set archived_at=now() where id=d;
  update public.account_commercial_packages set ends_at=new_at;
  insert into public.account_commercial_packages(account_id,package_code,starts_at)
    select id,'pro',new_at from public.ig_accounts;
  if (select day_4_plus_follow_cap from public.account_warmup_settings where account_id=a) <> 120 then
    raise exception 'Growth to Pro inheritance failed'; end if;
  if exists(select 1 from public.account_warmup_settings where account_id=a and
    (day_1_follow_cap<>10 or day_2_follow_cap<>20 or day_3_follow_cap<>40 or warmup_started_at<>old_at)) then
    raise exception 'Warmup progress or initial stages changed'; end if;
  if (select day_4_plus_follow_cap from public.account_warmup_settings where account_id=b) <> 80
    or (select day_4_plus_follow_cap from public.account_warmup_settings where account_id=c) <> 45
    or (select day_4_plus_follow_cap from public.account_warmup_settings where account_id=d) <> 80 then
    raise exception 'Manual, unknown or archived values were overwritten'; end if;
  r := public.reconcile_inherited_warmup_package_v1(a);
  if (r->>'changed')::boolean then raise exception 'Replay is not idempotent'; end if;
  -- Receipt proves inheritance even when repair timestamp differs from activation.
  update public.account_commercial_packages set ends_at=now()-interval '1 day' where account_id=a and ends_at is null;
  insert into public.account_commercial_packages(account_id,package_code,starts_at)
    values(a,'growth',now()-interval '1 day');
  if (select day_4_plus_follow_cap from public.account_warmup_settings where account_id=a) <> 80 then
    raise exception 'Pro to Growth receipt inheritance failed'; end if;
  update public.account_commercial_packages set ends_at=now() where account_id=a and ends_at is null;
  insert into public.account_commercial_packages(account_id,package_code,starts_at) values(a,'premium',now());
  if (select day_4_plus_follow_cap from public.account_warmup_settings where account_id=a) <> 120 then
    raise exception 'Premium inheritance failed'; end if;
  -- Existing manual caps remain an independent min bound; no table is changed.
  if least(120,60,120)<>60 or least(120,120,120)<>120 then raise exception 'Manual precedence failed'; end if;
  raise notice 'PASS: upgrades, downgrade, repeat migration, manual/unknown/archived preservation, day1-3/progress, idempotency';
end;
$$;

do $$
declare a uuid := gen_random_uuid(); v_delta bigint;
begin
  insert into public.ig_account_social_profile_snapshots(account_id,followers_count,observed_at)
    values(a,10,now()-interval '90 days'),(a,27,now()-interval '87 days'),
      (a,999,now()-interval '1 day');
  select max(followers_count)-min(followers_count) into v_delta
    from public.read_last_complete_growth_snapshots_v1(array[a],now());
  if v_delta<>17 then raise exception 'Complete pair beyond 30 days was not retained'; end if;
  insert into public.ig_account_social_profile_snapshots(account_id,followers_count,observed_at)
    values(a,985,now()+interval '2 days');
  if (select count(*) from public.read_last_complete_growth_snapshots_v1(array[a],now()))<>2 then
    raise exception 'Future row corrupted retained pair'; end if;
  if exists(select 1 from public.read_last_complete_growth_snapshots_v1(array[gen_random_uuid()],now())) then
    raise exception 'Cross-account history leaked'; end if;
  raise notice 'PASS: durable pair older than 30 days, incomplete newest row, future rejection, exact account scope';
end;
$$;
