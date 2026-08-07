\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;

create table public.account_incidents (
  id uuid primary key, account_id uuid, run_id uuid, status text, severity text,
  incident_type text, metadata jsonb default '{}'::jsonb, lifecycle_version bigint default 1,
  resolved_by uuid, resolved_at timestamptz, archived_at timestamptz, updated_at timestamptz default now()
);
create table public.account_session_resume_plans (
  id uuid primary key, run_id uuid, run_request_id uuid, account_id uuid,
  resume_state text, restart_allowed boolean, scheduled_window_start timestamptz,
  scheduled_window_end timestamptz
);
create table public.account_assignments (
  id uuid primary key, account_id uuid, status text, starts_at timestamptz,
  ends_at timestamptz, schedule_mode text
);
create table public.account_dashboard_actions (
  id uuid primary key, incident_id uuid, status text
);
create table public.account_run_requests (
  id uuid primary key, account_id uuid, status text
);
create table public.ig_runs (
  id uuid primary key, account_id uuid, status text
);
create table public.auto_restart_device_locks (
  id uuid primary key, account_id uuid, lease_expires_at timestamptz
);
create table public.incident_resume_authorizations (
  id uuid primary key default gen_random_uuid(), incident_id uuid not null,
  account_id uuid not null, run_id uuid, resume_plan_id uuid,
  resume_window_key text not null, scheduled_window_start timestamptz,
  scheduled_window_end timestamptz, status text not null default 'armed',
  armed_source text not null default 'botapp_relay', armed_by text,
  armed_at timestamptz not null default now(), consumed_at timestamptz,
  consumed_by_request_id uuid, expired_at timestamptz, consume_error text,
  resolution_note text, metadata_safe jsonb not null default '{}'::jsonb,
  test boolean not null default false, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), retry_generation integer not null default 0,
  retry_credit_restored_at timestamptz, retry_credit_restore_reason text,
  frozen_phase_plan jsonb
);

create or replace function public.reconcile_resolved_incident_resume_windows_v1()
returns jsonb language sql as $$ select '{"armed_count":0}'::jsonb $$;

create or replace function public.transition_account_incident_human_review_v1(
  p_incident_id uuid, p_action text, p_expected_version bigint, p_actor_type text,
  p_actor_id uuid, p_source text, p_note text, p_resolution_reason text,
  p_idempotency_key text, p_channel text default null, p_notification_id uuid default null
)
returns jsonb language plpgsql as $$
declare v_inc public.account_incidents%rowtype; v_auth uuid;
begin
  select * into v_inc from public.account_incidents where id = p_incident_id for update;
  if v_inc.lifecycle_version <> p_expected_version then raise exception 'incident_version_conflict'; end if;
  update public.account_incidents set status='resolved', resolved_by=p_actor_id,
    resolved_at=now(), lifecycle_version=lifecycle_version+1 where id=p_incident_id;
  update public.account_dashboard_actions set status='resolved' where incident_id=p_incident_id;
  insert into public.incident_resume_authorizations(
    incident_id,account_id,run_id,resume_plan_id,resume_window_key,
    scheduled_window_start,scheduled_window_end,status
  ) select v_inc.id,v_inc.account_id,v_inc.run_id,p.id,v_inc.account_id::text||':test',
      p.scheduled_window_start,p.scheduled_window_end,'armed'
    from public.account_session_resume_plans p where p.run_id=v_inc.run_id
    returning id into v_auth;
  return jsonb_build_object('ok',true,'idempotent',false,'incident_id',p_incident_id,
    'status','resolved','version',p_expected_version+1,'notification_ids','[]'::jsonb);
end $$;

\ir ../migrations/20260807132013_incident_resolution_resume_authorization_v2.sql

do $$
declare
  v_account uuid := gen_random_uuid(); v_run uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid(); v_incident uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid(); v_result jsonb; v_auth uuid;
  v_original_window_key text; v_resume_key text;
