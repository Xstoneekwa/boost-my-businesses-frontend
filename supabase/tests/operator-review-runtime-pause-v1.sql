\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable
as $$ select '{"role":"service_role"}'::jsonb $$;

create table public.account_incidents (
  id uuid primary key, account_id uuid not null, status text not null,
  resolved_at timestamptz, archived_at timestamptz, incident_type text,
  metadata jsonb not null default '{}'::jsonb
);
create table public.account_dashboard_actions (
  id uuid primary key, account_id uuid not null, incident_id uuid,
  action_type text not null, status text not null, blocking_campaign boolean not null default false
);
create table public.ig_account_settings (
  account_id uuid primary key, account_status text, current_run_status text, updated_at timestamptz
);
create table public.ig_action_logs (
  id uuid primary key default gen_random_uuid(), account_id uuid, run_id uuid,
  target_username text, action_type text, status text, message text,
  payload jsonb, created_at timestamptz
);
create table public.incident_resume_authorizations (
  id uuid primary key, incident_id uuid, account_id uuid, resume_plan_id uuid,
  status text, expires_at timestamptz, scheduled_window_end timestamptz,
  expected_worker_sha text, cause_fixed_version text
);
create table public.account_session_resume_plans (
  id uuid primary key, account_id uuid, resume_state text, restart_allowed boolean
);
create table public.account_assignments (
  id uuid primary key, account_id uuid, status text, starts_at timestamptz,
  ends_at timestamptz, schedule_mode text
);
create table public.account_run_requests (id uuid primary key, account_id uuid, status text);
create table public.ig_runs (id uuid primary key, account_id uuid, status text);
create table public.auto_restart_device_locks (
  id uuid primary key, account_id uuid, lease_expires_at timestamptz
);

\ir ../migrations/20260813223000_operator_review_runtime_pause_v1.sql

do $$
declare
  v_account uuid := gen_random_uuid();
  v_incident uuid := gen_random_uuid();
  v_action uuid := gen_random_uuid();
  v_auth uuid := gen_random_uuid();
  v_plan uuid := gen_random_uuid();
  v_result jsonb;
begin
  insert into public.ig_account_settings values(v_account, 'active', 'idle', now());
  insert into public.account_incidents values(
    v_incident, v_account, 'open', null, null, 'run_worker_failure', '{}'::jsonb
  );
  insert into public.account_dashboard_actions values(
    v_action, v_account, v_incident, 'operator_review_required',
    'pending_verification', true
  );

  if (select account_status from public.ig_account_settings where account_id=v_account)
       <> 'paused_manual_review' then
    raise exception 'operator_review_did_not_pause_runtime';
  end if;
  if (select count(*) from public.ig_action_logs
      where account_id=v_account and action_type='operator_review_runtime_paused') <> 1 then
    raise exception 'pause_audit_log_missing';
  end if;

  -- Idempotent updates and reconciliation never duplicate the audit event.
  update public.account_dashboard_actions set status='acknowledged' where id=v_action;
  perform public.reconcile_operator_review_runtime_pauses_v1(v_account);
  if (select count(*) from public.ig_action_logs
      where account_id=v_account and action_type='operator_review_runtime_paused') <> 1 then
    raise exception 'pause_projection_not_idempotent';
  end if;

  insert into public.account_session_resume_plans values(
    v_plan, v_account, 'awaiting_human_resume_authorization', true
  );
  insert into public.account_assignments values(
    gen_random_uuid(), v_account, 'active', now()-interval '1 hour',
    now()+interval '1 hour', 'scheduled'
  );
  update public.account_incidents set status='resolved', resolved_at=now() where id=v_incident;
  update public.account_dashboard_actions set status='resolved' where id=v_action;
  insert into public.incident_resume_authorizations values(
    v_auth, v_incident, v_account, v_plan, 'armed', now()+interval '1 hour',
    now()+interval '1 hour', repeat('a',40), 'operator-review-runtime-pause-v1'
  );

  v_result := public.incident_resume_authorization_preflight_v2(v_auth);
  if v_result ->> 'blocked_reason' <> 'resume_explicit_active_required'
     or v_result ->> 'next_tick_eligible' <> 'false' then
    raise exception 'resolved_only_must_remain_paused: %', v_result;
  end if;

  update public.ig_account_settings set account_status='active' where account_id=v_account;
  v_result := public.incident_resume_authorization_preflight_v2(v_auth);
  if v_result ->> 'next_tick_eligible' <> 'true' then
    raise exception 'resolved_plus_active_not_eligible: %', v_result;
  end if;
end $$;

select 'operator_review_runtime_pause_v1_test_ok' as result;
