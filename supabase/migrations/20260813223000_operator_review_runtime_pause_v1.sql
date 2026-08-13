-- Operator-review runtime pause V1.
--
-- An active blocking operator-review action is the canonical boundary that
-- pauses scheduling. Resolution alone deliberately does not unpause the
-- account: a separate explicit Active transition is required.

create or replace function public.project_operator_review_runtime_pause_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed boolean := false;
begin
  if new.account_id is null
     or new.action_type not in ('operator_review_required', 'review_auto_restart_hard_stop')
     or new.status not in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
     or coalesce(new.blocking_campaign, false) is false then
    return new;
  end if;

  update public.ig_account_settings
  set account_status = 'paused_manual_review',
      current_run_status = 'idle',
      updated_at = now()
  where account_id = new.account_id
    and (
      lower(coalesce(account_status, '')) <> 'paused_manual_review'
      or lower(coalesce(current_run_status, '')) <> 'idle'
    );
  v_changed := found;

  if v_changed then
    insert into public.ig_action_logs (
      account_id, run_id, target_username, action_type, status, message, payload, created_at
    ) values (
      new.account_id,
      null,
      null,
      'operator_review_runtime_paused',
      'success',
      'Blocking operator-review action projected to paused_manual_review.',
      jsonb_build_object(
        'dashboard_action_id', new.id,
        'incident_id', new.incident_id,
        'runtime_status', 'paused_manual_review',
        'scheduler_eligible', false,
        'auto_unpause', false,
        'source', 'account_dashboard_actions_trigger_v1'
      ),
      now()
    );
  end if;
  return new;
end
$$;

revoke all on function public.project_operator_review_runtime_pause_v1()
  from public, anon, authenticated;
grant execute on function public.project_operator_review_runtime_pause_v1()
  to service_role;

drop trigger if exists account_dashboard_action_runtime_pause_v1
  on public.account_dashboard_actions;
create trigger account_dashboard_action_runtime_pause_v1
after insert or update of status, blocking_campaign, action_type
on public.account_dashboard_actions
for each row
execute function public.project_operator_review_runtime_pause_v1();

create or replace function public.reconcile_operator_review_runtime_pauses_v1(
  p_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reconciled integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  with candidates as (
    select distinct a.account_id
    from public.account_dashboard_actions a
    join public.account_incidents i
      on i.id = a.incident_id
     and i.account_id = a.account_id
     and i.status in ('open', 'acknowledged', 'investigating')
     and i.resolved_at is null
     and i.archived_at is null
    where (p_account_id is null or a.account_id = p_account_id)
      and a.action_type in ('operator_review_required', 'review_auto_restart_hard_stop')
      and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
      and coalesce(a.blocking_campaign, false)
  ), updated as (
    update public.ig_account_settings s
    set account_status = 'paused_manual_review',
        current_run_status = 'idle',
        updated_at = now()
    from candidates c
    where s.account_id = c.account_id
      and (
        lower(coalesce(s.account_status, '')) <> 'paused_manual_review'
        or lower(coalesce(s.current_run_status, '')) <> 'idle'
      )
    returning s.account_id
  )
  select count(*)::integer into v_reconciled from updated;

  return jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'reconciled_count', v_reconciled,
    'runtime_status', 'paused_manual_review',
    'scheduler_eligible', false,
    'auto_unpause', false
  );
end
$$;

revoke all on function public.reconcile_operator_review_runtime_pauses_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_operator_review_runtime_pauses_v1(uuid)
  to service_role;

-- Resume authorization remains one-shot, but is not scheduler-eligible until
-- the operator has explicitly restored the runtime projection to Active.
create or replace function public.incident_resume_authorization_preflight_v2(
  p_authorization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth public.incident_resume_authorizations%rowtype;
  v_incident public.account_incidents%rowtype;
  v_plan public.account_session_resume_plans%rowtype;
  v_reason text;
begin
  select * into v_auth
  from public.incident_resume_authorizations
  where id = p_authorization_id;

  if v_auth.id is null then v_reason := 'resume_authorization_missing';
  elsif v_auth.status <> 'armed' then v_reason := 'resume_authorization_not_pending';
  elsif coalesce(v_auth.expires_at, v_auth.scheduled_window_end) <= now() then v_reason := 'resume_authorization_expired';
  elsif v_auth.expected_worker_sha is null then v_reason := 'resume_worker_sha_missing';
  elsif v_auth.cause_fixed_version is null then v_reason := 'resume_cause_fixed_version_missing';
  else
    select * into v_incident from public.account_incidents
    where id = v_auth.incident_id and account_id = v_auth.account_id;
    select * into v_plan from public.account_session_resume_plans
    where id = v_auth.resume_plan_id and account_id = v_auth.account_id;

    if v_incident.id is null or v_incident.status <> 'resolved' then v_reason := 'resume_incident_not_resolved';
    elsif left(lower(coalesce(v_incident.incident_type, '')), 9) = 'security_'
       or lower(coalesce(v_incident.metadata ->> 'security_incident', 'false')) in ('true', '1', 'yes') then
      v_reason := 'resume_security_incident_forbidden';
    elsif not exists (
      select 1 from public.ig_account_settings s
      where s.account_id = v_auth.account_id
        and lower(coalesce(s.account_status, '')) = 'active'
    ) then v_reason := 'resume_explicit_active_required';
    elsif v_plan.id is null or v_plan.resume_state <> 'awaiting_human_resume_authorization' then
      v_reason := 'resume_plan_not_recoverable';
    elsif not coalesce(v_plan.restart_allowed, false) then v_reason := 'resume_restart_not_allowed';
    elsif not exists (
      select 1 from public.account_assignments aa
      where aa.account_id = v_auth.account_id
        and aa.status in ('reserved', 'active')
        and aa.starts_at <= now() and now() < aa.ends_at
        and coalesce(aa.schedule_mode, '') <> 'manual_only'
    ) then v_reason := 'resume_assignment_not_scheduler_eligible';
    elsif exists (
      select 1 from public.account_run_requests q
      where q.account_id = v_auth.account_id
        and q.status in ('queued', 'claimed', 'starting', 'running')
    ) then v_reason := 'resume_active_request_exists';
    elsif exists (
      select 1 from public.ig_runs r
      where r.account_id = v_auth.account_id and r.status in ('pending', 'running')
    ) then v_reason := 'resume_active_run_exists';
    elsif exists (
      select 1 from public.auto_restart_device_locks l
      where l.account_id = v_auth.account_id and l.lease_expires_at > now()
    ) then v_reason := 'resume_active_device_lock_exists';
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'authorization_id', p_authorization_id,
    'next_tick_eligible', v_reason is null,
    'blocked_reason', v_reason,
    'expires_at', coalesce(v_auth.expires_at, v_auth.scheduled_window_end),
    'expected_worker_sha', v_auth.expected_worker_sha
  ));
end
$$;

revoke all on function public.incident_resume_authorization_preflight_v2(uuid)
  from public, anon, authenticated;
grant execute on function public.incident_resume_authorization_preflight_v2(uuid)
  to service_role;

comment on function public.reconcile_operator_review_runtime_pauses_v1(uuid) is
  'Idempotently projects active blocking operator-review incidents to paused_manual_review; never resolves incidents, changes schedules, or auto-unpauses accounts.';
