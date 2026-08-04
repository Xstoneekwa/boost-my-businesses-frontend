\set ON_ERROR_STOP on

create schema auth;
create role anon;
create role authenticated;
create role service_role;
create function auth.role() returns text language sql stable
as $$ select current_setting('request.jwt.claim.role', true) $$;

create table public.ig_account_settings (
  account_id uuid primary key,
  max_actions_per_day integer
);
create table public.account_package_summary (
  account_id uuid primary key,
  package_caps jsonb,
  effective_caps_preview jsonb
);
create table public.follow_60s_canary_controls (
  account_id uuid primary key,
  status text not null,
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
create table public.follow_60s_canary_control_history (
  id bigint generated always as identity primary key,
  account_id uuid,
  control_id uuid,
  status text,
  archived_reason text,
  control_snapshot jsonb,
  archived_by text
);

\ir ../migrations/20260804195414_follow60_canonical_effective_follow_limit_v1.sql
set request.jwt.claim.role='service_role';

create function pg_temp.baseline(
  p_account uuid,
  p_sha text,
  p_caller_cap integer default null
) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'account_id',p_account,
    'package','com.instagram.android',
    'worker_sha',p_sha,
    'release_sha',p_sha,
    'captured_at',now(),
    'timezone','Africa/Johannesburg',
    'business_date',(now() at time zone 'Africa/Johannesburg')::date,
    'warmup_ready',true,
    'canonical_follow_limit',p_caller_cap
  ));
$$;

insert into public.ig_account_settings values
  ('10000000-0000-4000-8000-000000000001',70),
  ('10000000-0000-4000-8000-000000000002',50),
  ('10000000-0000-4000-8000-000000000003',40),
  ('10000000-0000-4000-8000-000000000004',45),
  ('10000000-0000-4000-8000-000000000005',70),
  ('10000000-0000-4000-8000-000000000006',70),
  ('10000000-0000-4000-8000-000000000007',70);
insert into public.account_package_summary values
  ('10000000-0000-4000-8000-000000000001','{"follow_day":70}','{"follow_day":70}'),
  ('10000000-0000-4000-8000-000000000002','{"follow_day":70}','{"follow_day":50}'),
  ('10000000-0000-4000-8000-000000000003','{"follow_day":70}','{"follow_day":70}'),
  ('10000000-0000-4000-8000-000000000004','{"follow_day":45}','{"follow_day":70}'),
  ('10000000-0000-4000-8000-000000000005','{"follow_day":70}','{}'),
  ('10000000-0000-4000-8000-000000000006','{"follow_day":70}','{"follow_day":70}'),
  ('10000000-0000-4000-8000-000000000007','{"follow_day":70}','{"follow_day":70}');

do $$
declare
  v jsonb;
  v_sha text := repeat('a',40);
  v_date date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  -- Rex-like baseline 50 -> target 60 succeeds because the server cap is 70.
  v := public.create_or_rearm_follow_60s_canary_control_v1(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',v_sha,
    50,10,now()+interval '1 day','rex','com.instagram.android',
    pg_temp.baseline('10000000-0000-4000-8000-000000000001',v_sha,999),
    'rex-50-60','test','sql-contract'
  );
  if (v->>'barrier_target')::integer <> 60
     or (v->>'canonical_follow_limit')::integer <> 70
     or (select target_follow_count from public.follow_60s_canary_controls) <> 60 then
    raise exception 'server_cap_70_target_60_failed:%',v;
  end if;

  -- Caller payload cap 999 is ignored; idempotent replay remains unchanged.
  v := public.create_or_rearm_follow_60s_canary_control_v1(
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',v_sha,
    50,10,now()+interval '1 day','rex','com.instagram.android',
    pg_temp.baseline('10000000-0000-4000-8000-000000000001',v_sha,999),
    'rex-50-60','test','sql-contract'
  );
  if coalesce((v->>'idempotent_replay')::boolean,false) is not true
     or (select count(*) from public.follow_60s_canary_controls) <> 1 then
    raise exception 'idempotent_replay_failed:%',v;
  end if;

  delete from public.follow_60s_canary_controls;

  -- Legacy scenarios remain valid under their actual server cap.
  perform public.create_or_rearm_follow_60s_canary_control_v1(
    '10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',v_sha,
    0,10,now()+interval '1 day','legacy','com.instagram.android',
    pg_temp.baseline('10000000-0000-4000-8000-000000000002',v_sha),
    'legacy-0-10','test','sql-contract'
  );
  delete from public.follow_60s_canary_controls;
  perform public.create_or_rearm_follow_60s_canary_control_v1(
    '10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003',v_sha,
    40,10,now()+interval '1 day','legacy','com.instagram.android',
    pg_temp.baseline('10000000-0000-4000-8000-000000000002',v_sha),
    'legacy-40-50','test','sql-contract'
  );
  delete from public.follow_60s_canary_controls;

  -- Wrong SHA and business date remain fail-closed.
  begin
    perform public.create_or_rearm_follow_60s_canary_control_v1(
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004',v_sha,
      50,10,now()+interval '1 day','rex','com.instagram.android',
      pg_temp.baseline('10000000-0000-4000-8000-000000000001',repeat('b',40)),
      'wrong-sha','test','sql-contract'
    );
    raise exception 'wrong_sha_accepted';
  exception when others then
    if sqlerrm='wrong_sha_accepted' or sqlerrm not like '%canonical_control_incomplete%' then raise; end if;
  end;
  begin
    perform public.create_or_rearm_follow_60s_canary_control_v1(
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000005',v_sha,
      50,10,now()+interval '1 day','rex','com.instagram.android',
      pg_temp.baseline('10000000-0000-4000-8000-000000000001',v_sha)
        || jsonb_build_object('business_date',v_date-1),
      'wrong-date','test','sql-contract'
    );
    raise exception 'wrong_date_accepted';
  exception when others then
    if sqlerrm='wrong_date_accepted' or sqlerrm not like '%canonical_follow_limit_unresolved%' then raise; end if;
  end;
  if (select count(*) from public.follow_60s_canary_controls) <> 0 then
    raise exception 'failed_transaction_left_partial_control';
  end if;
