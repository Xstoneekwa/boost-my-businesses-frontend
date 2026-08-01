\set ON_ERROR_STOP on
create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create function auth.role() returns text language sql stable
as $$ select current_setting('request.jwt.claim.role',true) $$;

create table public.ig_runs(
  id uuid primary key,account_id uuid,status text,total_like integer default 0,
  updated_at timestamptz default now()
);
create table public.account_run_requests(
  id uuid primary key,account_id uuid,run_id uuid,status text
);
create table public.follow_60s_canary_controls(
  account_id uuid primary key,status text,baseline_follow_count integer default 0,
  evaluation_increment integer default 10,target_follow_count integer default 20,
  run_id uuid,request_id uuid,barrier_reached_at timestamptz,
  hold_armed_at timestamptz,released_at timestamptz,
  metadata_safe jsonb default '{}'::jsonb,updated_at timestamptz default now()
);
create table public.ig_interacted_users(
  id uuid primary key default gen_random_uuid(),account_id uuid,run_id uuid,
  username text,source_profile text,interaction_type text,was_successful boolean,
  last_interaction_at timestamptz,updated_at timestamptz,last_source_profile text,
  last_run_id uuid,last_session_id text,request_id uuid,muted_posts boolean default false,
  muted_stories boolean default false,last_muted_at timestamptz,
  posts_liked_count integer default 0,metadata_safe jsonb default '{}'::jsonb,
  payload jsonb default '{}'::jsonb
);
create unique index ig_interacted_users_account_username_uidx
  on public.ig_interacted_users(account_id,username);
create table public.ig_interaction_events(
  id uuid primary key default gen_random_uuid(),account_id uuid,run_id uuid,
  request_id uuid,session_id text,username text,source_profile text,event_type text,
  event_status text,event_reason text,event_at timestamptz,payload jsonb,
  interaction_type text,interaction_status text,evidence_source text,
  evidence_confidence text,evidence_summary text,metadata_safe jsonb,
  stage_idempotency_key text
);
create unique index ig_interaction_events_stage_idempotency_uidx
  on public.ig_interaction_events(account_id,run_id,stage_idempotency_key)
  where stage_idempotency_key is not null;

create function public.get_follow_60s_canary_control_v1(uuid) returns jsonb
language sql security definer set search_path='' as $$select '{"legacy":true}'::jsonb$$;
create function public.persist_follow_60s_post_follow_v2(
  uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb
) returns jsonb language sql security definer set search_path=''
as $$select '{"legacy":true}'::jsonb$$;
create function public.terminalize_follow_60s_canary_control_v1(
  uuid,uuid,uuid,uuid,text,text,jsonb
) returns jsonb language sql security definer set search_path=''
as $$select '{"legacy":true}'::jsonb$$;
grant execute on function public.get_follow_60s_canary_control_v1(uuid) to service_role;
grant execute on function public.persist_follow_60s_post_follow_v2(
  uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb
) to service_role;
grant execute on function public.terminalize_follow_60s_canary_control_v1(
  uuid,uuid,uuid,uuid,text,text,jsonb
) to service_role;

\ir ../migrations/20260801224629_follow60_postfollow_generic_control_lifecycle_v1.sql
set request.jwt.claim.role='service_role';

insert into public.ig_runs values
 ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','running',0,now()),
 ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000011','running',0,now()),
 ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000011','running',0,now());
insert into public.account_run_requests values
 ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','running'),
 ('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001','running'),
 ('30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000001','running');
insert into public.follow_60s_canary_controls values
 ('10000000-0000-4000-8000-000000000011','running',0,10,20,
  '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',null,null,null,
  jsonb_build_object('control_id','10000000-0000-4000-8000-000000000003','attempt_id',1,
   'business_session_id','session-a','runtime_binding_consumed',true,
   'runtime_binding_schema','FOLLOW_60S_RUNTIME_BINDING_V3',
   'binding_version','FOLLOW_60S_CANARY_BINDING_V2',
   'expected_worker_sha',repeat('a',40),'baseline_release_sha',repeat('a',40),
   'baseline_account_id','10000000-0000-4000-8000-000000000011',
   'expires_at',now()+interval '1 day'),now()),
 ('20000000-0000-4000-8000-000000000011','disabled',0,10,20,null,null,null,null,null,'{}',now()),
 ('30000000-0000-4000-8000-000000000011','disabled',0,10,20,null,null,null,null,null,'{}',now());
