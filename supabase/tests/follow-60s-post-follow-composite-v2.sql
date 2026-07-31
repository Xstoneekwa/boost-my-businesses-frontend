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
  id uuid primary key, account_id uuid, status text, total_like integer default 0,
  updated_at timestamptz default now()
);
create table public.account_run_requests (
  id uuid primary key, account_id uuid not null, run_id uuid, status text
);
create table public.follow_60s_canary_controls (
  account_id uuid primary key, status text not null, baseline_follow_count integer default 0,
  evaluation_increment integer default 10, target_follow_count integer default 50,
  run_id uuid, request_id uuid, barrier_reached_at timestamptz,
  hold_armed_at timestamptz, released_at timestamptz,
  metadata_safe jsonb default '{}'::jsonb, updated_at timestamptz default now()
);
create table public.ig_interacted_users (
  id uuid primary key default gen_random_uuid(), account_id uuid, run_id uuid,
  username text not null, source_profile text, interaction_type text not null,
  was_successful boolean, last_interaction_at timestamptz, updated_at timestamptz,
  last_source_profile text, last_run_id uuid, last_session_id text, request_id uuid,
  muted_posts boolean default false, muted_stories boolean default false,
  last_muted_at timestamptz, posts_liked_count integer default 0,
  metadata_safe jsonb default '{}'::jsonb, payload jsonb default '{}'::jsonb
);
create unique index ig_interacted_users_account_username_uidx
  on public.ig_interacted_users(account_id, username);
create table public.ig_interaction_events (
  id uuid primary key default gen_random_uuid(), account_id uuid, run_id uuid,
  request_id uuid, session_id text, username text not null, source_profile text,
  event_type text not null, event_status text not null, event_reason text,
  event_at timestamptz, payload jsonb, interaction_type text,
  interaction_status text, evidence_source text, evidence_confidence text,
  evidence_summary text, metadata_safe jsonb, stage_idempotency_key text
);
create unique index ig_interaction_events_stage_idempotency_uidx
  on public.ig_interaction_events(account_id,run_id,stage_idempotency_key)
  where stage_idempotency_key is not null;
alter table public.ig_interaction_events enable row level security;
alter table public.ig_interacted_users enable row level security;
alter table public.follow_60s_canary_controls enable row level security;

\ir ../migrations/20260731222500_follow_60s_post_follow_composite_v2.sql

insert into public.ig_accounts values ('dfe78a92-3a51-435e-8911-ed10c93a4d82');
insert into public.ig_runs(id,account_id,status,total_like) values
 ('00000000-0000-0000-0000-000000000101','dfe78a92-3a51-435e-8911-ed10c93a4d82','running',0);
insert into public.account_run_requests values
 ('00000000-0000-0000-0000-000000000102','dfe78a92-3a51-435e-8911-ed10c93a4d82','00000000-0000-0000-0000-000000000101','running');
insert into public.follow_60s_canary_controls(account_id,status) values
 ('dfe78a92-3a51-435e-8911-ed10c93a4d82','armed');
insert into public.ig_interacted_users(
 account_id,run_id,request_id,username,source_profile,interaction_type,was_successful,payload
) values (
 'dfe78a92-3a51-435e-8911-ed10c93a4d82','00000000-0000-0000-0000-000000000101',
 '00000000-0000-0000-0000-000000000102','candidate_one','source_ct','follow',true,
 '{"action_id":"00000000-0000-0000-0000-000000000103"}'::jsonb
);

set request.jwt.claim.role='service_role';
select public.bind_follow_60s_canary_runtime_v2(
 'dfe78a92-3a51-435e-8911-ed10c93a4d82','00000000-0000-0000-0000-000000000101',
 '00000000-0000-0000-0000-000000000102',1,'business-session-1'
) as runtime_binding \gset
select public.persist_follow_60s_post_follow_v2(
 'dfe78a92-3a51-435e-8911-ed10c93a4d82','00000000-0000-0000-0000-000000000101',
 '00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000103',
 encode(extensions.digest(convert_to('00000000-0000-0000-0000-000000000103','UTF8'),'sha256'),'hex'),
 'candidate_one','source_ct',1,'business-session-1',true,
 '[{"stage":"mute_posts_verified","event_at":"2026-07-31T20:00:00Z","payload":{}},{"stage":"mute_stories_verified","event_at":"2026-07-31T20:00:01Z","payload":{}},{"stage":"like_verified","event_at":"2026-07-31T20:00:02Z","payload":{"liked_count":1}},{"stage":"return_ct_exact","event_at":"2026-07-31T20:00:03Z","payload":{"return_ok":true}}]'::jsonb
) as first_apply \gset

