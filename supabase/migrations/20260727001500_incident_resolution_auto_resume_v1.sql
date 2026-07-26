-- P3: durable, audited, atomically consumable human resume authorizations.
--
-- One row is armed by the operator action "Prêt à relancer" on a
-- recovery-eligible incident. Auto Restart is the ONLY consumer: it claims
-- the row atomically (status armed -> consumed) before creating exactly one
-- resume run request in the same active window. A consumed or expired
-- authorization can never be re-armed for the same window (partial unique
-- index), which enforces: 1 click -> at most 1 resume request -> 1 window.

create table if not exists public.incident_resume_authorizations (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null,
  account_id uuid not null,
  run_id uuid,
  resume_plan_id uuid,
  resume_window_key text not null,
  scheduled_window_start timestamptz,
  scheduled_window_end timestamptz,
  status text not null default 'armed'
    check (status in ('armed', 'consumed', 'expired', 'revoked')),
  armed_source text not null default 'botapp_relay',
  armed_by text,
  armed_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by_request_id uuid,
  expired_at timestamptz,
  consume_error text,
  resolution_note text,
  metadata_safe jsonb not null default '{}'::jsonb,
  test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live (armed) authorization per incident.
create unique index if not exists incident_resume_authorizations_one_armed_per_incident
  on public.incident_resume_authorizations (incident_id)
  where status = 'armed';

-- Anti-loop budget: once armed or consumed in a window, no re-arm in the
-- same account window. Expired / revoked rows do not block a future window.
create unique index if not exists incident_resume_authorizations_one_per_window
  on public.incident_resume_authorizations (account_id, resume_window_key)
  where status in ('armed', 'consumed');

create index if not exists incident_resume_authorizations_armed_idx
  on public.incident_resume_authorizations (status, armed_at)
  where status = 'armed';

alter table public.incident_resume_authorizations enable row level security;

revoke all on table public.incident_resume_authorizations from public, anon, authenticated;
grant select, insert, update on table public.incident_resume_authorizations to service_role;

drop policy if exists incident_resume_authorizations_service_role_all
  on public.incident_resume_authorizations;
create policy incident_resume_authorizations_service_role_all
  on public.incident_resume_authorizations
  for all
  to service_role
  using (true)
  with check (true);

-- A resolved recovery incident is the human authorization.  Materialize one
-- durable authorization atomically in the same transaction; the natural Auto
-- Restart tick remains the only consumer and all runtime gates still apply.
create or replace function public.arm_incident_resolution_auto_resume_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.account_session_resume_plans%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_window_key text;
  v_authorization_id uuid;
begin
  if new.status <> 'resolved'
     or old.status = 'resolved'
     or new.run_id is null
     or new.account_id is null
     or new.incident_type not in (
       'run_identity_verification_failed',
       'active_instagram_account_mismatch',
       'account_login_required',
       'assigned_instagram_package_unavailable',
       'run_device_unavailable',
       'run_worker_failure'
     ) then
    return new;
  end if;

  select p.* into v_plan
  from public.account_session_resume_plans p
  where p.run_id = new.run_id
    and p.account_id = new.account_id
    and p.resume_state = 'awaiting_human_resume_authorization'
  order by p.last_updated_at desc nulls last, p.created_at desc
  limit 1;

  if v_plan.id is null then
    return new;
  end if;

  select a.* into v_assignment
  from public.account_assignments a
  where a.account_id = new.account_id
    and a.status in ('reserved', 'active')
    and (v_plan.assignment_id is null or a.id = v_plan.assignment_id)
    and a.starts_at <= now()
    and a.ends_at > now()
  order by case when a.id = v_plan.assignment_id then 0 else 1 end,
           a.starts_at desc
  limit 1;

  v_window_start := coalesce(v_plan.scheduled_window_start, v_assignment.starts_at);
  v_window_end := coalesce(v_plan.scheduled_window_end, v_assignment.ends_at);
  if v_window_start is null or v_window_end is null
     or not (v_window_start <= now() and now() < v_window_end) then
    return new;
  end if;

  v_window_key := coalesce(
    nullif(v_plan.resume_window_key, ''),
    new.account_id::text || ':' || v_window_start::text
  );

  insert into public.incident_resume_authorizations (
    incident_id, account_id, run_id, resume_plan_id, resume_window_key,
    scheduled_window_start, scheduled_window_end, status, armed_source,
    resolution_note, metadata_safe, test
  ) values (
    new.id, new.account_id, new.run_id, v_plan.id, v_window_key,
    v_window_start, v_window_end, 'armed', 'incident_resolution',
    left(coalesce(new.resolution_note, ''), 500),
    jsonb_build_object(
      'incident_type', new.incident_type,
      'reason_code', coalesce(new.reason, new.failure_reason),
      'resolution_is_resume_authorization', true
    ),
    lower(coalesce(new.metadata ->> 'test', 'false')) in ('true', '1', 'yes')
  )
  on conflict do nothing
  returning id into v_authorization_id;

  if v_authorization_id is not null then
    update public.account_session_resume_plans
    set scheduled_window_start = v_window_start,
        scheduled_window_end = v_window_end,
        resume_window_key = v_window_key,
        last_updated_at = now()
    where id = v_plan.id;

    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'recovery', coalesce(new.metadata -> 'recovery', '{}'::jsonb) || jsonb_build_object(
        'state', 'ready_to_resume',
        'authorization_id', v_authorization_id,
        'armed_at', now(),
        'source', 'incident_resolution'
      )
    );
  end if;
  return new;