insert into public.ig_interacted_users(
 account_id,run_id,request_id,username,source_profile,interaction_type,was_successful,payload
) values (
 '10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000002','candidate_a','source_a','follow',true,
 '{"action_id":"action-a"}'
);

do $$
declare v jsonb; i integer;
begin
  v:=public.get_follow_60s_canary_control_v1('10000000-0000-4000-8000-000000000011');
  if coalesce((v->>'binding_valid')::boolean,false) is not true
    or v->>'control_id'<>'10000000-0000-4000-8000-000000000003' then
    raise exception 'binding_projection_failed';
  end if;
  for i in 1..10 loop
    perform public.persist_follow_60s_post_follow_v2(
      '10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002','action-a',
      encode(extensions.digest(convert_to('action-a','UTF8'),'sha256'),'hex'),
      'candidate_a','source_a',1,'session-a',true,
      '[{"stage":"mute_posts_verified","event_at":"2026-08-01T20:00:00Z","payload":{}},{"stage":"mute_stories_verified","event_at":"2026-08-01T20:00:01Z","payload":{}},{"stage":"like_verified","event_at":"2026-08-01T20:00:02Z","payload":{"liked_count":1}},{"stage":"return_ct_exact","event_at":"2026-08-01T20:00:03Z","payload":{}}]'
    );
  end loop;
  if (select count(*) from public.ig_interaction_events)<>4
    or (select total_like from public.ig_runs where id='10000000-0000-4000-8000-000000000001')<>1
    or (select posts_liked_count from public.ig_interacted_users where username='candidate_a')<>1 then
    raise exception 'generic_idempotence_failed';
  end if;
  if has_function_privilege('anon','public.persist_follow_60s_post_follow_v2(uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.persist_follow_60s_post_follow_v2(uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.persist_follow_60s_post_follow_v2(uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb)','EXECUTE') then
    raise exception 'least_privilege_failed';
  end if;
end $$;

select public.terminalize_follow_60s_canary_control_v1(
 '10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000011',
 '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
 'waiting_operator_evaluation','barrier', '{}'
);
do $$ begin
  begin
    perform public.persist_follow_60s_post_follow_v2(
      '10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002','action-a',
      encode(extensions.digest(convert_to('action-a','UTF8'),'sha256'),'hex'),
      'candidate_a','source_a',1,'session-a',false,
      '[{"stage":"like_verified","event_at":"2026-08-01T20:00:02Z","payload":{"liked_count":1}}]'
    ); raise exception 'waiting_partial_was_accepted';
  exception when others then
    if sqlerrm='waiting_partial_was_accepted'
      or sqlerrm not like '%follow_60s_control_binding_mismatch%' then raise; end if;
  end;
end $$;
select public.persist_follow_60s_post_follow_v2(
 '10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000002','action-a',
 encode(extensions.digest(convert_to('action-a','UTF8'),'sha256'),'hex'),
 'candidate_a','source_a',1,'session-a',true,
 '[{"stage":"mute_posts_verified","event_at":"2026-08-01T20:00:00Z","payload":{}},{"stage":"mute_stories_verified","event_at":"2026-08-01T20:00:01Z","payload":{}},{"stage":"like_verified","event_at":"2026-08-01T20:00:02Z","payload":{"liked_count":1}},{"stage":"return_ct_exact","event_at":"2026-08-01T20:00:03Z","payload":{}}]'
);
select public.terminalize_follow_60s_canary_control_v1(
 '10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000011',
 '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
 'completed','run_completed','{}'
);
do $$ begin
 if (select status from public.follow_60s_canary_controls
      where account_id='10000000-0000-4000-8000-000000000011')<>'completed' then
   raise exception 'terminalization_failed';
 end if;
