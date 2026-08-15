-- Recover a consumed incident authorization when its generated Auto Restart
-- request fails before an ig_run exists. The consumed authorization and the
-- original schedule-session key remain immutable historical evidence.

create or replace function public.reconcile_resolved_pre_run_incident_authorizations_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_assignment public.account_assignments%rowtype;
  v_authorization_id uuid;
  v_count integer := 0;
  v_window_key text;
begin
  for v_row in
    select
      i.id as incident_id,
      i.account_id,
      i.lifecycle_version,
      i.incident_type,
      i.reason,
      i.failure_reason,
      i.resolved_by,
      i.resolved_at,
      i.metadata as incident_metadata,
      q.id as failed_request_id,
      old_auth.id as consumed_authorization_id,
      p.*
    from public.account_incidents i
    join public.account_run_requests q
      on q.id = case
        when coalesce(i.metadata ->> 'run_request_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (i.metadata ->> 'run_request_id')::uuid
        else null
      end
     and q.account_id = i.account_id
     and q.status = 'failed'
     and q.run_id is null
     and q.source_surface = 'auto_restart_tick'
    join public.incident_resume_authorizations old_auth
      on old_auth.id = case
        when coalesce(q.metadata_safe ->> 'authorization_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (q.metadata_safe ->> 'authorization_id')::uuid
        else null
      end
     and old_auth.account_id = i.account_id
     and old_auth.status = 'consumed'
     and old_auth.consumed_by_request_id = q.id
    join public.account_session_resume_plans p
      on p.id = case
        when coalesce(q.metadata_safe ->> 'resume_plan_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (q.metadata_safe ->> 'resume_plan_id')::uuid
        else null
      end
     and p.account_id = i.account_id
     and p.run_id = case
       when coalesce(q.metadata_safe ->> 'source_run_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (q.metadata_safe ->> 'source_run_id')::uuid
       else null
     end
     and old_auth.resume_plan_id = p.id
     and old_auth.run_id = p.run_id
    where i.status = 'resolved'
      and i.run_id is null
      and i.account_id is not null
      and left(lower(coalesce(i.incident_type, '')), 9) <> 'security_'
      and lower(coalesce(i.metadata ->> 'security_incident', 'false')) not in ('true', '1', 'yes')
      and coalesce(i.metadata ->> 'run_request_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and coalesce(q.metadata_safe ->> 'authorization_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and coalesce(q.metadata_safe ->> 'resume_plan_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and coalesce(q.metadata_safe ->> 'source_run_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and (i.metadata #>> '{manual_resolution_v2,expected_worker_sha}') ~ '^[0-9a-f]{40}$'
      and nullif(i.metadata #>> '{manual_resolution_v2,cause_fixed_version}', '') is not null
      and p.resume_state in ('resume_requested', 'awaiting_human_resume_authorization')
      and not exists (
        select 1
        from public.incident_resume_authorizations current_auth
        where current_auth.incident_id = i.id
          and current_auth.id <> old_auth.id
          and current_auth.status in ('armed', 'consumed')
      )
    for update of i skip locked
  loop
    select aa.* into v_assignment
    from public.account_assignments aa
    where aa.account_id = v_row.account_id
      and aa.status in ('reserved', 'active')
      and aa.starts_at <= now()
      and now() < aa.ends_at
      and coalesce(aa.schedule_mode, '') <> 'manual_only'
    order by aa.starts_at desc, aa.id
    limit 1;

    if v_assignment.id is null then
      continue;
    end if;

    v_window_key := v_row.account_id::text
      || ':' || v_assignment.starts_at::text
      || ':pre-run-incident:' || v_row.incident_id::text
      || ':v' || v_row.lifecycle_version::text;
    v_authorization_id := null;

    update public.account_session_resume_plans
    set resume_state = 'awaiting_human_resume_authorization',
        restart_allowed = true,
        restart_block_reason = '',
        assignment_id = v_assignment.id,
        device_id = v_assignment.device_id,
        app_instance_id = v_assignment.app_instance_id,
        scheduled_window_start = v_assignment.starts_at,
        scheduled_window_end = v_assignment.ends_at,
        resume_window_key = v_window_key,
        last_updated_at = now()
    where id = v_row.id
      and account_id = v_row.account_id
      and run_id = v_row.run_id;

    insert into public.incident_resume_authorizations (
      incident_id, account_id, run_id, source_run_id, source_request_id,
      resume_plan_id, resume_window_key, scheduled_window_start,
      scheduled_window_end, status, armed_source, armed_by, resolved_by,
      resolved_at, cause_fixed_version, business_date, expected_worker_sha,
      expires_at, idempotency_key, resolution_note, metadata_safe, test
    ) values (
      v_row.incident_id, v_row.account_id, v_row.run_id, v_row.run_id,
      v_row.failed_request_id, v_row.id, v_window_key,
      v_assignment.starts_at, v_assignment.ends_at, 'armed',
      'resolved_pre_run_incident_reconciliation',
      coalesce(v_row.resolved_by::text, 'system'), v_row.resolved_by,
      v_row.resolved_at,
      v_row.incident_metadata #>> '{manual_resolution_v2,cause_fixed_version}',
      (coalesce(v_row.resolved_at, now()) at time zone 'Africa/Johannesburg')::date,
      lower(v_row.incident_metadata #>> '{manual_resolution_v2,expected_worker_sha}'),
      v_assignment.ends_at,
      'incident-pre-run-resume:' || v_row.account_id::text || ':'
        || v_row.incident_id::text || ':v' || v_row.lifecycle_version::text,
      'Generic pre-run recovery after a consumed authorization failed before ig_run creation.',
      jsonb_build_object(
        'generic_pre_run_recovery', true,
        'failed_request_id', v_row.failed_request_id,
        'consumed_authorization_id', v_row.consumed_authorization_id,
        'source_run_id', v_row.run_id,
        'original_schedule_key_preserved', true
      ),
      lower(coalesce(v_row.incident_metadata ->> 'test', 'false')) in ('true', '1', 'yes')
    )
    on conflict do nothing
    returning id into v_authorization_id;

    if v_authorization_id is not null then
      update public.account_incidents
      set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'recovery', coalesce(metadata -> 'recovery', '{}'::jsonb) || jsonb_build_object(
              'state', 'ready_to_resume',
              'authorization_id', v_authorization_id,
              'failed_request_id', v_row.failed_request_id,
              'source', 'resolved_pre_run_incident_reconciliation',
              'updated_at', now()
            )
          ),
          updated_at = now()
      where id = v_row.incident_id;
      v_count := v_count + 1;
    end if;
  end loop;

  return jsonb_build_object('pre_run_armed_count', v_count);
end
$$;

revoke all on function public.reconcile_resolved_pre_run_incident_authorizations_v1()
  from public, anon, authenticated;
grant execute on function public.reconcile_resolved_pre_run_incident_authorizations_v1()
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
  v_enriched integer := 0;
begin
  v_base := public.reconcile_resolved_incident_resume_windows_v1();
  v_pre_run := public.reconcile_resolved_pre_run_incident_authorizations_v1();

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
    || jsonb_build_object('v2_enriched_count', v_enriched);
end
$$;

revoke all on function public.reconcile_resolved_incident_resume_windows_v2()
  from public, anon, authenticated;
grant execute on function public.reconcile_resolved_incident_resume_windows_v2()
  to service_role;

comment on function public.reconcile_resolved_pre_run_incident_authorizations_v1() is
  'Creates one new natural-tick authorization for a resolved non-security incident whose exact prior authorization was consumed by an Auto Restart request that failed before ig_run creation; historical keys and authorizations are never reused.';