end $$;

do $$
declare
  v_sha text := repeat('a',40);
begin
  -- Target above cap, baseline at cap, warmup lower, configured hard lower,
  -- package lower, and incomplete configuration all reject atomically.
  begin
    perform public.create_or_rearm_follow_60s_canary_control_v1(
      '10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',v_sha,
      40,20,now()+interval '1 day','cap50','com.instagram.android',
      pg_temp.baseline('10000000-0000-4000-8000-000000000002',v_sha,999),
      'over-50','test','sql-contract');
    raise exception 'over_cap_accepted';
  exception when others then
    if sqlerrm='over_cap_accepted' or sqlerrm not like '%canonical_follow_limit_exceeded%' then raise; end if;
  end;
  begin
    perform public.create_or_rearm_follow_60s_canary_control_v1(
      '10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002',v_sha,
      70,10,now()+interval '1 day','atcap','com.instagram.android',
      pg_temp.baseline('10000000-0000-4000-8000-000000000001',v_sha),
      'at-cap','test','sql-contract');
    raise exception 'baseline_at_cap_accepted';
  exception when others then
    if sqlerrm='baseline_at_cap_accepted' or sqlerrm not like '%canonical_follow_limit_exceeded%' then raise; end if;
  end;
  begin
    perform public.create_or_rearm_follow_60s_canary_control_v1(
      '10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003',v_sha,
      45,10,now()+interval '1 day','warmup','com.instagram.android',
      pg_temp.baseline('10000000-0000-4000-8000-000000000002',v_sha),
      'warmup-wins','test','sql-contract');
    raise exception 'warmup_cap_ignored';
  exception when others then
    if sqlerrm='warmup_cap_ignored' or sqlerrm not like '%canonical_follow_limit_exceeded%' then raise; end if;
  end;
  begin
    perform public.create_or_rearm_follow_60s_canary_control_v1(
      '10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000004',v_sha,
      35,10,now()+interval '1 day','hard','com.instagram.android',
      pg_temp.baseline('10000000-0000-4000-8000-000000000003',v_sha),
      'configured-hard-wins','test','sql-contract');
    raise exception 'configured_hard_cap_ignored';
  exception when others then
    if sqlerrm='configured_hard_cap_ignored' or sqlerrm not like '%canonical_follow_limit_exceeded%' then raise; end if;
  end;
  begin
    perform public.create_or_rearm_follow_60s_canary_control_v1(
      '10000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000005',v_sha,
      40,10,now()+interval '1 day','package','com.instagram.android',
      pg_temp.baseline('10000000-0000-4000-8000-000000000004',v_sha),
      'package-wins','test','sql-contract');
    raise exception 'package_cap_ignored';
  exception when others then
    if sqlerrm='package_cap_ignored' or sqlerrm not like '%canonical_follow_limit_exceeded%' then raise; end if;
  end;
  begin
    perform public.create_or_rearm_follow_60s_canary_control_v1(
      '10000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000006',v_sha,
      50,10,now()+interval '1 day','missing','com.instagram.android',
      pg_temp.baseline('10000000-0000-4000-8000-000000000005',v_sha),
      'missing-cap','test','sql-contract');
    raise exception 'missing_cap_accepted';
  exception when others then
    if sqlerrm='missing_cap_accepted' or sqlerrm not like '%canonical_follow_limit_unresolved%' then raise; end if;
  end;
  if (select count(*) from public.follow_60s_canary_controls) <> 0 then
    raise exception 'rejection_paths_left_partial_control';
  end if;
end $$;

do $$
begin
  if has_function_privilege('anon','public.resolve_authoritative_follow_day_limit_v1(uuid,date)','EXECUTE')
    or has_function_privilege('authenticated','public.resolve_authoritative_follow_day_limit_v1(uuid,date)','EXECUTE')
    or not has_function_privilege('service_role','public.resolve_authoritative_follow_day_limit_v1(uuid,date)','EXECUTE') then
    raise exception 'resolver_least_privilege_failed';
  end if;
end $$;

select 'follow60_canonical_effective_limit_v1_ok' as result;