do $$
declare i integer;
begin
  for i in 1..10 loop
    perform public.persist_follow_60s_post_follow_v2(
      'dfe78a92-3a51-435e-8911-ed10c93a4d82','00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000103',
      encode(extensions.digest(convert_to('00000000-0000-0000-0000-000000000103','UTF8'),'sha256'),'hex'),
      'candidate_one','source_ct',1,'business-session-1',true,
      '[{"stage":"mute_posts_verified","event_at":"2026-07-31T20:00:00Z","payload":{}},{"stage":"mute_stories_verified","event_at":"2026-07-31T20:00:01Z","payload":{}},{"stage":"like_verified","event_at":"2026-07-31T20:00:02Z","payload":{"liked_count":1}},{"stage":"return_ct_exact","event_at":"2026-07-31T20:00:03Z","payload":{"return_ok":true}}]'::jsonb
    );
  end loop;
  if (select count(*) from public.ig_interaction_events) <> 4 then
    raise exception 'idempotence_event_count_failed';
  end if;
  if (select total_like from public.ig_runs where id='00000000-0000-0000-0000-000000000101') <> 1 then
    raise exception 'idempotence_run_like_failed';
  end if;
  if (select posts_liked_count from public.ig_interacted_users where username='candidate_one') <> 1 then
    raise exception 'idempotence_projection_like_failed';
  end if;
  if has_function_privilege('anon','public.persist_follow_60s_post_follow_v2(uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.persist_follow_60s_post_follow_v2(uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.persist_follow_60s_post_follow_v2(uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb)','EXECUTE') then
    raise exception 'least_privilege_failed';
  end if;
  if has_function_privilege('anon','public.bind_follow_60s_canary_runtime_v2(uuid,uuid,uuid,integer,text)','EXECUTE')
    or has_function_privilege('authenticated','public.bind_follow_60s_canary_runtime_v2(uuid,uuid,uuid,integer,text)','EXECUTE')
    or not has_function_privilege('service_role','public.bind_follow_60s_canary_runtime_v2(uuid,uuid,uuid,integer,text)','EXECUTE') then
    raise exception 'binding_least_privilege_failed';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.ig_interaction_events'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.ig_interacted_users'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.follow_60s_canary_controls'::regclass) then
    raise exception 'rls_verification_failed';
  end if;
end $$;

-- Partial Stop receipt: only already-verified Mute Posts and Stories persist.
insert into public.ig_interacted_users(
 account_id,run_id,request_id,username,source_profile,interaction_type,was_successful,payload
) values (
 'dfe78a92-3a51-435e-8911-ed10c93a4d82','00000000-0000-0000-0000-000000000101',
 '00000000-0000-0000-0000-000000000102','candidate_partial','source_ct','follow',true,
 '{"action_id":"00000000-0000-0000-0000-000000000104"}'::jsonb
);
select public.persist_follow_60s_post_follow_v2(
 'dfe78a92-3a51-435e-8911-ed10c93a4d82','00000000-0000-0000-0000-000000000101',
 '00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000104',
 encode(extensions.digest(convert_to('00000000-0000-0000-0000-000000000104','UTF8'),'sha256'),'hex'),
 'candidate_partial','source_ct',1,'business-session-1',false,
 '[{"stage":"mute_posts_verified","event_at":"2026-07-31T20:01:00Z","payload":{}},{"stage":"mute_stories_verified","event_at":"2026-07-31T20:01:01Z","payload":{}}]'::jsonb
);
do $$ begin
  if (select count(*) from public.ig_interaction_events where username='candidate_partial') <> 2
    or (select total_like from public.ig_runs where id='00000000-0000-0000-0000-000000000101') <> 1 then
    raise exception 'partial_receipt_projection_failed';
  end if;
end $$;

