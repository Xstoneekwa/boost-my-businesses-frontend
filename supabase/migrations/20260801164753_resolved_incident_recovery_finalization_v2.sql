-- Complete the generic resolved-incident transition.
--
-- A resolved recovery incident must not leave either side of the recovery
-- contract stale:
--   * superseded plans/authorizations are terminalized once;
--   * the latest failed run owns exactly one plan shell;
--   * business phases and quotas are never invented in SQL.  The natural
--     Auto Restart tick rebuilds them from its live canonical candidate;
--   * one current authorization is armed only inside an active scheduled
--     assignment window.

drop index if exists public.incident_resume_authorizations_one_per_window;

create unique index if not exists incident_resume_authorizations_one_per_incident_window
  on public.incident_resume_authorizations (incident_id, resume_window_key)
  where status in ('armed', 'consumed');

create unique index if not exists incident_resume_authorizations_one_armed_per_account
  on public.incident_resume_authorizations (account_id)
  where status = 'armed';

create or replace function public.prepare_resolved_incident_recovery_v2(
  p_incident_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.account_incidents%rowtype;
  v_run public.ig_runs%rowtype;
  v_latest_run_id uuid;
  v_request public.account_run_requests%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_plan public.account_session_resume_plans%rowtype;
  v_authorization_id uuid;
  v_authorization_status text;
  v_window_key text;
  v_superseded_authorizations integer := 0;
begin
  select i.* into v_incident
  from public.account_incidents i
  where i.id = p_incident_id
  for update;

  if v_incident.id is null or v_incident.status <> 'resolved' then
    return jsonb_build_object('prepared', false, 'reason', 'incident_not_resolved');
  end if;
  if v_incident.account_id is null or v_incident.run_id is null then
    return jsonb_build_object('prepared', false, 'reason', 'incident_lineage_missing');
  end if;
  if v_incident.incident_type not in (
    'run_identity_verification_failed',
    'active_instagram_account_mismatch',
    'account_login_required',
    'assigned_instagram_package_unavailable',
    'run_device_unavailable',
    'run_worker_failure'
  ) then
    return jsonb_build_object('prepared', false, 'reason', 'incident_not_recovery_eligible');
  end if;

  select r.* into v_run
  from public.ig_runs r
  where r.id = v_incident.run_id
    and r.account_id = v_incident.account_id;

  if v_run.id is null or lower(coalesce(v_run.status, '')) not in ('failed', 'stopped', 'canceled') then
    return jsonb_build_object('prepared', false, 'reason', 'source_run_not_failed');
  end if;

  select r.id into v_latest_run_id
  from public.ig_runs r
  where r.account_id = v_incident.account_id
  order by r.created_at desc, r.id desc
  limit 1;

  if v_latest_run_id is distinct from v_incident.run_id then
    update public.incident_resume_authorizations a
    set status = 'expired',
        expired_at = coalesce(a.expired_at, now()),
        consume_error = coalesce(a.consume_error, 'resume_source_run_superseded'),
        metadata_safe = coalesce(a.metadata_safe, '{}'::jsonb) || jsonb_build_object(
          'terminal_reconciliation', jsonb_build_object(
            'reason', 'resume_source_run_superseded',
            'latest_run_id', v_latest_run_id,
            'reconciled_at', now()
          )
        ),
        updated_at = now()
    where a.incident_id = v_incident.id
      and a.status = 'armed';

    update public.account_session_resume_plans p
    set resume_state = 'not_recoverable',
        restart_allowed = false,
        restart_block_reason = 'resume_source_run_superseded',
        last_updated_at = now()
    where p.run_id = v_incident.run_id
      and p.resume_state in ('run_active', 'partial_resumable', 'awaiting_human_resume_authorization');

    update public.account_incidents i
    set metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
          'recovery', coalesce(i.metadata -> 'recovery', '{}'::jsonb) || jsonb_build_object(
            'state', 'resume_source_run_superseded',
            'latest_canonical_run_id', v_latest_run_id,
            'updated_at', now()
          )
        ),
        updated_at = now()
    where i.id = v_incident.id;

    return jsonb_build_object(
      'prepared', false,
      'reason', 'resume_source_run_superseded',
      'latest_run_id', v_latest_run_id
    );
  end if;

  update public.incident_resume_authorizations a
  set status = 'expired',
      expired_at = coalesce(a.expired_at, now()),
      consume_error = coalesce(
        a.consume_error,
        case when a.run_id is distinct from v_incident.run_id
          then 'resume_source_run_superseded'
          else 'resume_incident_superseded'
        end
      ),
      metadata_safe = coalesce(a.metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'terminal_reconciliation', jsonb_build_object(
          'reason', case when a.run_id is distinct from v_incident.run_id
            then 'resume_source_run_superseded'
            else 'resume_incident_superseded'
          end,
          'latest_run_id', v_incident.run_id,
          'latest_incident_id', v_incident.id,
          'reconciled_at', now()
        )
      ),
      updated_at = now()
  where a.account_id = v_incident.account_id
    and a.status = 'armed'
    and (
      a.run_id is distinct from v_incident.run_id
      or a.incident_id is distinct from v_incident.id
    );
  get diagnostics v_superseded_authorizations = row_count;

  select q.* into v_request
  from public.account_run_requests q
  where q.run_id = v_incident.run_id
    and q.account_id = v_incident.account_id
  order by q.created_at desc, q.id desc
  limit 1;

  select aa.* into v_assignment
  from public.account_assignments aa
  where aa.account_id = v_incident.account_id
    and aa.status in ('reserved', 'active')
    and coalesce(aa.schedule_mode, '') <> 'manual_only'
  order by
    case when aa.starts_at <= now() and now() < aa.ends_at then 0 else 1 end,
    aa.starts_at desc,
    aa.created_at desc
  limit 1;

  insert into public.account_session_resume_plans (
    run_id, run_request_id, account_id, assignment_id, device_id,
    app_instance_id, expected_username, scheduled_window_start,
    scheduled_window_end, resume_window_key, source_surface, run_trigger,
    resume_stage, resume_state, restart_allowed, restart_block_reason,
    terminal_reason_code, incident_id, plan, test
  ) values (
    v_incident.run_id, v_request.id, v_incident.account_id, v_assignment.id,
    v_assignment.device_id, v_assignment.app_instance_id,
    v_incident.account_username, v_assignment.starts_at, v_assignment.ends_at,
    case when v_assignment.id is null then null
      else v_incident.account_id::text || ':' || v_assignment.starts_at::text end,
    coalesce(v_request.source_surface, 'incident_resolution'), 'scheduler',
    'preflight', 'awaiting_human_resume_authorization', true,
    'resolved_incident_live_plan_rebuild',
    coalesce(v_incident.reason, v_incident.failure_reason), v_incident.id,
    jsonb_build_object(
      'schema', 'RESOLVED_INCIDENT_PLAN_SHELL_V1',
      'source_run_id', v_incident.run_id,
      'source_request_id', v_request.id,
      'business_phases_source', 'live_canonical_candidate_only',
      'cursor_invented', false,
      'created_from_resolution', true
    ),
    lower(coalesce(v_incident.metadata ->> 'test', 'false')) in ('true', '1', 'yes')
  )
  on conflict (run_id) do update
  set run_request_id = coalesce(public.account_session_resume_plans.run_request_id, excluded.run_request_id),
      assignment_id = coalesce(excluded.assignment_id, public.account_session_resume_plans.assignment_id),
      device_id = coalesce(excluded.device_id, public.account_session_resume_plans.device_id),
      app_instance_id = coalesce(excluded.app_instance_id, public.account_session_resume_plans.app_instance_id),
      scheduled_window_start = coalesce(excluded.scheduled_window_start, public.account_session_resume_plans.scheduled_window_start),
      scheduled_window_end = coalesce(excluded.scheduled_window_end, public.account_session_resume_plans.scheduled_window_end),
      resume_window_key = coalesce(excluded.resume_window_key, public.account_session_resume_plans.resume_window_key),
      resume_state = 'awaiting_human_resume_authorization',
      restart_allowed = true,
      restart_block_reason = 'resolved_incident_live_plan_rebuild',
      terminal_reason_code = coalesce(public.account_session_resume_plans.terminal_reason_code, excluded.terminal_reason_code),
      incident_id = excluded.incident_id,
      plan = coalesce(public.account_session_resume_plans.plan, '{}'::jsonb) || jsonb_build_object(
        'resolution_finalization', jsonb_build_object(
          'contract', 'RESOLVED_INCIDENT_RECOVERY_FINALIZATION_V2',
          'business_phases_source', 'live_canonical_candidate_only',
          'cursor_invented', false,
          'updated_at', now()
        )
      ),
      last_updated_at = now()
  where public.account_session_resume_plans.resume_state in (
    'run_active', 'partial_resumable', 'awaiting_human_resume_authorization', 'not_recoverable'
  )
  returning * into v_plan;

  if v_plan.id is null then
    select p.* into v_plan
    from public.account_session_resume_plans p
    where p.run_id = v_incident.run_id;
  end if;

  if v_plan.id is null or v_plan.resume_state <> 'awaiting_human_resume_authorization' then
    return jsonb_build_object('prepared', false, 'reason', 'resume_plan_not_recoverable');
  end if;

  if v_assignment.id is null
     or not (v_assignment.starts_at <= now() and now() < v_assignment.ends_at) then
    update public.account_incidents i
    set metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
          'recovery', coalesce(i.metadata -> 'recovery', '{}'::jsonb) || jsonb_build_object(
            'state', 'awaiting_scheduled_window',
            'resume_plan_id', v_plan.id,
            'source', 'resolved_incident_recovery_finalization_v2',
            'updated_at', now()
          )
        ),
        updated_at = now()
    where i.id = v_incident.id;

    return jsonb_build_object(
      'prepared', true,
      'armed', false,
      'reason', 'assignment_window_closed',
      'resume_plan_id', v_plan.id,
      'superseded_authorizations', v_superseded_authorizations
    );
  end if;

  v_window_key := v_incident.account_id::text || ':' || v_assignment.starts_at::text;

  if exists (
    select 1
    from public.incident_resume_authorizations a
    where a.incident_id = v_incident.id
      and a.resume_window_key = v_window_key
      and a.status in ('armed', 'consumed', 'expired')
  ) then
    select a.id, a.status into v_authorization_id, v_authorization_status
    from public.incident_resume_authorizations a
    where a.incident_id = v_incident.id
      and a.resume_window_key = v_window_key
    order by a.created_at desc
    limit 1;
  else
    insert into public.incident_resume_authorizations (
      incident_id, account_id, run_id, resume_plan_id, resume_window_key,
      scheduled_window_start, scheduled_window_end, status, armed_source,
      resolution_note, metadata_safe, test
    ) values (
      v_incident.id, v_incident.account_id, v_incident.run_id, v_plan.id,
      v_window_key, v_assignment.starts_at, v_assignment.ends_at, 'armed',
      'resolved_incident_recovery_finalization_v2',
      left(coalesce(v_incident.resolution_note, ''), 500),
      jsonb_build_object(
        'incident_type', v_incident.incident_type,
        'reason_code', coalesce(v_incident.reason, v_incident.failure_reason),
        'generic_resolved_incident_rule', true,
        'plan_contract', 'RESOLVED_INCIDENT_PLAN_SHELL_V1',
        'business_phases_source', 'live_canonical_candidate_only',
        'cursor_invented', false
      ),
      v_plan.test
    )
    on conflict do nothing
    returning id, status into v_authorization_id, v_authorization_status;
  end if;

  if v_authorization_status = 'armed' then
    update public.account_incidents i
    set metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
          'recovery', coalesce(i.metadata -> 'recovery', '{}'::jsonb) || jsonb_build_object(
            'state', 'ready_to_resume',
            'authorization_id', v_authorization_id,
            'resume_plan_id', v_plan.id,
            'source', 'resolved_incident_recovery_finalization_v2',
            'updated_at', now()
          )
        ),
        updated_at = now()
    where i.id = v_incident.id;
  end if;

  return jsonb_build_object(
    'prepared', true,
    'armed', v_authorization_status = 'armed',
    'reason', case
      when v_authorization_status = 'armed' then 'ready_to_resume'
      when v_authorization_status in ('consumed', 'expired') then 'authorization_already_terminal'
      else 'authorization_conflict'
    end,
    'resume_plan_id', v_plan.id,
    'authorization_id', v_authorization_id,
    'superseded_authorizations', v_superseded_authorizations
  );
