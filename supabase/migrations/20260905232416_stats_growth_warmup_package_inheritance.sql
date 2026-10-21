-- Repair only provably package-inherited warmup values. No business-data backfill
-- is executed by this migration. Existing manual/unclassified values fail closed.
do $receipt_guard$
declare v_table oid := to_regclass('public.account_warmup_package_inheritance_receipts'); v_columns jsonb;
begin
 if v_table is null then
 create table public.account_warmup_package_inheritance_receipts (
  account_id uuid primary key references public.ig_accounts(id) on delete cascade,
  package_id uuid not null references public.account_commercial_packages(id),
  applied_at timestamptz not null,
  day_4_plus_follow_cap integer not null check (day_4_plus_follow_cap > 0),
  previous_day_4_plus_follow_cap integer,
  previous_package_started_at timestamptz
);
alter table public.account_warmup_package_inheritance_receipts enable row level security;
revoke all on public.account_warmup_package_inheritance_receipts from public, anon, authenticated;
grant select on public.account_warmup_package_inheritance_receipts to service_role;
 else
  select jsonb_object_agg(attname,jsonb_build_array(format_type(atttypid,atttypmod),attnotnull,atthasdef)) into v_columns from pg_attribute where attrelid=v_table and attnum>0 and not attisdropped;
  if v_columns is distinct from '{"account_id":["uuid",true,false],"package_id":["uuid",true,false],"applied_at":["timestamp with time zone",true,false],"day_4_plus_follow_cap":["integer",true,false],"previous_day_4_plus_follow_cap":["integer",false,false],"previous_package_started_at":["timestamp with time zone",false,false]}'::jsonb then raise exception 'warmup_receipt_schema_incompatible: columns %', v_columns; end if;
  if not exists(select 1 from pg_class where oid=v_table and relkind='r' and relpersistence='p' and relrowsecurity and not relforcerowsecurity) then raise exception 'warmup_receipt_schema_incompatible: table kind/persistence/RLS'; end if;
  if not exists(select 1 from pg_constraint where conrelid=v_table and contype='p' and convalidated and conkey=array[(select attnum from pg_attribute where attrelid=v_table and attname='account_id')]) then raise exception 'warmup_receipt_schema_incompatible: primary key'; end if;
  if not exists(select 1 from pg_constraint where conrelid=v_table and contype='f' and convalidated and confrelid='public.ig_accounts'::regclass and confdeltype='c' and conkey=array[(select attnum from pg_attribute where attrelid=v_table and attname='account_id')] and confkey=array[(select attnum from pg_attribute where attrelid='public.ig_accounts'::regclass and attname='id')]) then raise exception 'warmup_receipt_schema_incompatible: account foreign key'; end if;
  if not exists(select 1 from pg_constraint where conrelid=v_table and contype='f' and convalidated and confrelid='public.account_commercial_packages'::regclass and confdeltype='a' and conkey=array[(select attnum from pg_attribute where attrelid=v_table and attname='package_id')] and confkey=array[(select attnum from pg_attribute where attrelid='public.account_commercial_packages'::regclass and attname='id')]) then raise exception 'warmup_receipt_schema_incompatible: package foreign key'; end if;
  if not exists(select 1 from pg_constraint where conrelid=v_table and contype='c' and convalidated and regexp_replace(pg_get_constraintdef(oid),'[[:space:]()]','','g')='CHECKday_4_plus_follow_cap>0') then raise exception 'warmup_receipt_schema_incompatible: positive cap constraint'; end if;
  if has_table_privilege('anon',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_table_privilege('authenticated',v_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or not has_table_privilege('service_role',v_table,'SELECT') then raise exception 'warmup_receipt_schema_incompatible: grants'; end if;
 end if;
end;
$receipt_guard$;

do $function_guard$
declare v_oid oid := to_regprocedure('public.reconcile_inherited_warmup_package_v1(uuid)');
begin
 if v_oid is null then
 create function public.reconcile_inherited_warmup_package_v1(p_account_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_current public.account_commercial_packages%rowtype;
  v_previous public.account_commercial_packages%rowtype;
  v_warmup public.account_warmup_settings%rowtype;
  v_receipt public.account_warmup_package_inheritance_receipts%rowtype;
  v_previous_cap integer;
  v_next_cap integer;
  v_applied_at timestamptz := statement_timestamp();
begin
  perform 1 from public.ig_accounts a where a.id = p_account_id
    and a.archived_at is null and a.trashed_at is null
    and a.status not in ('archived', 'trashed') for update;
  if not found then return jsonb_build_object('changed', false, 'reason', 'account_ineligible'); end if;
  select * into v_current from public.account_commercial_packages
    where account_id = p_account_id and status = 'active'
      and starts_at <= now() and (ends_at is null or ends_at > now())
    order by starts_at desc, created_at desc limit 1 for update;
  select * into v_warmup from public.account_warmup_settings
    where account_id = p_account_id for update;
  if v_current.id is null or v_warmup.account_id is null
    or v_warmup.package_started_at is null
    or v_warmup.package_started_at >= v_current.starts_at then
    return jsonb_build_object('changed', false, 'reason', 'no_stale_package_binding');
  end if;
  select * into v_previous from public.account_commercial_packages
    where account_id = p_account_id and starts_at = v_warmup.package_started_at
      and id <> v_current.id and ends_at <= v_current.starts_at
    order by created_at desc limit 1;
  select default_follow_day_cap into v_previous_cap from public.commercial_packages
    where code = v_previous.package_code;
  select default_follow_day_cap into v_next_cap from public.commercial_packages
    where code = v_current.package_code and active = true;
  select * into v_receipt from public.account_warmup_package_inheritance_receipts
    where account_id = p_account_id;
  if v_previous.id is null or coalesce(v_next_cap, 0) <= 0 or not (
    (v_warmup.updated_at = v_previous.starts_at
      and v_warmup.day_4_plus_follow_cap = v_previous_cap)
    or (v_receipt.package_id = v_previous.id
      and v_receipt.applied_at = v_warmup.updated_at
      and v_receipt.day_4_plus_follow_cap = v_warmup.day_4_plus_follow_cap)
  ) is true then
    return jsonb_build_object('changed', false, 'reason', 'manual_or_unclassified_preserved');
  end if;
  update public.account_warmup_settings
    set day_4_plus_follow_cap = v_next_cap,
        package_started_at = v_current.starts_at, updated_at = v_applied_at
    where account_id = p_account_id;
  insert into public.account_warmup_package_inheritance_receipts
    (account_id, package_id, applied_at, day_4_plus_follow_cap,
     previous_day_4_plus_follow_cap, previous_package_started_at)
    values (p_account_id, v_current.id, v_applied_at, v_next_cap,
      v_warmup.day_4_plus_follow_cap, v_warmup.package_started_at)
    on conflict (account_id) do update set package_id = excluded.package_id,
      applied_at = excluded.applied_at, day_4_plus_follow_cap = excluded.day_4_plus_follow_cap,
      previous_day_4_plus_follow_cap = excluded.previous_day_4_plus_follow_cap,
      previous_package_started_at = excluded.previous_package_started_at;
  return jsonb_build_object('changed', true, 'reason', 'package_inherited',
    'before', v_warmup.day_4_plus_follow_cap, 'after', v_next_cap);
end;
$$;
 elsif not exists(select 1 from pg_proc where oid=v_oid and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='5267e17fcdaee0d53a0e849da7384e3667f48c067e21c87facdf5bca9a040306' and prorettype='jsonb'::regtype and proretset=false and prosecdef=true and provolatile='v' and prolang=(select oid from pg_language where lanname='plpgsql') and proconfig=ARRAY['search_path=""']::text[] and pronargdefaults=0 and not proisstrict and not proleakproof) then
 raise exception 'warmup_migration_function_incompatible: reconcile_inherited_warmup_package_v1';
 elsif has_function_privilege('anon',v_oid,'EXECUTE') or has_function_privilege('authenticated',v_oid,'EXECUTE') then
 raise exception 'warmup_migration_function_incompatible: reconcile_inherited_warmup_package_v1 grants';
 end if;
end;
$function_guard$;
revoke all on function public.reconcile_inherited_warmup_package_v1(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_inherited_warmup_package_v1(uuid) to service_role;

do $function_guard$
declare v_oid oid := to_regprocedure('public.on_warmup_package_transition_v1()');
begin
 if v_oid is null then
 create function public.on_warmup_package_transition_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.reconcile_inherited_warmup_package_v1(new.account_id);
  return new;
end;
$$;
 elsif not exists(select 1 from pg_proc where oid=v_oid and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='ea05d328eaeaba3b8905021634e91e1c1699b31030b959a54c3aa7435cd84275' and prorettype='trigger'::regtype and proretset=false and prosecdef=true and provolatile='v' and prolang=(select oid from pg_language where lanname='plpgsql') and proconfig=ARRAY['search_path=""']::text[] and pronargdefaults=0 and not proisstrict and not proleakproof) then
 raise exception 'warmup_migration_function_incompatible: on_warmup_package_transition_v1';
 elsif has_function_privilege('anon',v_oid,'EXECUTE') or has_function_privilege('authenticated',v_oid,'EXECUTE') then
 raise exception 'warmup_migration_function_incompatible: on_warmup_package_transition_v1 grants';
 end if;
end;
$function_guard$;
revoke all on function public.on_warmup_package_transition_v1() from public, anon, authenticated;
do $trigger_guard$
declare v_trigger pg_trigger%rowtype;
begin
 select * into v_trigger from pg_trigger where tgrelid='public.account_commercial_packages'::regclass and tgname='warmup_package_transition_v1';
 if not found then
 create trigger warmup_package_transition_v1
after insert or update of package_code, status, starts_at, ends_at
on public.account_commercial_packages for each row
execute function public.on_warmup_package_transition_v1();
 elsif v_trigger.tgfoid<>'public.on_warmup_package_transition_v1()'::regprocedure or v_trigger.tgtype<>21 or v_trigger.tgenabled<>'O' or v_trigger.tgqual is not null or v_trigger.tgnargs<>0 or v_trigger.tgattr::text is distinct from (select string_agg(attnum::text,' ' order by ord) from unnest(ARRAY['package_code','status','starts_at','ends_at']) with ordinality x(name,ord) join pg_attribute a on a.attrelid='public.account_commercial_packages'::regclass and a.attname=x.name) then
 raise exception 'warmup_migration_trigger_incompatible: warmup_package_transition_v1';
 end if;
end;
$trigger_guard$;

-- Read-only durable history lookup. No snapshot writes or provider calls.
do $function_guard$
declare v_oid oid := to_regprocedure('public.read_last_complete_growth_snapshots_v1(uuid[],timestamptz)');
begin
 if v_oid is null then
 create function public.read_last_complete_growth_snapshots_v1(p_account_ids uuid[], p_until timestamptz)
returns setof public.ig_account_social_profile_snapshots
language sql stable security invoker set search_path = '' as $$
  select distinct on (s.id) s.*
  from (select distinct unnest(p_account_ids) as account_id) accounts
  cross join lateral (
    select c.id as current_id, baseline.id as baseline_id
    from public.ig_account_social_profile_snapshots c
    cross join lateral (
      select b.id from public.ig_account_social_profile_snapshots b
      where b.account_id = c.account_id and b.lookup_status = 'found'
        and b.followers_count between 0 and 9007199254740991
        and b.source_provider in ('searchapi', 'http', 'device_profile_read')
        and b.observed_at between c.observed_at - interval '96 hours' and c.observed_at - interval '48 hours'
      order by abs(extract(epoch from (b.observed_at - (c.observed_at - interval '72 hours')))), b.observed_at desc, b.id desc
      limit 1
    ) baseline
    where c.account_id = accounts.account_id and c.lookup_status = 'found'
      and c.followers_count between 0 and 9007199254740991
      and c.source_provider in ('searchapi', 'http', 'device_profile_read')
      and c.observed_at <= least(p_until, now())
    order by c.observed_at desc, c.id desc limit 1
  ) pair
  join public.ig_account_social_profile_snapshots s on s.id in (pair.current_id, pair.baseline_id)
  order by s.id;
$$;
 elsif not exists(select 1 from pg_proc where oid=v_oid and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='863c118e051c3ba1404880f4b0f151efc183469e1436bfd1fa0461e4abb8fc3b' and prorettype='public.ig_account_social_profile_snapshots'::regtype and proretset=true and prosecdef=false and provolatile='s' and prolang=(select oid from pg_language where lanname='sql') and proconfig=ARRAY['search_path=""']::text[] and pronargdefaults=0 and not proisstrict and not proleakproof) then
 raise exception 'warmup_migration_function_incompatible: read_last_complete_growth_snapshots_v1';
 elsif has_function_privilege('anon',v_oid,'EXECUTE') or has_function_privilege('authenticated',v_oid,'EXECUTE') then
 raise exception 'warmup_migration_function_incompatible: read_last_complete_growth_snapshots_v1 grants';
 end if;
end;
$function_guard$;
revoke all on function public.read_last_complete_growth_snapshots_v1(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.read_last_complete_growth_snapshots_v1(uuid[], timestamptz) to service_role;