end $$;

-- A second and third unrelated account prove that no username/account allowlist
-- remains in the persistence function.
update public.follow_60s_canary_controls set status='running',
 run_id='20000000-0000-4000-8000-000000000001',
 request_id='20000000-0000-4000-8000-000000000002',
 metadata_safe=jsonb_build_object(
  'control_id','20000000-0000-4000-8000-000000000003','attempt_id',1,
  'business_session_id','session-b','runtime_binding_consumed',true,
  'runtime_binding_schema','FOLLOW_60S_RUNTIME_BINDING_V3',
  'binding_version','FOLLOW_60S_CANARY_BINDING_V2','expected_worker_sha',repeat('b',40),
  'baseline_release_sha',repeat('b',40),
  'baseline_account_id','20000000-0000-4000-8000-000000000011',
  'expires_at',now()+interval '1 day')
where account_id='20000000-0000-4000-8000-000000000011';
insert into public.ig_interacted_users(
 account_id,run_id,request_id,username,source_profile,interaction_type,was_successful,payload
) values (
 '20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000002','candidate_b','source_b','follow',true,
 '{"action_id":"action-b"}'
);
select public.persist_follow_60s_post_follow_v2(
 '20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000002','action-b',
 encode(extensions.digest(convert_to('action-b','UTF8'),'sha256'),'hex'),
 'candidate_b','source_b',1,'session-b',false,
 '[{"stage":"mute_posts_verified","event_at":"2026-08-01T20:01:00Z","payload":{}}]'
);
select public.terminalize_follow_60s_canary_control_v1(
 '20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000011',
 '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',
 'canceled','operator_stop','{}'
);

update public.follow_60s_canary_controls set status='running',
 run_id='30000000-0000-4000-8000-000000000001',
 request_id='30000000-0000-4000-8000-000000000002',
 metadata_safe=jsonb_build_object(
  'control_id','30000000-0000-4000-8000-000000000003','attempt_id',1,
  'business_session_id','session-c','runtime_binding_consumed',true,
  'runtime_binding_schema','FOLLOW_60S_RUNTIME_BINDING_V3',
  'binding_version','FOLLOW_60S_CANARY_BINDING_V2','expected_worker_sha',repeat('c',40),
  'baseline_release_sha',repeat('c',40),
  'baseline_account_id','30000000-0000-4000-8000-000000000011',
  'expires_at',now()+interval '1 day')
where account_id='30000000-0000-4000-8000-000000000011';
insert into public.ig_interacted_users(
 account_id,run_id,request_id,username,source_profile,interaction_type,was_successful,payload
) values (
 '30000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000002','candidate_c','source_c','follow',true,
 '{"action_id":"action-c"}'
);
select public.persist_follow_60s_post_follow_v2(
 '30000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000002','action-c',
 encode(extensions.digest(convert_to('action-c','UTF8'),'sha256'),'hex'),
 'candidate_c','source_c',1,'session-c',false,
 '[{"stage":"like_verified","event_at":"2026-08-01T20:02:00Z","payload":{"liked_count":1}}]'
);
select public.terminalize_follow_60s_canary_control_v1(
 '30000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000011',
 '30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002',
 'activation_failed','postfollow_persistence_failed','{}'
);
do $$ begin
 if (select count(distinct account_id) from public.ig_interaction_events)<>3 then
   raise exception 'three_account_generic_contract_failed';
 end if;
 if exists(select 1 from public.follow_60s_canary_controls where status='running') then
   raise exception 'terminal_run_left_control_running';
 end if;
end $$;

\ir ../rollback/20260801224629_follow60_postfollow_generic_control_lifecycle_v1.down.sql
do $$ begin
 if coalesce((public.get_follow_60s_canary_control_v1(gen_random_uuid())->>'legacy')::boolean,false) is not true then
   raise exception 'rollback_predecessor_not_restored';
 end if;
end $$;
