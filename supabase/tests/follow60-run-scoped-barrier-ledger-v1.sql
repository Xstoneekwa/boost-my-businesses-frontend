\set ON_ERROR_STOP on

create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;
create role anon;
create role authenticated;
create role service_role;
create function auth.role() returns text language sql stable
as $$ select current_setting('request.jwt.claim.role', true) $$;

create table public.ig_accounts (id uuid primary key);
create table public.ig_runs (
  id uuid primary key, account_id uuid not null, status text,
  total_like integer default 0, updated_at timestamptz default now()
);
create table public.account_run_requests (
  id uuid primary key, account_id uuid not null, run_id uuid, status text
);
create table public.follow_60s_canary_controls (
  account_id uuid primary key, status text not null,
  baseline_follow_count integer not null default 0,
  evaluation_increment integer not null default 10,
  target_follow_count integer not null default 50,
  run_id uuid, request_id uuid, barrier_reached_at timestamptz,
  hold_armed_at timestamptz, released_at timestamptz,
  metadata_safe jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.ig_interacted_users (
  id uuid primary key default gen_random_uuid(), account_id uuid, run_id uuid,
  request_id uuid, username text not null, interaction_type text not null,
  was_successful boolean, payload jsonb default '{}'::jsonb
);
create table public.ig_interaction_events (
  id uuid primary key default gen_random_uuid(), account_id uuid, run_id uuid,
  request_id uuid, username text not null, event_type text not null,
  event_status text not null, stage_idempotency_key text
);

insert into public.ig_accounts values ('10000000-0000-0000-0000-000000000001');
insert into public.ig_runs values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001','running',0,now()
);
insert into public.account_run_requests values (
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001','running'
);
insert into public.follow_60s_canary_controls (
  account_id,status,baseline_follow_count,evaluation_increment,target_follow_count,
  run_id,request_id,metadata_safe
) values (
  '10000000-0000-0000-0000-000000000001','running',0,10,50,
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  jsonb_build_object(
    'control_id','40000000-0000-0000-0000-000000000001',
    'attempt_id',1,'business_session_id','business-session-ledger',
    'expected_worker_sha',repeat('a',40),'baseline_release_sha',repeat('a',40),
    'runtime_binding_consumed',true,
    'baseline_account_id','10000000-0000-0000-0000-000000000001'
  )
);

\ir ../migrations/20260803180535_follow60_run_scoped_barrier_ledger_v1.sql
set request.jwt.claim.role='service_role';

create function pg_temp.seed_cycle(p_index integer, p_source text, p_like boolean)
returns table(action_id text, action_hash text)
language plpgsql as $$
declare v_action text := 'action-' || p_index::text; v_hash text;
begin
  v_hash := encode(extensions.digest(convert_to(v_action,'UTF8'),'sha256'),'hex');
  insert into public.ig_interacted_users(account_id,run_id,request_id,username,interaction_type,was_successful,payload)
  values (
    '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001','candidate_'||p_index,'follow',true,
    jsonb_build_object('action_id',v_action)
  );
  insert into public.ig_interaction_events(account_id,run_id,request_id,username,event_type,event_status,stage_idempotency_key)
  select '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001','candidate_'||p_index,stage,'success',
    'follow60:v2:'||v_hash||':'||stage
  from unnest(array['mute_posts_verified','mute_stories_verified','return_ct_exact']) stage;
  if p_like then
    insert into public.ig_interaction_events(account_id,run_id,request_id,username,event_type,event_status,stage_idempotency_key)
    values (
      '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001','candidate_'||p_index,'like_verified','success',
      'follow60:v2:'||v_hash||':like_verified'
    );
  end if;
  return query select v_action,v_hash;
end $$;

