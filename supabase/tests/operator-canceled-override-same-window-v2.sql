\set ON_ERROR_STOP on
set request.jwt.claim.role = 'service_role';

create or replace function pg_temp.reset_fixture() returns void language plpgsql as $$
begin
  truncate account_package_runtime_contract_events, instagram_account_restriction_holds,
    incident_resume_authorizations, account_dashboard_actions, account_incidents,
    account_session_resume_plans, auto_restart_device_locks, ig_runs,
    account_run_requests, ig_account_settings, account_assignments;
end $$;

create or replace function pg_temp.seed_canceled(
  p_account uuid, p_assignment uuid, p_device uuid, p_run uuid, p_request uuid,
  p_key text, p_start timestamptz default now() - interval '5 minutes',
  p_end timestamptz default now() + interval '2 hours'
) returns void language plpgsql as $$
begin
  insert into account_assignments(id,account_id,device_id,status,schedule_mode,assignment_type,starts_at,ends_at)
  values(p_assignment,p_account,p_device,'active','scheduled','full_cycle',p_start,p_end);
  insert into ig_account_settings(account_id) values(p_account);
  insert into account_run_requests(id,account_id,source_surface,requested_run_type,status,
    idempotency_key,run_id,cancel_requested_at,started_at)
  values(p_request,p_account,'instagram_schedule_session_cron','account_session','canceled',
    p_key,p_run,now(),now()-interval '2 minutes');
  insert into ig_runs(id,account_id,status,started_at)
  values(p_run,p_account,'stopped',now()-interval '2 minutes');
  insert into account_session_resume_plans(run_id,run_request_id,account_id,resume_stage,
    resume_state,restart_allowed,restart_block_reason,terminal_reason_code)
  values(p_run,p_request,p_account,'completed','completed',false,'operator_canceled','operator_canceled');
end $$;

do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000001';
  s constant uuid := '20000000-0000-4000-8000-000000000001';
  d constant uuid := '30000000-0000-4000-8000-000000000001';
  r constant uuid := '40000000-0000-4000-8000-000000000001';
  q constant uuid := '50000000-0000-4000-8000-000000000001';
  result jsonb;
begin
  perform pg_temp.reset_fixture();
  perform pg_temp.seed_canceled(a,s,d,r,q,'base:window:clean');
  result := create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',
    now()+interval '2 hours','base:window:clean','pg-cert');
  if not coalesce((result->>'created')::boolean,false) or result->>'retry_ordinal' <> '1' then
    raise exception 'clean operator-canceled retry failed: %', result;
  end if;
  if (select status from account_run_requests where id=q) <> 'canceled'
     or (select idempotency_key from account_run_requests where id=q) <> 'base:window:clean' then
    raise exception 'base request mutated';
  end if;
  update account_run_requests set status='canceled',cancel_requested_at=now()
  where metadata_safe->>'retry_of_request_id'=q::text;
  result := create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',
    now()+interval '2 hours','base:window:clean','pg-cert');
  if result->>'reason' <> 'scheduled_retry_limit_reached' then
    raise exception 'default retry limit is not one: %', result;
  end if;
end $$;

do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000002';
  s constant uuid := '20000000-0000-4000-8000-000000000002';
  d constant uuid := '30000000-0000-4000-8000-000000000002';
  r constant uuid := '40000000-0000-4000-8000-000000000002';
  q constant uuid := '50000000-0000-4000-8000-000000000002';
  i constant uuid := '60000000-0000-4000-8000-000000000002';
  result jsonb;
begin
  perform pg_temp.reset_fixture(); perform pg_temp.seed_canceled(a,s,d,r,q,'base:block:challenge');
  insert into account_incidents(id,account_id,status,incident_type,created_at)
  values(i,a,'open','instagram_human_confirmation_required',now()-interval '1 day');
  result := create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',now()+interval '2 hours','base:block:challenge','pg-cert',null,1,60);
  if coalesce((result->>'created')::boolean,false) then raise exception 'challenge blocker bypassed'; end if;
end $$;

do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000003'; s constant uuid := '20000000-0000-4000-8000-000000000003';
  d constant uuid := '30000000-0000-4000-8000-000000000003'; r constant uuid := '40000000-0000-4000-8000-000000000003';
  q constant uuid := '50000000-0000-4000-8000-000000000003'; i constant uuid := '60000000-0000-4000-8000-000000000003'; result jsonb;
