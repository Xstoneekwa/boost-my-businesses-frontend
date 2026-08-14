\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable
as $$ select '{"role":"service_role"}'::jsonb $$;

create table public.account_incidents (
  id uuid primary key,
  account_id uuid not null,
  created_at timestamptz not null default now(),
  status text not null,
  resolved_at timestamptz,
  archived_at timestamptz,
  incident_type text,
  severity text,
  action_required text,
  metadata jsonb not null default '{}'::jsonb
);
create table public.account_dashboard_actions (
  id uuid primary key,
  account_id uuid not null,
  incident_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  action_type text not null,
  status text not null,
  requires_client_action boolean not null default false,
  blocking_campaign boolean not null default false,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

\ir ../migrations/20260814173000_commercial_resume_blocker_preflight_and_recovery_v1.sql

do $$
declare
  v_account uuid := gen_random_uuid();
  v_open_incident uuid := gen_random_uuid();
  v_resolved_incident uuid := gen_random_uuid();
  v_open_action uuid := gen_random_uuid();
  v_stale_action uuid := gen_random_uuid();
  v_historical_action uuid := gen_random_uuid();
  v_result jsonb;
begin
  -- A genuinely open linked incident and action must refuse Active.
  insert into public.account_incidents (
    id, account_id, status, incident_type, severity, action_required
  ) values (
    v_open_incident, v_account, 'open', 'run_worker_failure', 'critical',
    'operator_review_required'
  );
  insert into public.account_dashboard_actions (
    id, account_id, incident_id, action_type, status, requires_client_action,
    blocking_campaign
  ) values (
    v_open_action, v_account, v_open_incident, 'operator_review_required',
    'pending', true, true
  );

  v_result := public.reconcile_commercial_resume_blockers_v1(v_account, 'sql_test');
  if v_result ->> 'reason' <> 'blocking_dashboard_action_active'
     or v_result ->> 'blocking_action_id' <> v_open_action::text then
    raise exception 'open_blocking_action_was_not_refused';
  end if;

  -- A stale active action linked to a resolved incident is terminalized, but
  -- a second truly open action still keeps the account blocked.
  insert into public.account_incidents (
    id, account_id, status, resolved_at, incident_type, severity,
    action_required
  ) values (
    v_resolved_incident, v_account, 'resolved', now(),
    'run_identity_verification_failed', 'critical',
    'operator_review_required'
  );
  insert into public.account_dashboard_actions (
    id, account_id, incident_id, action_type, status, requires_client_action,
    blocking_campaign
  ) values (
    v_stale_action, v_account, v_resolved_incident,
    'operator_review_required', 'pending_verification', true, true
  );

  v_result := public.reconcile_commercial_resume_blockers_v1(v_account, 'sql_test');
  if (select status from public.account_dashboard_actions where id=v_stale_action) <> 'resolved'
     or (select blocking_campaign from public.account_dashboard_actions where id=v_stale_action)
     or v_result ->> 'blocking_action_id' <> v_open_action::text then
    raise exception 'resolved_incident_action_reconciliation_failed';
  end if;

  -- Once the real incident/action is terminal, the account is clear.
  update public.account_incidents
  set status='resolved', resolved_at=now()
  where id=v_open_incident;
  v_result := public.reconcile_commercial_resume_blockers_v1(v_account, 'sql_test');
  if v_result ->> 'ok' <> 'true'
     or (select status from public.account_dashboard_actions where id=v_open_action) <> 'resolved'
     or (select blocking_campaign from public.account_dashboard_actions where id=v_open_action) then
    raise exception 'terminal_action_still_blocked_active';
  end if;

  -- Historical terminal actions never resurrect and repeated reconciliation
  -- is idempotent.
  insert into public.account_dashboard_actions (
    id, account_id, incident_id, action_type, status, requires_client_action,
    blocking_campaign, resolved_at
  ) values (
    v_historical_action, v_account, v_resolved_incident,
    'operator_review_required', 'resolved', false, false, now()
  );
  v_result := public.reconcile_commercial_resume_blockers_v1(v_account, 'sql_test_repeat');
  if v_result ->> 'ok' <> 'true'
     or (v_result ->> 'reconciled_count')::integer <> 0
     or (select status from public.account_dashboard_actions where id=v_historical_action) <> 'resolved' then
    raise exception 'reconciliation_not_idempotent';
  end if;

  -- An open critical incident remains a blocker even without an action.
  insert into public.account_incidents (
    id, account_id, status, incident_type, severity
  ) values (
    gen_random_uuid(), v_account, 'acknowledged',
    'welcome_retry_final_unverified_send_surface_lost', 'critical'
  );
  v_result := public.reconcile_commercial_resume_blockers_v1(v_account, 'sql_test');
  if v_result ->> 'reason' <> 'blocking_incident_active' then
    raise exception 'open_critical_incident_was_not_refused';
  end if;
end
$$;

select 'commercial_resume_blocker_preflight_v1_ok' as result;
