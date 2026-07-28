\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'assertion_failed: %', p_message;
  end if;
end
$$;

create or replace function pg_temp.expect_insufficient_privilege(p_sql text, p_message text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'expected_insufficient_privilege: %', p_message;
  exception
    when insufficient_privilege then null;
  end;
end
$$;

create temporary table availability_expected_acl (
  table_name text primary key,
  allow_update boolean not null
);

insert into availability_expected_acl values
  ('ct_target_availability_observations', false),
  ('ct_target_identity_history', false),
  ('ct_target_identity_current', true),
  ('ct_target_availability_assessments', false),
  ('ct_target_availability_current', true);

grant select on availability_expected_acl to service_role;

create or replace function pg_temp.availability_noop_trigger()
returns trigger language plpgsql as $$
begin
  return new;
end
$$;

do $$
declare v record;
begin
  for v in select * from availability_expected_acl loop
    perform pg_temp.assert_true(
      has_table_privilege('service_role', format('public.%I', v.table_name), 'SELECT'),
      v.table_name || ' service_role SELECT allowed');
    perform pg_temp.assert_true(
      has_table_privilege('service_role', format('public.%I', v.table_name), 'INSERT'),
      v.table_name || ' service_role INSERT allowed');
    perform pg_temp.assert_true(
      has_table_privilege('service_role', format('public.%I', v.table_name), 'UPDATE') = v.allow_update,
      v.table_name || ' service_role UPDATE exact');
    perform pg_temp.assert_true(
      not has_table_privilege('service_role', format('public.%I', v.table_name), 'DELETE'),
      v.table_name || ' service_role DELETE denied');
    perform pg_temp.assert_true(
      not has_table_privilege('service_role', format('public.%I', v.table_name), 'TRUNCATE'),
      v.table_name || ' service_role TRUNCATE denied');
    perform pg_temp.assert_true(
      not has_table_privilege('service_role', format('public.%I', v.table_name), 'REFERENCES'),
      v.table_name || ' service_role REFERENCES denied');
    perform pg_temp.assert_true(
      not has_table_privilege('service_role', format('public.%I', v.table_name), 'TRIGGER'),
      v.table_name || ' service_role TRIGGER denied');
    perform pg_temp.assert_true(
      not has_table_privilege('anon', format('public.%I', v.table_name),
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
      v.table_name || ' anon denied');
    perform pg_temp.assert_true(
      not has_table_privilege('authenticated', format('public.%I', v.table_name),
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
      v.table_name || ' authenticated denied');
  end loop;
end
$$;

select pg_temp.assert_true(
  not exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (select table_name from availability_expected_acl)
      and a.attnum > 0
      and not a.attisdropped
      and a.attacl is not null
  ),
  'no explicit column ACL exists');

select pg_temp.assert_true(
  (select count(*) = 5
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in (select table_name from availability_expected_acl)
     and c.relrowsecurity
     and c.relforcerowsecurity),
  'RLS enabled and forced on all five tables');

select pg_temp.assert_true(
  (select count(*) = 5
   from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in (select table_name from availability_expected_acl)
     and p.cmd = 'ALL'
     and p.roles = array['service_role']::name[]),
  'exact service_role-only policy set remains');

create temporary table availability_expected_indexes (
  index_name text primary key,
  table_name text not null,
  key_columns text[] not null
);

insert into availability_expected_indexes values
  ('ct_target_availability_assessments_account_target_idx', 'ct_target_availability_assessments', array['account_id','target_id']),
  ('ct_target_availability_assessments_target_id_idx', 'ct_target_availability_assessments', array['target_id']),
  ('ct_target_availability_current_account_target_idx', 'ct_target_availability_current', array['account_id','target_id']),
  ('ct_target_availability_current_target_id_idx', 'ct_target_availability_current', array['target_id']),
  ('ct_target_availability_observations_target_id_idx', 'ct_target_availability_observations', array['target_id']),
  ('ct_target_identity_current_account_target_idx', 'ct_target_identity_current', array['account_id','target_id']),
  ('ct_target_identity_current_target_id_idx', 'ct_target_identity_current', array['target_id']),
  ('ct_target_identity_current_last_history_id_idx', 'ct_target_identity_current', array['last_history_id']),
  ('ct_target_identity_history_account_target_idx', 'ct_target_identity_history', array['account_id','target_id']),
  ('ct_target_identity_history_target_id_idx', 'ct_target_identity_history', array['target_id']),
  ('ct_target_identity_history_observation_id_idx', 'ct_target_identity_history', array['observation_id']);

select pg_temp.assert_true(
  (select count(*) = 11
   from availability_expected_indexes e
   join pg_class i on i.relname = e.index_name
   join pg_namespace ni on ni.oid = i.relnamespace and ni.nspname = 'public'
   join pg_index x on x.indexrelid = i.oid and x.indisvalid and x.indisready
   join pg_class t on t.oid = x.indrelid and t.relname = e.table_name
   where array(
     select a.attname::text
     from unnest(x.indkey::smallint[]) with ordinality k(attnum, ord)
     join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum
     where k.ord <= x.indnkeyatts
     order by k.ord
   ) = e.key_columns),
  'all eleven stable FK indexes exist with exact columns');

create temporary table availability_advisor_fks (constraint_name text primary key);
insert into availability_advisor_fks values
  ('ct_target_availability_assessments_account_id_fkey'),
  ('ct_target_availability_assessments_account_target_fkey'),
  ('ct_target_availability_assessments_target_id_fkey'),
  ('ct_target_availability_current_account_id_fkey'),
  ('ct_target_availability_current_account_target_fkey'),
  ('ct_target_availability_current_target_id_fkey'),
  ('ct_target_availability_observations_target_id_fkey'),
  ('ct_target_identity_current_account_target_fkey'),
  ('ct_target_identity_current_last_history_id_fkey'),
  ('ct_target_identity_current_target_id_fkey'),
  ('ct_target_identity_history_account_id_fkey'),
  ('ct_target_identity_history_account_target_fkey'),
  ('ct_target_identity_history_observation_id_fkey'),
  ('ct_target_identity_history_target_id_fkey');

select pg_temp.assert_true(
  (select count(*) = 14
   from availability_advisor_fks e
   join pg_constraint c on c.conname = e.constraint_name and c.contype = 'f'
   where exists (
     select 1
     from pg_index i
     where i.indrelid = c.conrelid
       and i.indisvalid
       and i.indisready
       and i.indpred is null
       and i.indnkeyatts >= cardinality(c.conkey)
       and (i.indkey::smallint[])[0:cardinality(c.conkey)-1] = c.conkey
   )),
  'all fourteen advisor FKs have a directly usable left-prefix index');

select pg_temp.assert_true(
  not exists (
    select 1
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname in (select table_name from availability_expected_acl)
    group by i.indrelid, i.indkey::text, coalesce(pg_get_expr(i.indexprs, i.indrelid), ''),
      coalesce(pg_get_expr(i.indpred, i.indrelid), '')
    having count(*) > 1
  ),
  'no duplicate Target Availability indexes');

begin;
create role availability_public_probe nologin;
create table public.availability_reference_probe (observation_id uuid);
alter table public.availability_reference_probe owner to service_role;

set local role availability_public_probe;
select pg_temp.expect_insufficient_privilege(
  'select * from public.ct_target_availability_observations limit 0',
  'PUBLIC probe cannot select');
reset role;

set local role anon;
select pg_temp.expect_insufficient_privilege(
  'select * from public.ct_target_availability_observations limit 0',
  'anon cannot select');
reset role;

set local role authenticated;
select pg_temp.expect_insufficient_privilege(
  'select * from public.ct_target_availability_observations limit 0',
  'authenticated cannot select');
reset role;

set local role service_role;
set local request.jwt.claim.role = 'service_role';

select count(*) from public.ct_target_availability_observations;
select count(*) from public.ct_target_identity_history;
select count(*) from public.ct_target_identity_current;
select count(*) from public.ct_target_availability_assessments;
select count(*) from public.ct_target_availability_current;

insert into public.ct_target_availability_observations (
  id, tenant_id, account_id, target_id, observed_at, source, searched_username,
  lookup_result, followers_surface, reason_codes, idempotency_key
) values (
  '41000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0001-000000000001', md5('target:1')::uuid,
  '2026-07-29 10:00:00+00', 'synthetic', 'synthetic_target_1', 'found', 'normal',
  array['target_profile_found'], 'forward-fix-observation-0001'
);

insert into public.ct_target_identity_history (
  id, tenant_id, account_id, target_id, observation_id, previous_username,
  observed_username, stable_platform_user_id, resolution, confidence, reason_codes,
  idempotency_key, observed_at
) values (
  '41000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0001-000000000001', md5('target:1')::uuid,
  '41000000-0000-0000-0000-000000000001', 'synthetic_target_1',
  'synthetic_target_1', 'stable-forward-fix-1', 'unchanged', 'high',
  array['target_identity_match_confirmed'], 'forward-fix-history-0001',
  '2026-07-29 10:00:00+00'
);

insert into public.ct_target_identity_current (
  tenant_id, account_id, target_id, current_username, stable_platform_user_id,
  identity_status, confidence, last_history_id, last_observed_at
) values (
  '10000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0001-000000000001', md5('target:1')::uuid,
  'synthetic_target_1', 'stable-forward-fix-1', 'unchanged', 'high',
  '41000000-0000-0000-0000-000000000002', '2026-07-29 10:00:00+00'
);

insert into public.ct_target_availability_assessments (
  id, tenant_id, account_id, target_id, assessment_key, normalized_username,
  stable_platform_user_id, status, confidence, identity_resolution, reason_codes,
  evidence_count, distinct_run_count, distinct_device_count, latest_observed_at,
  recheck_required, quarantine_recommended, terminal_proof, assessed_at, model_version
) values (
  '41000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0001-000000000001', md5('target:1')::uuid,
  'forward-fix-assessment-0001', 'synthetic_target_1', 'stable-forward-fix-1',
  'available', 'high', 'unchanged', array['target_profile_found'], 1, 1, 1,
  '2026-07-29 10:00:00+00', false, false, false,
  '2026-07-29 10:01:00+00', 'target-availability-v1'
);

insert into public.ct_target_availability_current (
  tenant_id, account_id, target_id, assessment_id
) values (
  '10000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0001-000000000001', md5('target:1')::uuid,
  '41000000-0000-0000-0000-000000000003'
);

update public.ct_target_identity_current
set updated_at = '2026-07-29 10:02:00+00'
where tenant_id = '10000000-0000-0000-0000-000000000000'
  and account_id = '10000000-0000-0000-0001-000000000001'
  and target_id = md5('target:1')::uuid;

update public.ct_target_availability_current
set updated_at = '2026-07-29 10:02:00+00'
where tenant_id = '10000000-0000-0000-0000-000000000000'
  and account_id = '10000000-0000-0000-0001-000000000001'
  and target_id = md5('target:1')::uuid;

select pg_temp.expect_insufficient_privilege(
  $$update public.ct_target_availability_observations set lookup_result='failed'
    where id='41000000-0000-0000-0000-000000000001'$$,
  'append-only observation UPDATE denied by ACL');
select pg_temp.expect_insufficient_privilege(
  $$delete from public.ct_target_identity_history
    where id='41000000-0000-0000-0000-000000000002'$$,
  'append-only identity history DELETE denied by ACL');
select pg_temp.expect_insufficient_privilege(
  $$update public.ct_target_availability_assessments set confidence='low'
    where id='41000000-0000-0000-0000-000000000003'$$,
  'append-only assessment UPDATE denied by ACL');
select pg_temp.expect_insufficient_privilege(
  $$delete from public.ct_target_identity_current
    where last_history_id='41000000-0000-0000-0000-000000000002'$$,
  'identity current DELETE denied');
select pg_temp.expect_insufficient_privilege(
  $$delete from public.ct_target_availability_current
    where assessment_id='41000000-0000-0000-0000-000000000003'$$,
  'availability current DELETE denied');

do $$
declare v record;
begin
  for v in select * from availability_expected_acl loop
    perform pg_temp.expect_insufficient_privilege(
      format('truncate table public.%I', v.table_name),
      v.table_name || ' TRUNCATE denied');
    perform pg_temp.expect_insufficient_privilege(
      format('create trigger availability_forbidden_trigger before insert on public.%I '
             'for each statement execute function pg_temp.availability_noop_trigger()',
             v.table_name),
      v.table_name || ' TRIGGER denied');
  end loop;
end
$$;

select pg_temp.expect_insufficient_privilege(
  $$alter table public.availability_reference_probe
    add constraint availability_forbidden_reference
    foreign key (observation_id)
    references public.ct_target_availability_observations(id)$$,
  'REFERENCES denied');

reset role;
rollback;

select pg_temp.assert_true(
  (select count(*) = 0 from public.ct_target_availability_observations)
  and (select count(*) = 0 from public.ct_target_identity_history)
  and (select count(*) = 0 from public.ct_target_identity_current)
  and (select count(*) = 0 from public.ct_target_availability_assessments)
  and (select count(*) = 0 from public.ct_target_availability_current),
  'service_role test fixtures fully rolled back');

select 'SERVICE_ROLE_PRIVILEGES_EXACT_MATCH' as certification;
select 'SERVICE_ROLE_EXCESS_PRIVILEGES=0' as certification;
select 'SERVICE_ROLE_TEST_FIXTURES_REMAINING=0' as certification;
select 'TARGET_AVAILABILITY_FORWARD_FIX_CONTRACT_CERTIFIED' as certification;