begin
  perform pg_temp.reset_fixture(); perform pg_temp.seed_canceled(a,s,d,r,q,'base:block:restriction');
  insert into account_incidents(id,account_id,status,incident_type,created_at) values(i,a,'resolved','instagram_account_restriction',now()-interval '1 day');
  insert into instagram_account_restriction_holds(account_id,incident_id,status) values(a,i,'verification_required');
  result := create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',now()+interval '2 hours','base:block:restriction','pg-cert',null,1,60);
  if coalesce((result->>'created')::boolean,false) then raise exception 'restriction hold bypassed'; end if;
end $$;

do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000004'; s constant uuid := '20000000-0000-4000-8000-000000000004';
  d constant uuid := '30000000-0000-4000-8000-000000000004'; r constant uuid := '40000000-0000-4000-8000-000000000004';
  q constant uuid := '50000000-0000-4000-8000-000000000004'; i constant uuid := '60000000-0000-4000-8000-000000000004'; result jsonb;
begin
  perform pg_temp.reset_fixture(); perform pg_temp.seed_canceled(a,s,d,r,q,'base:block:identity');
  insert into account_incidents(id,account_id,status,incident_type,created_at) values(i,a,'open','active_instagram_account_mismatch',now()-interval '1 day');
  result := create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',now()+interval '2 hours','base:block:identity','pg-cert',null,1,60);
  if coalesce((result->>'created')::boolean,false) then raise exception 'identity blocker bypassed'; end if;
end $$;

do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000005'; s constant uuid := '20000000-0000-4000-8000-000000000005';
  d constant uuid := '30000000-0000-4000-8000-000000000005'; r constant uuid := '40000000-0000-4000-8000-000000000005';
  q constant uuid := '50000000-0000-4000-8000-000000000005'; result jsonb;
begin
  perform pg_temp.reset_fixture(); perform pg_temp.seed_canceled(a,s,d,r,q,'base:block:action');
  insert into account_dashboard_actions(account_id,status,blocking_campaign,requires_client_action) values(a,'pending',true,true);
  result := create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',now()+interval '2 hours','base:block:action','pg-cert',null,1,60);
  if coalesce((result->>'created')::boolean,false) then raise exception 'dashboard action blocker bypassed'; end if;
end $$;

do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000015'; s constant uuid := '20000000-0000-4000-8000-000000000015';
  d constant uuid := '30000000-0000-4000-8000-000000000015'; r constant uuid := '40000000-0000-4000-8000-000000000015';
  q constant uuid := '50000000-0000-4000-8000-000000000015'; i constant uuid := '60000000-0000-4000-8000-000000000015'; result jsonb;
begin
  perform pg_temp.reset_fixture(); perform pg_temp.seed_canceled(a,s,d,r,q,'base:stale:action');
  insert into account_incidents(id,account_id,status,resolved_at,incident_type,created_at)
  values(i,a,'resolved',now(),'historical_incident',now()-interval '1 day');
  insert into account_dashboard_actions(account_id,incident_id,status,blocking_campaign,requires_client_action)
  values(a,i,'pending',true,true);
  result := create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',now()+interval '2 hours','base:stale:action','pg-cert',null,1,60);
  if not coalesce((result->>'created')::boolean,false) then raise exception 'stale linked action falsely blocked retry: %',result; end if;
end $$;

do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000006'; s constant uuid := '20000000-0000-4000-8000-000000000006';
  d constant uuid := '30000000-0000-4000-8000-000000000006'; r constant uuid := '40000000-0000-4000-8000-000000000006';
  q constant uuid := '50000000-0000-4000-8000-000000000006'; i constant uuid := '60000000-0000-4000-8000-000000000006'; result jsonb;
