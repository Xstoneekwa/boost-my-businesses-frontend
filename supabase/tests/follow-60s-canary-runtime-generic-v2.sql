\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema auth;
create role anon;
create role authenticated;
create role service_role;
create function auth.role() returns text language sql stable
as $$ select current_setting('request.jwt.claim.role', true) $$;

create table public.ig_accounts (id uuid primary key);
create table public.ig_runs (
  id uuid primary key,
  account_id uuid not null,
  status text not null default 'running'
);
create table public.account_run_requests (
  id uuid primary key,
  account_id uuid not null,
  run_id uuid,
  requested_run_type text,
  status text not null default 'running',
  metadata_safe jsonb not null default '{}'::jsonb
);
create table public.follow_60s_canary_controls (
  account_id uuid primary key references public.ig_accounts(id),
  status text not null default 'disabled',
  baseline_follow_count integer not null default 0,
  evaluation_increment integer not null default 10,
  target_follow_count integer not null default 50,
  run_id uuid,
  request_id uuid,
  barrier_reached_at timestamptz,
  hold_armed_at timestamptz,
  released_at timestamptz,
  metadata_safe jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.follow_60s_canary_controls enable row level security;
revoke all on table public.follow_60s_canary_controls from public, anon, authenticated;
grant select, insert, update, delete on table public.follow_60s_canary_controls to service_role;

-- Production predecessor, proving that the forward migration replaces the old
-- signature and that the rollback can restore it.
create function public.bind_follow_60s_canary_runtime_v2(
  p_account_id uuid, p_run_id uuid, p_request_id uuid,
  p_attempt_id integer, p_business_session_id text
) returns jsonb language sql security definer set search_path = ''
as $$ select '{}'::jsonb $$;

\ir ../migrations/20260801123500_follow_60s_canary_runtime_generic_v2.sql

create function public.test_expect_reason(p_query text, p_reason text)
returns void language plpgsql as $$
begin
  begin
    execute p_query;
  exception when others then
    if sqlerrm = p_reason then
      return;
    end if;
    raise exception 'expected reason %, got %', p_reason, sqlerrm;
  end;
  raise exception 'expected reason %, call succeeded', p_reason;
end;
$$;

insert into public.ig_accounts(id) values
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003'),
  ('10000000-0000-0000-0000-000000000004');
insert into public.ig_runs(id,account_id) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004');
insert into public.account_run_requests(id,account_id,run_id,requested_run_type) values
  ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','account_session'),
  ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','account_session'),
  ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','account_session'),
  ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000004','account_session');

create function public.test_control_metadata(
  p_control_id uuid,
  p_account_id uuid,
  p_worker_sha text default repeat('a', 40),
  p_baseline_sha text default repeat('a', 40)
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'control_id', p_control_id,
    'expected_worker_sha', p_worker_sha,
    'baseline_release_sha', p_baseline_sha,
    'baseline_account_id', p_account_id,
    'baseline_captured_at', '2026-08-01T08:00:00+00:00',
    'baseline_timezone', 'Africa/Johannesburg',
    'baseline_package', 'com.instagram.android',
    'baseline_warmup_ready', true,
    'expected_package', 'com.instagram.android',
    'expected_run_type', 'account_session',
    'binding_version', 'FOLLOW_60S_CANARY_BINDING_V2',
    'idempotency_key', p_control_id::text || ':switch',
    'created_by', 'test_operator',
    'source', 'FOLLOW60_CANARY_ACCOUNT_SWITCH_V1',
    'armed_at', '2026-08-01T08:05:00+00:00',
    'expires_at', '2099-08-01T12:00:00+00:00',
    'max_new_cycles', 10,
    'current_new_cycle_count', 0
  )
$$;

set request.jwt.claim.role = 'service_role';

-- Account A (Rex-equivalent fixture) binds successfully.
insert into public.follow_60s_canary_controls(
  account_id,status,baseline_follow_count,evaluation_increment,target_follow_count,metadata_safe
) values (
  '10000000-0000-0000-0000-000000000001','armed',0,10,10,
  public.test_control_metadata(
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001'
  )
);
do $$ declare v_binding jsonb; begin
  v_binding := public.bind_follow_60s_canary_runtime_v2(
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',repeat('a',40),repeat('a',40),
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',1,'session-a',
    'FOLLOW_60S_CANARY_BINDING_V2'
  );
  if v_binding->>'account_id' <> '10000000-0000-0000-0000-000000000001'
    or (v_binding->>'binding_valid')::boolean is not true then
    raise exception 'account_a_binding_failed';
  end if;
end $$;

-- Exact replay is rejected and does not create a second binding.
select public.test_expect_reason($q$
  select public.bind_follow_60s_canary_runtime_v2(
    '40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
    repeat('a',40),repeat('a',40),'30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',1,'session-a','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'binding_already_consumed');

-- Switching to account B requires row data only, not a SQL code change.
update public.follow_60s_canary_controls set status='disabled'
 where account_id='10000000-0000-0000-0000-000000000001';
insert into public.follow_60s_canary_controls(
  account_id,status,baseline_follow_count,evaluation_increment,target_follow_count,metadata_safe
) values (
  '10000000-0000-0000-0000-000000000002','armed',10,10,20,
  public.test_control_metadata(
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',repeat('b',40),repeat('b',40)
  )
);
do $$ declare v_binding jsonb; begin
  v_binding := public.bind_follow_60s_canary_runtime_v2(
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',repeat('b',40),repeat('b',40),
    '30000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',1,'session-b',
    'FOLLOW_60S_CANARY_BINDING_V2'
  );
  if v_binding->>'account_id' <> '10000000-0000-0000-0000-000000000002' then
    raise exception 'account_b_binding_failed';
  end if;
end $$;

-- Fresh account C fixture for fail-closed reason-code coverage.
update public.follow_60s_canary_controls set status='disabled';
insert into public.follow_60s_canary_controls(
  account_id,status,baseline_follow_count,evaluation_increment,target_follow_count,metadata_safe
) values (
  '10000000-0000-0000-0000-000000000003','armed',0,10,10,
  public.test_control_metadata(
    '40000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000003',repeat('c',40),repeat('c',40)
  )
);

select public.test_expect_reason($q$
 select public.bind_follow_60s_canary_runtime_v2(
  '49999999-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000003',
  repeat('c',40),repeat('c',40),'30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',1,'session-c','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'control_not_found');
select public.test_expect_reason($q$
 select public.bind_follow_60s_canary_runtime_v2(
  '40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004',
  repeat('c',40),repeat('c',40),'30000000-0000-0000-0000-000000000004',
  '20000000-0000-0000-0000-000000000004',1,'session-c','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'account_mismatch');
select public.test_expect_reason($q$
 select public.bind_follow_60s_canary_runtime_v2(
  '40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',
  repeat('d',40),repeat('c',40),'30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',1,'session-c','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'worker_sha_mismatch');
select public.test_expect_reason($q$
 select public.bind_follow_60s_canary_runtime_v2(
  '40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',
  repeat('c',40),repeat('d',40),'30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',1,'session-c','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'baseline_release_mismatch');
select public.test_expect_reason($q$
 select public.bind_follow_60s_canary_runtime_v2(
  '40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',
  repeat('c',40),repeat('c',40),'30000000-0000-0000-0000-000000000004',
  '20000000-0000-0000-0000-000000000003',1,'session-c','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'request_mismatch');
select public.test_expect_reason($q$
 select public.bind_follow_60s_canary_runtime_v2(
  '40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',
  repeat('c',40),repeat('c',40),'30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000004',1,'session-c','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'run_mismatch');

update public.follow_60s_canary_controls set status='disabled'
 where account_id='10000000-0000-0000-0000-000000000003';
select public.test_expect_reason($q$
 select public.bind_follow_60s_canary_runtime_v2(
  '40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',
  repeat('c',40),repeat('c',40),'30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',1,'session-c','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'control_not_armed');
update public.follow_60s_canary_controls set status='armed',
 metadata_safe=jsonb_set(metadata_safe,'{expires_at}','"2020-01-01T00:00:00+00:00"')
 where account_id='10000000-0000-0000-0000-000000000003';
select public.test_expect_reason($q$
 select public.bind_follow_60s_canary_runtime_v2(
  '40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',
  repeat('c',40),repeat('c',40),'30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',1,'session-c','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'control_expired');
update public.follow_60s_canary_controls set metadata_safe=
  jsonb_set(jsonb_set(metadata_safe,'{expires_at}','"2099-01-01T00:00:00+00:00"'),'{revoked_at}','"2026-08-01T09:00:00+00:00"')
 where account_id='10000000-0000-0000-0000-000000000003';
select public.test_expect_reason($q$
 select public.bind_follow_60s_canary_runtime_v2(
  '40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',
  repeat('c',40),repeat('c',40),'30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',1,'session-c','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'control_revoked');

update public.follow_60s_canary_controls set metadata_safe=metadata_safe-'revoked_at'
 where account_id='10000000-0000-0000-0000-000000000003';
insert into public.follow_60s_canary_controls(
  account_id,status,baseline_follow_count,evaluation_increment,target_follow_count,metadata_safe
) values (
  '10000000-0000-0000-0000-000000000004','armed',0,10,10,
  public.test_control_metadata(
    '40000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000004',repeat('d',40),repeat('d',40)
  )
);
select public.test_expect_reason($q$
 select public.bind_follow_60s_canary_runtime_v2(
  '40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',
  repeat('c',40),repeat('c',40),'30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',1,'session-c','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'active_control_collision');

update public.follow_60s_canary_controls set status='disabled'
 where account_id='10000000-0000-0000-0000-000000000004';
update public.follow_60s_canary_controls set metadata_safe=metadata_safe ||
  '{"attempt_id":2,"business_session_id":"session-c"}'::jsonb
 where account_id='10000000-0000-0000-0000-000000000003';
select public.test_expect_reason($q$
 select public.bind_follow_60s_canary_runtime_v2(
  '40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',
  repeat('c',40),repeat('c',40),'30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',1,'session-c','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'attempt_mismatch');
select public.test_expect_reason($q$
 select public.bind_follow_60s_canary_runtime_v2(
  '40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',
  repeat('c',40),repeat('c',40),'30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',2,'wrong-session','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'business_session_mismatch');
update public.follow_60s_canary_controls set metadata_safe=metadata_safe-'attempt_id'-'business_session_id'
 where account_id='10000000-0000-0000-0000-000000000003';

update public.follow_60s_canary_controls set metadata_safe=jsonb_set(
  metadata_safe,'{baseline_account_id}','"10000000-0000-0000-0000-000000000001"'
) where account_id='10000000-0000-0000-0000-000000000003';
select public.test_expect_reason($q$
 select public.bind_follow_60s_canary_runtime_v2(
  '40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',
  repeat('c',40),repeat('c',40),'30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',1,'session-c','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'baseline_release_mismatch');
update public.follow_60s_canary_controls set metadata_safe=jsonb_set(
  metadata_safe,'{baseline_account_id}','"10000000-0000-0000-0000-000000000003"'
) where account_id='10000000-0000-0000-0000-000000000003';

update public.follow_60s_canary_controls set metadata_safe=jsonb_set(metadata_safe,'{current_new_cycle_count}','10')
 where account_id='10000000-0000-0000-0000-000000000003';
select public.test_expect_reason($q$
 select public.bind_follow_60s_canary_runtime_v2(
  '40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',
  repeat('c',40),repeat('c',40),'30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000003',1,'session-c','FOLLOW_60S_CANARY_BINDING_V2')
$q$, 'max_cycles_reached');

-- Complete three consecutive data-only switches: A -> B -> C -> D.
update public.follow_60s_canary_controls set metadata_safe=jsonb_set(metadata_safe,'{current_new_cycle_count}','0')
 where account_id='10000000-0000-0000-0000-000000000003';
do $$ declare v_binding jsonb; begin
  v_binding := public.bind_follow_60s_canary_runtime_v2(
    '40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',
    repeat('c',40),repeat('c',40),'30000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000003',1,'session-c','FOLLOW_60S_CANARY_BINDING_V2');
  if v_binding->>'account_id' <> '10000000-0000-0000-0000-000000000003' then
    raise exception 'account_c_binding_failed';
  end if;
end $$;
update public.follow_60s_canary_controls set status='disabled'
 where account_id='10000000-0000-0000-0000-000000000003';
update public.follow_60s_canary_controls set status='armed'
 where account_id='10000000-0000-0000-0000-000000000004';
do $$ declare v_binding jsonb; begin
  v_binding := public.bind_follow_60s_canary_runtime_v2(
    '40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004',
    repeat('d',40),repeat('d',40),'30000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000004',1,'session-d','FOLLOW_60S_CANARY_BINDING_V2');
  if v_binding->>'account_id' <> '10000000-0000-0000-0000-000000000004' then
    raise exception 'account_d_binding_failed';
  end if;
end $$;

do $$ begin
  if has_function_privilege('public','public.bind_follow_60s_canary_runtime_v2(uuid,uuid,text,text,uuid,uuid,integer,text,text)','execute')
    or has_function_privilege('anon','public.bind_follow_60s_canary_runtime_v2(uuid,uuid,text,text,uuid,uuid,integer,text,text)','execute')
    or has_function_privilege('authenticated','public.bind_follow_60s_canary_runtime_v2(uuid,uuid,text,text,uuid,uuid,integer,text,text)','execute')
    or not has_function_privilege('service_role','public.bind_follow_60s_canary_runtime_v2(uuid,uuid,text,text,uuid,uuid,integer,text,text)','execute') then
    raise exception 'generic_binding_least_privilege_failed';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.follow_60s_canary_controls'::regclass) then
    raise exception 'control_rls_disabled';
  end if;
  if to_regprocedure('public.bind_follow_60s_canary_runtime_v2(uuid,uuid,uuid,integer,text)') is not null then
    raise exception 'legacy_binding_signature_still_present';
  end if;
end $$;

\ir ../rollback/20260801123500_follow_60s_canary_runtime_generic_v2.down.sql

do $$ begin
  if to_regprocedure('public.bind_follow_60s_canary_runtime_v2(uuid,uuid,text,text,uuid,uuid,integer,text,text)') is not null
    or to_regprocedure('public.bind_follow_60s_canary_runtime_v2(uuid,uuid,uuid,integer,text)') is null then
    raise exception 'targeted_rollback_failed';
  end if;
end $$;

select 'FOLLOW60_GENERIC_RPC_V2_POSTGRES_OK' as result;
