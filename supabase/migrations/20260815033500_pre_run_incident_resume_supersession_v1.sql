-- A resolved incident whose consumed authorization failed before ig_run
-- creation is newer than the source-run incident.  The legacy reconciliation
-- pass may briefly terminalize its replacement authorization while processing
-- that older run.  Re-arm only the exact, unconsumed pre-run contract after
-- the legacy pass; historical authorizations and schedule keys stay immutable.

create or replace function public.rearm_resolved_pre_run_incident_authorizations_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select
      a.id as authorization_id,
      a.incident_id,
      a.account_id,
      a.run_id,
      a.resume_plan_id,
      aa.id as assignment_id,
      aa.device_id,
      aa.app_instance_id,
      aa.starts_at,
      aa.ends_at
    from public.incident_resume_authorizations a
    join public.account_incidents i
      on i.id = a.incident_id
     and i.account_id = a.account_id
     and i.status = 'resolved'
     and i.run_id is null
     and left(lower(coalesce(i.incident_type, '')), 9) <> 'security_'
     and lower(coalesce(i.metadata ->> 'security_incident', 'false')) not in ('true', '1', 'yes')
     and coalesce(i.metadata ->> 'run_request_id', '') = coalesce(a.source_request_id::text, '')
    join public.account_session_resume_plans p
      on p.id = a.resume_plan_id
     and p.account_id = a.account_id
     and p.run_id = a.run_id
    join public.account_assignments aa
      on aa.account_id = a.account_id
     and aa.status in ('reserved', 'active')
     and aa.starts_at <= now()
     and now() < aa.ends_at
     and coalesce(aa.schedule_mode, '') <> 'manual_only'
    where a.armed_source = 'resolved_pre_run_incident_reconciliation'
      and a.status = 'expired'
      and a.consumed_at is null
      and a.consumed_by_request_id is null
      and a.expires_at > now()
      and lower(coalesce(a.metadata_safe ->> 'generic_pre_run_recovery', 'false')) in ('true', '1', 'yes')
      and coalesce(a.metadata_safe ->> 'failed_request_id', '') = coalesce(a.source_request_id::text, '')
      and coalesce(a.metadata_safe ->> 'source_run_id', '') = coalesce(a.run_id::text, '')
      and coalesce(a.metadata_safe #>> '{terminal_reconciliation,reason}', '') in (
        'resume_incident_superseded',
        'resume_source_run_superseded'
      )
    for update of a skip locked
  loop
    update public.account_session_resume_plans
    set resume_state = 'awaiting_human_resume_authorization',
        restart_allowed = true,
        restart_block_reason = '',
        assignment_id = v_row.assignment_id,
        device_id = v_row.device_id,
        app_instance_id = v_row.app_instance_id,
        scheduled_window_start = v_row.starts_at,
        scheduled_window_end = v_row.ends_at,
        last_updated_at = now()
    where id = v_row.resume_plan_id
      and account_id = v_row.account_id
      and run_id = v_row.run_id;

    update public.incident_resume_authorizations
    set status = 'armed',
        expired_at = null,
        consume_error = null,
        scheduled_window_start = v_row.starts_at,
        scheduled_window_end = v_row.ends_at,
        expires_at = v_row.ends_at,
        updated_at = now(),
        metadata_safe = (coalesce(metadata_safe, '{}'::jsonb) - 'terminal_reconciliation')
          || jsonb_build_object(
            'pre_run_supersession_reconciled', true,
            'pre_run_supersession_reconciled_at', now()
          )
    where id = v_row.authorization_id
      and status = 'expired'
      and consumed_at is null;

    update public.account_incidents
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'recovery', coalesce(metadata -> 'recovery', '{}'::jsonb) || jsonb_build_object(
            'state', 'ready_to_resume',
            'authorization_id', v_row.authorization_id,
            'source', 'pre_run_supersession_reconciliation',
            'updated_at', now()
          )
        ),
        updated_at = now()
    where id = v_row.incident_id;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('pre_run_rearmed_count', v_count);
end
$$;

revoke all on function public.rearm_resolved_pre_run_incident_authorizations_v1()
  from public, anon, authenticated;
grant execute on function public.rearm_resolved_pre_run_incident_authorizations_v1()
  to service_role;

create or replace function public.reconcile_resolved_incident_resume_windows_v2()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base jsonb;
  v_pre_run jsonb;
  v_rearmed jsonb;
  v_enriched integer := 0;
begin
  v_base := public.reconcile_resolved_incident_resume_windows_v1();
  v_pre_run := public.reconcile_resolved_pre_run_incident_authorizations_v1();
  v_rearmed := public.rearm_resolved_pre_run_incident_authorizations_v1();

  update public.incident_resume_authorizations a
  set source_run_id = coalesce(a.source_run_id, a.run_id, i.run_id),
      source_request_id = coalesce(a.source_request_id, p.run_request_id),
      resolved_by = coalesce(a.resolved_by, i.resolved_by),
      resolved_at = coalesce(a.resolved_at, i.resolved_at),
      cause_fixed_version = coalesce(a.cause_fixed_version, i.metadata #>> '{manual_resolution_v2,cause_fixed_version}'),
      business_date = coalesce(a.business_date, (coalesce(i.resolved_at, a.armed_at) at time zone 'Africa/Johannesburg')::date),
      expected_worker_sha = coalesce(a.expected_worker_sha, lower(i.metadata #>> '{manual_resolution_v2,expected_worker_sha}')),
      expires_at = coalesce(a.expires_at, a.scheduled_window_end),
      idempotency_key = coalesce(a.idempotency_key, 'incident-resume:' || a.account_id::text || ':' || a.incident_id::text || ':v' || i.lifecycle_version::text),
      updated_at = now()
  from public.account_incidents i, public.account_session_resume_plans p
  where a.incident_id = i.id and a.resume_plan_id = p.id
    and a.status = 'armed'
    and i.status = 'resolved'
    and (i.metadata #>> '{manual_resolution_v2,expected_worker_sha}') ~ '^[0-9a-f]{40}$'
    and nullif(i.metadata #>> '{manual_resolution_v2,cause_fixed_version}', '') is not null
    and (a.expected_worker_sha is null or a.cause_fixed_version is null or a.idempotency_key is null);
  get diagnostics v_enriched = row_count;

  return coalesce(v_base, '{}'::jsonb)
    || coalesce(v_pre_run, '{}'::jsonb)
    || coalesce(v_rearmed, '{}'::jsonb)
    || jsonb_build_object('v2_enriched_count', v_enriched);
end
$$;

revoke all on function public.reconcile_resolved_incident_resume_windows_v2()
  from public, anon, authenticated;
grant execute on function public.reconcile_resolved_incident_resume_windows_v2()
  to service_role;

comment on function public.rearm_resolved_pre_run_incident_authorizations_v1() is
  'Re-arms only an exact, resolved, non-security pre-run recovery authorization incorrectly superseded by its older source-run incident; no historical key or consumed authorization is reused.';

-- One-time reconciliation only.  It creates no request and runs no tick.
select public.rearm_resolved_pre_run_incident_authorizations_v1();