begin
  perform pg_temp.reset_fixture(); perform pg_temp.seed_canceled(a,s,d,r,q,'base:override:clean');
  insert into account_incidents(id,account_id,run_id,status,source,incident_type,metadata,created_at)
  values(i,a,r,'open','instagram_ui','instagram_human_confirmation_required',jsonb_build_object('request_id',q),now()-interval '1 minute');
  insert into account_dashboard_actions(account_id,incident_id,status,blocking_campaign,requires_client_action) values(a,i,'pending',true,true);
  insert into incident_resume_authorizations(incident_id,account_id,run_id,status) values(i,a,r,'armed');
  insert into instagram_account_restriction_holds(account_id,incident_id,status) values(a,i,'active');
  result := reconcile_operator_canceled_run_v1(a,r,q);
  if not coalesce((result->>'ok')::boolean,false) then raise exception 'override rejected: %', result; end if;
  if (select status from account_incidents where id=i) <> 'resolved'
    or (select status from account_dashboard_actions where incident_id=i) <> 'resolved'
    or (select blocking_campaign from account_dashboard_actions where incident_id=i)
    or (select status from incident_resume_authorizations where incident_id=i) <> 'revoked'
    or (select status from instagram_account_restriction_holds where incident_id=i) <> 'superseded' then
    raise exception 'run-scoped override incomplete';
  end if;
  result := create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',now()+interval '2 hours','base:override:clean','pg-cert',null,1,60);
  if not coalesce((result->>'created')::boolean,false) then raise exception 'clean post-override retry rejected: %', result; end if;
end $$;

do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000007'; s constant uuid := '20000000-0000-4000-8000-000000000007';
  d constant uuid := '30000000-0000-4000-8000-000000000007'; r constant uuid := '40000000-0000-4000-8000-000000000007';
  q constant uuid := '50000000-0000-4000-8000-000000000007'; old_i constant uuid := '60000000-0000-4000-8000-000000000007';
  run_i constant uuid := '70000000-0000-4000-8000-000000000007'; result jsonb;
begin
  perform pg_temp.reset_fixture(); perform pg_temp.seed_canceled(a,s,d,r,q,'base:override:preexisting');
  insert into account_incidents(id,account_id,status,incident_type,created_at) values(old_i,a,'resolved','instagram_account_restriction',now()-interval '1 day');
  insert into instagram_account_restriction_holds(account_id,incident_id,status) values(a,old_i,'active');
  insert into account_incidents(id,account_id,run_id,status,source,incident_type,metadata,created_at)
  values(run_i,a,r,'open','instagram_ui','instagram_human_confirmation_required',jsonb_build_object('request_id',q),now()-interval '1 minute');
  perform reconcile_operator_canceled_run_v1(a,r,q);
  if (select status from instagram_account_restriction_holds where incident_id=old_i) <> 'active' then raise exception 'preexisting restriction changed'; end if;
  result := create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',now()+interval '2 hours','base:override:preexisting','pg-cert',null,1,60);
  if coalesce((result->>'created')::boolean,false) then raise exception 'preexisting restriction bypassed after override'; end if;
end $$;

do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000008'; s constant uuid := '20000000-0000-4000-8000-000000000008';
  d constant uuid := '30000000-0000-4000-8000-000000000008'; r constant uuid := '40000000-0000-4000-8000-000000000008';
  q constant uuid := '50000000-0000-4000-8000-000000000008'; old_i constant uuid := '60000000-0000-4000-8000-000000000008';
  run_i constant uuid := '70000000-0000-4000-8000-000000000008'; result jsonb;
begin
  perform pg_temp.reset_fixture(); perform pg_temp.seed_canceled(a,s,d,r,q,'base:override:identity');
  insert into account_incidents(id,account_id,status,incident_type,created_at) values(old_i,a,'open','active_instagram_account_mismatch',now()-interval '1 day');
  insert into account_incidents(id,account_id,run_id,status,source,incident_type,metadata,created_at)
  values(run_i,a,r,'open','instagram_ui','instagram_human_confirmation_required',jsonb_build_object('request_id',q),now()-interval '1 minute');
  perform reconcile_operator_canceled_run_v1(a,r,q);
  if (select status from account_incidents where id=old_i) <> 'open' then raise exception 'preexisting identity changed'; end if;
  result := create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',now()+interval '2 hours','base:override:identity','pg-cert',null,1,60);
  if coalesce((result->>'created')::boolean,false) then raise exception 'preexisting identity bypassed after override'; end if;
end $$;

do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000009'; s constant uuid := '20000000-0000-4000-8000-000000000009';
  d constant uuid := '30000000-0000-4000-8000-000000000009'; r constant uuid := '40000000-0000-4000-8000-000000000009';
  q constant uuid := '50000000-0000-4000-8000-000000000009'; result jsonb; retry_id uuid; n integer;