end
$$;

revoke all on function public.prepare_resolved_incident_recovery_v2(uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_resolved_incident_recovery_v2(uuid)
  to service_role;

create or replace function public.arm_incident_resolution_auto_resume_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.prepare_resolved_incident_recovery_v2(new.id);
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
after update of status on public.account_incidents
for each row
when (new.status = 'resolved' and old.status is distinct from new.status)
execute function public.arm_incident_resolution_auto_resume_v1();

create or replace function public.reconcile_resolved_incident_resume_windows_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_result jsonb;
  v_prepared integer := 0;
  v_armed integer := 0;
  v_superseded_plans integer := 0;
  v_superseded_authorizations integer := 0;
begin
  update public.account_session_resume_plans p
  set resume_state = 'not_recoverable',
      restart_allowed = false,
      restart_block_reason = 'resume_source_run_superseded',
      last_updated_at = now()
  where p.resume_state in ('run_active', 'partial_resumable', 'awaiting_human_resume_authorization')
    and exists (
      select 1
      from public.ig_runs source_run
      join lateral (
        select latest.id
        from public.ig_runs latest
        where latest.account_id = source_run.account_id
        order by latest.created_at desc, latest.id desc
        limit 1
      ) current_run on true
      where source_run.id = p.run_id
        and current_run.id is distinct from p.run_id
    );
  get diagnostics v_superseded_plans = row_count;

  update public.incident_resume_authorizations a
  set status = 'expired',
      expired_at = coalesce(a.expired_at, now()),
      consume_error = coalesce(a.consume_error, 'resume_source_run_superseded'),
      metadata_safe = coalesce(a.metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'terminal_reconciliation', jsonb_build_object(
          'reason', 'resume_source_run_superseded',
          'reconciled_at', now()
        )
      ),
      updated_at = now()
  where a.status = 'armed'
    and exists (
      select 1
      from public.ig_runs source_run
      join lateral (
        select latest.id
        from public.ig_runs latest
        where latest.account_id = source_run.account_id
        order by latest.created_at desc, latest.id desc
        limit 1
      ) current_run on true
      where source_run.id = a.run_id
        and current_run.id is distinct from a.run_id
    );
  get diagnostics v_superseded_authorizations = row_count;

  for v_row in
    select i.id as incident_id
    from public.account_incidents i
    join public.ig_runs r
      on r.id = i.run_id and r.account_id = i.account_id
    where i.status = 'resolved'
      and i.incident_type in (
        'run_identity_verification_failed',
        'active_instagram_account_mismatch',
        'account_login_required',
        'assigned_instagram_package_unavailable',
        'run_device_unavailable',
        'run_worker_failure'
      )
      and lower(coalesce(r.status, '')) in ('failed', 'stopped', 'canceled')
      and r.id = (
        select latest.id
        from public.ig_runs latest
        where latest.account_id = i.account_id
        order by latest.created_at desc, latest.id desc
        limit 1
      )
      and i.id = (
        select latest_incident.id
        from public.account_incidents latest_incident
        where latest_incident.account_id = i.account_id
          and latest_incident.run_id = i.run_id
          and latest_incident.status = 'resolved'
          and latest_incident.incident_type in (
            'run_identity_verification_failed',
            'active_instagram_account_mismatch',
            'account_login_required',
            'assigned_instagram_package_unavailable',
            'run_device_unavailable',
            'run_worker_failure'
          )
        order by latest_incident.resolved_at desc nulls last,
                 latest_incident.created_at desc,
                 latest_incident.id desc
        limit 1
      )
    order by i.account_id
    for update of i skip locked
  loop
    v_result := public.prepare_resolved_incident_recovery_v2(v_row.incident_id);
    if coalesce((v_result ->> 'prepared')::boolean, false) then
      v_prepared := v_prepared + 1;
    end if;
    if coalesce((v_result ->> 'armed')::boolean, false) then
      v_armed := v_armed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'prepared_count', v_prepared,
    'armed_count', v_armed,
    'superseded_plan_count', v_superseded_plans,
    'superseded_authorization_count', v_superseded_authorizations
  );
end
$$;

revoke all on function public.reconcile_resolved_incident_resume_windows_v1()
  from public, anon, authenticated;
grant execute on function public.reconcile_resolved_incident_resume_windows_v1()
  to service_role;

comment on function public.prepare_resolved_incident_recovery_v2(uuid)
is 'Finalizes one resolved recovery incident against the latest canonical run, creates a cursor-free plan shell when missing, and arms at most one natural-tick authorization in an active scheduled window.';

comment on function public.reconcile_resolved_incident_resume_windows_v1()
is 'Reconciles only the latest resolved failed-run lineage per account; terminalizes superseded plans and authorizations and never recreates stale lineage.';

-- One-time generic repair.  This creates no run and executes no tick.
select public.reconcile_resolved_incident_resume_windows_v1();