end
$$;

revoke all on function public.arm_incident_resolution_auto_resume_v1() from public, anon, authenticated;
grant execute on function public.arm_incident_resolution_auto_resume_v1() to service_role;

drop trigger if exists account_incident_resolution_auto_resume_v1
  on public.account_incidents;
create trigger account_incident_resolution_auto_resume_v1
before update of status on public.account_incidents
for each row
when (new.status = 'resolved' and old.status is distinct from new.status)
execute function public.arm_incident_resolution_auto_resume_v1();

-- Keep dashboard action and incident authority in one transaction.  This is
-- the generic repair for the Rex divergence: a reviewed linked operator
-- blocker can no longer leave its canonical incident open.
create or replace function public.resolve_linked_incident_from_dashboard_action_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.incident_id is null
     or new.status <> 'resolved'
     or old.status = 'resolved'
     or new.action_type not in ('operator_review_required', 'review_auto_restart_hard_stop') then
    return new;
  end if;

  new.blocking_campaign := false;
  new.requires_client_action := false;
  new.resolved_at := coalesce(new.resolved_at, now());

  update public.account_incidents
  set status = 'resolved',
      resolved_at = coalesce(resolved_at, new.resolved_at),
      resolution_reason = coalesce(resolution_reason, 'linked_operator_review_resolved'),
      resolution_note = coalesce(resolution_note, 'Resolved from linked operator review.'),
      updated_at = now()
  where id = new.incident_id
    and status in ('open', 'acknowledged', 'investigating');
  return new;
end
$$;

revoke all on function public.resolve_linked_incident_from_dashboard_action_v1() from public, anon, authenticated;
grant execute on function public.resolve_linked_incident_from_dashboard_action_v1() to service_role;

drop trigger if exists dashboard_action_resolution_sync_incident_v1
  on public.account_dashboard_actions;
create trigger dashboard_action_resolution_sync_incident_v1
before update of status on public.account_dashboard_actions
for each row
when (new.status = 'resolved' and old.status is distinct from new.status)
execute function public.resolve_linked_incident_from_dashboard_action_v1();

-- One-time reconciliation for historical split-brain rows such as Rex.
update public.account_incidents i
set status = 'resolved',
    resolved_at = coalesce(i.resolved_at, a.resolved_at, a.updated_at, now()),
    resolution_reason = coalesce(i.resolution_reason, 'linked_operator_review_resolved'),
    resolution_note = coalesce(i.resolution_note, 'Reconciled from linked resolved operator review.'),
    updated_at = now()
from public.account_dashboard_actions a
where a.incident_id = i.id
  and a.action_type in ('operator_review_required', 'review_auto_restart_hard_stop')
  and a.status = 'resolved'
  and i.status in ('open', 'acknowledged', 'investigating');