do $$
declare i integer; v_action text; v_hash text; v_out jsonb;
begin
  for i in 1..10 loop
    select action_id,action_hash into v_action,v_hash
      from pg_temp.seed_cycle(i,case when i<=9 then 'ct_a' else 'ct_b' end,i<>5);
    select public.ack_follow_60s_completed_cycle_v1(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      v_action,v_hash,1,'business-session-ledger','candidate_'||i,
      case when i<=9 then 'ct_a' else 'ct_b' end,repeat('a',40),
      case when i=5 then 'safe_skip' else 'verified' end,
      case when i=5 then 'post_like_skipped_no_posts_yet' else 'like_verified' end
    ) into v_out;
    if (v_out->>'new_cycle_count')::integer <> i then
      raise exception 'run_scoped_count_failed_at_%',i;
    end if;
    if i<10 and coalesce((v_out->>'next_candidate_permitted')::boolean,false) is not true then
      raise exception 'premature_barrier_at_%',i;
    end if;
  end loop;
  if (v_out->>'cycle_was_new')::boolean is not true
    or (v_out->>'barrier_reached')::boolean is not true
    or (v_out->>'next_candidate_permitted')::boolean is not false
    or v_out->>'terminal_status' <> 'completed_waiting_operator_evaluation'
    or (v_out->>'revision')::integer <> 10 then
    raise exception 'tenth_cycle_barrier_contract_failed:%',v_out;
  end if;
  if (select status from public.follow_60s_canary_controls) <> 'waiting_operator_evaluation' then
    raise exception 'control_hold_not_installed';
  end if;
end $$;

-- Replaying cycle 10 ten times is idempotent, including after the hold.
do $$
declare i integer; v_hash text; v_out jsonb;
begin
  v_hash:=encode(extensions.digest(convert_to('action-10','UTF8'),'sha256'),'hex');
  for i in 1..10 loop
    select public.ack_follow_60s_completed_cycle_v1(
      '40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
      'action-10',v_hash,1,'business-session-ledger','candidate_10','ct_b',repeat('a',40),
      'verified','like_verified'
    ) into v_out;
    if (v_out->>'cycle_was_new')::boolean is not false
      or (v_out->>'new_cycle_count')::integer <> 10
      or (v_out->>'revision')::integer <> 10 then
      raise exception 'replay_not_idempotent:%',v_out;
    end if;
  end loop;
  if (select count(*) from public.follow_60s_completed_cycle_ledger) <> 10 then
    raise exception 'ledger_duplicate_rows';
  end if;
end $$;

-- An eleventh distinct cycle cannot be admitted after the transactional hold.
do $$
declare v_action text; v_hash text;
begin
  select action_id,action_hash into v_action,v_hash from pg_temp.seed_cycle(11,'ct_b',true);
  begin
    perform public.ack_follow_60s_completed_cycle_v1(
      '40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
      v_action,v_hash,1,'business-session-ledger','candidate_11','ct_b',repeat('a',40),
      'verified','like_verified'
    );
    raise exception 'eleventh_cycle_was_accepted';
  exception when others then
    if sqlerrm='eleventh_cycle_was_accepted'
      or sqlerrm not like '%follow60_cycle_ledger_control_not_running%' then raise; end if;
  end;
end $$;

-- Exact runtime bindings and receipt prerequisites fail closed.
do $$
declare v_hash text := encode(extensions.digest(convert_to('action-10','UTF8'),'sha256'),'hex');
begin
  begin
    perform public.ack_follow_60s_completed_cycle_v1(
      '40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
      'action-10',v_hash,1,'business-session-ledger','candidate_10','ct_b',repeat('b',40),
      'verified','like_verified'
    );
    raise exception 'wrong_sha_was_accepted';
  exception when others then
    if sqlerrm='wrong_sha_was_accepted'
      or sqlerrm not like '%runtime_binding_mismatch%' then raise; end if;
  end;
  if has_function_privilege('anon','public.ack_follow_60s_completed_cycle_v1(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,text,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.ack_follow_60s_completed_cycle_v1(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,text,text,text)','EXECUTE')
    or not has_function_privilege('service_role','public.ack_follow_60s_completed_cycle_v1(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,text,text,text)','EXECUTE') then
    raise exception 'ledger_least_privilege_failed';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.follow_60s_completed_cycle_ledger'::regclass) then
    raise exception 'ledger_rls_disabled';
  end if;
end $$;

\ir ../rollback/20260803180535_follow60_run_scoped_barrier_ledger_v1.down.sql
do $$ begin
  if to_regprocedure('public.ack_follow_60s_completed_cycle_v1(uuid,uuid,uuid,uuid,text,text,integer,text,text,text,text,text,text)') is not null
    or to_regclass('public.follow_60s_completed_cycle_ledger') is not null then
    raise exception 'ledger_rollback_failed';
  end if;
end $$;