begin
  perform pg_temp.reset_fixture(); perform pg_temp.seed_canceled(a,s,d,r,q,'base:bounds');
  for n in 1..3 loop
    result := create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',now()+interval '2 hours','base:bounds','pg-cert',null,99,60);
    if not coalesce((result->>'created')::boolean,false) or (result->>'retry_ordinal')::integer <> n then raise exception 'generation % failed: %',n,result; end if;
    retry_id := (result->>'request_id')::uuid;
    update account_run_requests set status='canceled',cancel_requested_at=now() where id=retry_id;
  end loop;
  result := create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',now()+interval '2 hours','base:bounds','pg-cert',null,99,60);
  if result->>'reason' <> 'scheduled_retry_limit_reached' then raise exception 'hard max not enforced: %',result; end if;
end $$;

do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000010'; s constant uuid := '20000000-0000-4000-8000-000000000010';
  d constant uuid := '30000000-0000-4000-8000-000000000010'; r constant uuid := '40000000-0000-4000-8000-000000000010';
  q constant uuid := '50000000-0000-4000-8000-000000000010'; result jsonb; retry_id uuid; n integer;
  next_start timestamptz := now()-interval '1 minute'; next_end timestamptz := now()+interval '3 hours';
begin
  perform pg_temp.reset_fixture(); perform pg_temp.seed_canceled(a,s,d,r,q,'base:old-window');
  for n in 1..3 loop
    result := create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',now()+interval '2 hours','base:old-window','pg-cert',null,3,60);
    retry_id := (result->>'request_id')::uuid; update account_run_requests set status='canceled',cancel_requested_at=now() where id=retry_id;
  end loop;
  update account_assignments set starts_at=next_start,ends_at=next_end where id=s;
  insert into account_run_requests(account_id,source_surface,requested_run_type,status,idempotency_key,error_code)
  values(a,'instagram_schedule_session_cron','account_session','blocked','base:next-window','package_settings_incomplete');
  result := create_schedule_session_retry_v2(a,s,next_start,next_end,'base:next-window','pg-cert',null,1,60);
  if not coalesce((result->>'created')::boolean,false) then raise exception 'next window poisoned: %',result; end if;
end $$;

do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000011'; s constant uuid := '20000000-0000-4000-8000-000000000011';
  d constant uuid := '30000000-0000-4000-8000-000000000011'; r constant uuid := '40000000-0000-4000-8000-000000000011';
  q constant uuid := '50000000-0000-4000-8000-000000000011'; before_count integer; after_count integer;
begin
  perform pg_temp.reset_fixture(); perform pg_temp.seed_canceled(a,s,d,r,q,'base:rollback');
  select count(*) into before_count from account_run_requests;
  create temporary table force_event_failure(flag boolean);
  insert into force_event_failure values(true);
  begin
    execute 'create or replace function pg_temp.reject_event() returns trigger language plpgsql as $b$ begin raise exception ''controlled_event_failure''; end $b$';
    execute 'create trigger reject_event before insert on account_package_runtime_contract_events for each row execute function pg_temp.reject_event()';
    perform create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',now()+interval '2 hours','base:rollback','pg-cert',null,1,60);
    raise exception 'controlled failure did not fire';
  exception when others then
    if sqlerrm <> 'controlled_event_failure' then raise; end if;
  end;
  select count(*) into after_count from account_run_requests;
  if after_count <> before_count then raise exception 'partial retry request survived rollback'; end if;
end $$;

-- Active incident-generation lineage also recognizes investigating as blocking.
do $$
declare
  a constant uuid := '10000000-0000-4000-8000-000000000016';
  s constant uuid := '20000000-0000-4000-8000-000000000016';
  d constant uuid := '30000000-0000-4000-8000-000000000016';
  r constant uuid := '40000000-0000-4000-8000-000000000016';
  q constant uuid := '50000000-0000-4000-8000-000000000016';
  result jsonb;
begin
  perform pg_temp.reset_fixture();
  perform pg_temp.seed_canceled(a,s,d,r,q,'base:block:investigating');
  insert into account_incidents(account_id,status,incident_type,created_at)
  values(a,'investigating','active_instagram_account_mismatch',now()-interval '1 day');
  result := create_schedule_session_retry_v2(a,s,now()-interval '5 minutes',now()+interval '2 hours','base:block:investigating','pg-cert',null,1,60);
  if coalesce((result->>'created')::boolean,false) then
    raise exception 'independent investigating incident bypassed';
  end if;
end $$;

select 'OPERATOR_CANCELED_OVERRIDE_SAME_WINDOW_V2_REAL_POSTGRES_PASS' as result;
