\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;

create table public.account_incidents (
  id uuid primary key,
  status text not null,
  severity text not null,
  incident_type text not null,
  reason text,
  failure_reason text,
  action_required text,
  admin_message text,
  account_id uuid,
  account_username text,
  run_id uuid,
  occurrence_count integer not null default 1,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  resolved_at timestamptz,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  archived_at timestamptz
);

create table public.account_dashboard_actions (
  id uuid primary key,
  incident_id uuid references public.account_incidents(id),
  action_type text not null,
  status text not null,
  blocking_campaign boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.account_incident_notifications (
  id uuid primary key,
  incident_id uuid not null references public.account_incidents(id),
  status text not null
);

\ir ../migrations/20260809144500_incident_overview_reviewed_open_v1.sql

insert into public.account_incidents (
  id, status, severity, incident_type, reason, account_id, account_username,
  first_seen_at, last_seen_at, source, metadata
) values
  ('10000000-0000-4000-8000-000000000001', 'open', 'error', 'run_worker_failure', 'reviewed_open',
   '20000000-0000-4000-8000-000000000001', 'reviewed_account', now() - interval '2 minutes', now(), 'test', '{}'),
  ('10000000-0000-4000-8000-000000000002', 'open', 'error', 'run_worker_failure', 'pending_review',
   '20000000-0000-4000-8000-000000000002', 'pending_account', now() - interval '3 minutes', now() - interval '1 minute', 'test', '{}'),
  ('10000000-0000-4000-8000-000000000003', 'resolved', 'warning', 'run_worker_failure', 'resolved_incident',
   '20000000-0000-4000-8000-000000000003', 'resolved_account', now() - interval '4 minutes', now() - interval '2 minutes', 'test', '{}');

insert into public.account_dashboard_actions (
  id, incident_id, action_type, status, blocking_campaign, metadata, created_at
) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'operator_review_required', 'acknowledged', false,
   '{"review_status":"reviewed","operator_review_completed":true,"incident_resolution_separate":true}', now()),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
   'operator_review_required', 'acknowledged', true, '{}', now());

do $$
declare
  v_open jsonb;
  v_action jsonb;
  v_resolved jsonb;
begin
  v_open := public.get_account_incidents_overview_v1('open', 50, null, null, null, false);
  if v_open #>> '{counters,open}' <> '1'
     or v_open #>> '{counters,actionRequired}' <> '1'
     or v_open #>> '{counters,resolved}' <> '1'
     or v_open->>'filtered_total' <> '1'
     or v_open #>> '{rows,0,reason}' <> 'reviewed_open'
     or v_open #>> '{rows,0,operator_action_status}' <> 'reviewed' then
    raise exception 'reviewed_open_projection_failed:%', v_open;
  end if;

  v_action := public.get_account_incidents_overview_v1('action_required', 50, null, null, null, false);
  if v_action->>'filtered_total' <> '1'
     or v_action #>> '{rows,0,reason}' <> 'pending_review'
     or v_action #>> '{rows,0,operator_action_status}' <> 'acknowledged' then
    raise exception 'action_required_projection_failed:%', v_action;
  end if;

  v_resolved := public.get_account_incidents_overview_v1('resolved', 50, null, null, null, false);
  if v_resolved->>'filtered_total' <> '1'
     or v_resolved #>> '{rows,0,reason}' <> 'resolved_incident' then
    raise exception 'resolved_projection_failed:%', v_resolved;
  end if;
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.get_account_incidents_overview_v1(text,integer,timestamptz,uuid,text,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_account_incidents_overview_v1(text,integer,timestamptz,uuid,text,boolean)', 'EXECUTE')
     or has_function_privilege('public', 'public.get_account_incidents_overview_v1(text,integer,timestamptz,uuid,text,boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.get_account_incidents_overview_v1(text,integer,timestamptz,uuid,text,boolean)', 'EXECUTE') then
    raise exception 'overview_rpc_grants_invalid';
  end if;
end $$;

select 'incident_overview_reviewed_open_v1_ok' as result;
