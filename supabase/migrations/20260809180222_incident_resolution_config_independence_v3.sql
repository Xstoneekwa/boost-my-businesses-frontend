-- Incident Resolution + Configuration Independence V3.
--
-- 1. A severity label is not a security classification. Only an explicit
--    security incident type/flag remains non-resolvable from BotApp.
-- 2. Resolve after verification restores the recoverable plan's restart
--    permission in the same transaction.
-- 3. The resolution trigger applies to every non-security recovery incident,
--    without account names or incident allowlists.

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
     or left(lower(coalesce(new.incident_type, '')), 9) = 'security_'
     or lower(coalesce(new.metadata ->> 'security_incident', 'false')) in ('true', '1', 'yes') then
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
    and coalesce(a.schedule_mode, '') <> 'manual_only'
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
      'resolution_is_resume_authorization', true,
      'explicit_security_classification', false
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

revoke all on function public.arm_incident_resolution_auto_resume_v1()
  from public, anon, authenticated;
grant execute on function public.arm_incident_resolution_auto_resume_v1()
  to service_role;

drop trigger if exists account_incident_resolution_auto_resume_v1
  on public.account_incidents;
create trigger account_incident_resolution_auto_resume_v1
before update of status on public.account_incidents
for each row
when (new.status = 'resolved' and old.status is distinct from new.status)
execute function public.arm_incident_resolution_auto_resume_v1();

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

create or replace function public.transition_account_incident_human_review_v2(
  p_incident_id uuid,
  p_action text,
  p_expected_version bigint,
  p_actor_type text,
  p_actor_id uuid,
  p_source text,
  p_note text,
  p_resolution_reason text,
  p_idempotency_key text,
  p_expected_worker_sha text,
  p_cause_fixed_version text,
  p_channel text default null,
  p_notification_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_incident public.account_incidents%rowtype;
  v_transition jsonb;
  v_auth public.incident_resume_authorizations%rowtype;
  v_preflight jsonb;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_sha text := lower(btrim(coalesce(p_expected_worker_sha, '')));
  v_fixed text := nullif(btrim(coalesce(p_cause_fixed_version, '')), '');
  v_resolution_version bigint;
  v_now timestamptz := now();
begin
  select * into v_incident from public.account_incidents
  where id = p_incident_id and archived_at is null
  for update;
  if v_incident.id is null then
    raise exception 'incident_not_found' using errcode = 'P0002';
  end if;

  if v_action = 'resolve' then
    if left(lower(coalesce(v_incident.incident_type, '')), 9) = 'security_'
       or lower(coalesce(v_incident.metadata ->> 'security_incident', 'false')) in ('true', '1', 'yes') then
      raise exception 'incident_security_resolution_forbidden' using errcode = '42501';
    end if;
    if v_sha !~ '^[0-9a-f]{40}$' then
      raise exception 'incident_resolution_expected_worker_sha_invalid' using errcode = '22023';
    end if;
    if v_fixed is null or char_length(v_fixed) > 160 then
      raise exception 'incident_resolution_cause_fixed_version_invalid' using errcode = '22023';
    end if;
  end if;

  if v_action = 'resolve' and v_incident.status = 'resolved' then
    v_transition := jsonb_build_object(
      'ok', true, 'idempotent', true, 'incident_id', v_incident.id,
      'status', v_incident.status, 'version', v_incident.lifecycle_version,
      'notification_ids', '[]'::jsonb
    );
  else
    v_transition := public.transition_account_incident_human_review_v1(
      p_incident_id, p_action, p_expected_version, p_actor_type, p_actor_id,
      p_source, p_note, p_resolution_reason, p_idempotency_key,
      p_channel, p_notification_id
    );
  end if;

  if v_action <> 'resolve' then
    return v_transition || jsonb_build_object(
      'incident_resolved', false,
      'dashboard_action_resolved', false,
      'resume_authorization_created', false,
      'next_tick_eligible', false
    );
  end if;

  select * into v_incident from public.account_incidents where id = p_incident_id;
  v_resolution_version := v_incident.lifecycle_version;

  update public.account_session_resume_plans p
  set restart_allowed = true,
      last_updated_at = v_now
  where p.account_id = v_incident.account_id
    and p.run_id = v_incident.run_id
    and p.resume_state = 'awaiting_human_resume_authorization';

  update public.account_incidents
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'manual_resolution_v2', jsonb_build_object(
          'resolved_by', p_actor_id,
          'resolved_at', coalesce(resolved_at, v_now),
          'cause_fixed_version', v_fixed,
          'expected_worker_sha', v_sha,
          'resolution_version', v_resolution_version,
          'restart_allowed_restored', true
        )
      ),
      updated_at = v_now
  where id = p_incident_id;

  select a.* into v_auth
  from public.incident_resume_authorizations a
  where a.incident_id = p_incident_id
    and a.status in ('armed', 'consumed')
  order by a.created_at desc
  limit 1
  for update;

  if v_auth.id is not null then
    update public.incident_resume_authorizations a
    set source_run_id = coalesce(a.source_run_id, a.run_id, v_incident.run_id),
        source_request_id = coalesce(a.source_request_id, p.run_request_id),
        resolved_by = coalesce(a.resolved_by, p_actor_id),
        resolved_at = coalesce(a.resolved_at, v_incident.resolved_at, v_now),
        cause_fixed_version = v_fixed,
        business_date = coalesce(a.business_date, (coalesce(v_incident.resolved_at, v_now) at time zone 'Africa/Johannesburg')::date),
        expected_worker_sha = v_sha,
        expires_at = coalesce(a.expires_at, a.scheduled_window_end),
        idempotency_key = coalesce(a.idempotency_key, 'incident-resume:' || a.account_id::text || ':' || a.incident_id::text || ':v' || v_resolution_version::text),
        armed_by = coalesce(a.armed_by, p_actor_id::text),
        updated_at = v_now
    from public.account_session_resume_plans p
    where a.id = v_auth.id and p.id = a.resume_plan_id
    returning a.* into v_auth;
    v_preflight := public.incident_resume_authorization_preflight_v2(v_auth.id);
  else
    v_preflight := jsonb_build_object(
      'next_tick_eligible', false,
      'blocked_reason', 'resume_authorization_pending_scheduled_assignment'
    );
  end if;

  return v_transition || jsonb_strip_nulls(jsonb_build_object(
    'incident_resolved', true,
    'dashboard_action_resolved', not exists (
      select 1 from public.account_dashboard_actions a
      where a.incident_id = p_incident_id and a.status <> 'resolved'
    ),
    'resume_authorization_created', v_auth.id is not null,
    'resume_authorization_id', v_auth.id,
    'expires_at', coalesce(v_auth.expires_at, v_auth.scheduled_window_end),
    'next_tick_eligible', coalesce((v_preflight ->> 'next_tick_eligible')::boolean, false),
    'blocked_reason', v_preflight ->> 'blocked_reason',
    'expected_worker_sha', v_sha,
    'cause_fixed_version', v_fixed
  ));
end
$$;

revoke all on function public.transition_account_incident_human_review_v2(
  uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.transition_account_incident_human_review_v2(
  uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid
) to service_role;

comment on function public.transition_account_incident_human_review_v2(
  uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid
) is 'Atomically resolves an explicitly verified non-security incident, clears linked blockers, restores its recoverable plan, and returns next-natural-tick eligibility without coupling account configuration writes.';