-- Exact binding rejects a candidate, hash, request or account mismatch.
do $$
begin
  begin
    perform public.persist_follow_60s_post_follow_v2(
      'dfe78a92-3a51-435e-8911-ed10c93a4d82','00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000103',
      encode(extensions.digest(convert_to('00000000-0000-0000-0000-000000000103','UTF8'),'sha256'),'hex'),
      'wrong_candidate','source_ct',1,'business-session-1',false,
      '[{"stage":"like_verified","event_at":"2026-07-31T20:02:00Z","payload":{"liked_count":1}}]'::jsonb
    );
    raise exception 'candidate_mismatch_was_accepted';
  exception when others then
    if sqlerrm = 'candidate_mismatch_was_accepted'
      or sqlerrm not like '%follow_60s_canonical_follow_missing%' then raise; end if;
  end;
  begin
    perform public.persist_follow_60s_post_follow_v2(
      'dfe78a92-3a51-435e-8911-ed10c93a4d82','00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000103',
      repeat('0',64),'candidate_one','source_ct',1,'business-session-1',false,
      '[{"stage":"like_verified","event_at":"2026-07-31T20:02:00Z","payload":{"liked_count":1}}]'::jsonb
    );
    raise exception 'action_hash_mismatch_was_accepted';
  exception when others then
    if sqlerrm = 'action_hash_mismatch_was_accepted'
      or sqlerrm not like '%follow60_stage_binding_missing_or_invalid%' then raise; end if;
  end;
  begin
    perform public.persist_follow_60s_post_follow_v2(
      'dfe78a92-3a51-435e-8911-ed10c93a4d82','00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000998','00000000-0000-0000-0000-000000000103',
      encode(extensions.digest(convert_to('00000000-0000-0000-0000-000000000103','UTF8'),'sha256'),'hex'),
      'candidate_one','source_ct',1,'business-session-1',false,
      '[{"stage":"like_verified","event_at":"2026-07-31T20:02:00Z","payload":{"liked_count":1}}]'::jsonb
    );
    raise exception 'request_mismatch_was_accepted';
  exception when others then
    if sqlerrm = 'request_mismatch_was_accepted'
      or sqlerrm not like '%follow_60s_run_request_binding_mismatch%' then raise; end if;
  end;
  begin
    perform public.persist_follow_60s_post_follow_v2(
      '00000000-0000-0000-0000-000000000999','00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000103',
      encode(extensions.digest(convert_to('00000000-0000-0000-0000-000000000103','UTF8'),'sha256'),'hex'),
      'candidate_one','source_ct',1,'business-session-1',false,
      '[{"stage":"like_verified","event_at":"2026-07-31T20:02:00Z","payload":{"liked_count":1}}]'::jsonb
    );
    raise exception 'account_mismatch_was_accepted';
  exception when others then
    if sqlerrm = 'account_mismatch_was_accepted'
      or sqlerrm not like '%follow60_stage_binding_missing_or_invalid%' then raise; end if;
  end;
end $$;

-- Original exact run may replay after the operator hold; no other binding may.
update public.follow_60s_canary_controls
set status='waiting_operator_evaluation', hold_armed_at=now()
where account_id='dfe78a92-3a51-435e-8911-ed10c93a4d82';
select public.persist_follow_60s_post_follow_v2(
 'dfe78a92-3a51-435e-8911-ed10c93a4d82','00000000-0000-0000-0000-000000000101',
 '00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000103',
 encode(extensions.digest(convert_to('00000000-0000-0000-0000-000000000103','UTF8'),'sha256'),'hex'),
 'candidate_one','source_ct',1,'business-session-1',false,
 '[{"stage":"like_verified","event_at":"2026-07-31T20:00:02Z","payload":{"liked_count":1}}]'::jsonb
);

\ir ../rollback/20260731222500_follow_60s_post_follow_composite_v2.down.sql
do $$ begin
  if to_regprocedure('public.persist_follow_60s_post_follow_v2(uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb)') is not null then
    raise exception 'rollback_failed';
  end if;
  if to_regprocedure('public.bind_follow_60s_canary_runtime_v2(uuid,uuid,uuid,integer,text)') is not null then
    raise exception 'binding_rollback_failed';
  end if;
end $$;