begin
  insert into public.account_run_requests values(v_request,v_account,'completed');
  insert into public.account_session_resume_plans values(
    gen_random_uuid(),v_run,v_request,v_account,'awaiting_human_resume_authorization',true,
    now()-interval '1 hour',now()+interval '5 hours'
  );
  insert into public.account_assignments values(
    gen_random_uuid(),v_account,'active',now()-interval '1 hour',now()+interval '5 hours','scheduled'
  );
  insert into public.account_incidents values(
    v_incident,v_account,v_run,'open','error','run_worker_failure','{}',1,null,null,null,now()
  );
  insert into public.account_dashboard_actions values(gen_random_uuid(),v_incident,'pending_verification');

  v_result := public.transition_account_incident_human_review_v2(
    v_incident,'resolve',1,'ops',v_actor,'botapp_relay',null,'fixed','test:resolve',
    repeat('a',40),'worker:'||repeat('a',40),null,null
  );
  if v_result ->> 'incident_resolved' <> 'true' then raise exception 'incident_not_resolved'; end if;
  if v_result ->> 'dashboard_action_resolved' <> 'true' then raise exception 'action_not_resolved'; end if;
  if v_result ->> 'resume_authorization_created' <> 'true' then raise exception 'authorization_missing'; end if;
  if v_result ->> 'next_tick_eligible' <> 'true' then raise exception 'not_eligible: %',v_result; end if;
  v_auth := (v_result ->> 'resume_authorization_id')::uuid;
  if (select count(*) from public.incident_resume_authorizations where incident_id=v_incident) <> 1 then
    raise exception 'authorization_not_unique';
  end if;
  if (select source_request_id from public.incident_resume_authorizations where id=v_auth) <> v_request then
    raise exception 'source_request_not_bound';
  end if;
  select resume_window_key, idempotency_key
    into v_original_window_key, v_resume_key
  from public.incident_resume_authorizations where id=v_auth;
  if v_resume_key is null or v_resume_key not like 'incident-resume:%' then
    raise exception 'resume_idempotency_namespace_invalid';
  end if;
  if v_resume_key like 'schedule-session:%' then
    raise exception 'consumed_schedule_key_reused';
  end if;

  v_result := public.transition_account_incident_human_review_v2(
    v_incident,'resolve',1,'ops',v_actor,'botapp_relay',null,'fixed','test:resolve:again',
    repeat('a',40),'worker:'||repeat('a',40),null,null
  );
  if v_result ->> 'idempotent' <> 'true' then raise exception 'second_click_not_idempotent'; end if;
  if (select count(*) from public.incident_resume_authorizations where incident_id=v_incident) <> 1 then
    raise exception 'second_authorization_created';
  end if;
  if (select resume_window_key from public.incident_resume_authorizations where id=v_auth)
       is distinct from v_original_window_key then
    raise exception 'old_schedule_window_key_mutated';
  end if;

  update public.incident_resume_authorizations set account_id=gen_random_uuid() where id=v_auth;
  v_result := public.incident_resume_authorization_preflight_v2(v_auth);
  if v_result ->> 'blocked_reason' <> 'resume_incident_not_resolved' then
    raise exception 'wrong_account_not_rejected: %',v_result;
  end if;
  update public.incident_resume_authorizations set account_id=v_account where id=v_auth;

  update public.incident_resume_authorizations set expires_at=now()-interval '1 second' where id=v_auth;
  v_result := public.incident_resume_authorization_preflight_v2(v_auth);
  if v_result ->> 'blocked_reason' <> 'resume_authorization_expired' then
    raise exception 'expired_authorization_not_rejected: %',v_result;
  end if;
  update public.incident_resume_authorizations set expires_at=now()+interval '5 hours' where id=v_auth;

  update public.incident_resume_authorizations set status='consumed', consumed_at=now() where id=v_auth;
  v_result := public.incident_resume_authorization_preflight_v2(v_auth);
  if v_result ->> 'blocked_reason' <> 'resume_authorization_not_pending' then
    raise exception 'consumed_authorization_not_rejected: %',v_result;
  end if;
  update public.incident_resume_authorizations set status='revoked', canceled_at=now() where id=v_auth;
  if (select status from public.incident_resume_authorizations_v2 where authorization_id=v_auth) <> 'canceled' then
    raise exception 'canceled_status_not_projected';
  end if;

  begin
    update public.incident_resume_authorizations set expected_worker_sha='bad-sha' where id=v_auth;
    raise exception 'bad_sha_was_accepted';
  exception when check_violation then null;
  end;
end $$;

do $$
declare v_incident uuid := gen_random_uuid(); v_account uuid := gen_random_uuid();
begin
  insert into public.account_incidents values(
    v_incident,v_account,gen_random_uuid(),'open','critical','security_identity_violation','{}',1,null,null,null,now()
  );
  begin
    perform public.transition_account_incident_human_review_v2(
      v_incident,'resolve',1,'ops',gen_random_uuid(),'botapp_relay',null,'fixed','test:security',
      repeat('b',40),'worker:'||repeat('b',40),null,null
    );
    raise exception 'security_incident_was_resolved';
  exception when insufficient_privilege then null;
  end;
end $$;

select 'incident_resolution_resume_authorization_v2_test_ok' as result;
