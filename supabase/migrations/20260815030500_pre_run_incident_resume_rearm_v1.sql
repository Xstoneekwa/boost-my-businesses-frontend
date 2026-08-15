-- Re-arm only unconsumed pre-run authorizations that the former Backend
-- lineage rule expired while their exact assignment window is still active.

do $migration$
declare
  v_row record;
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
        scheduled_window_start = v_row.starts_at,
        scheduled_window_end = v_row.ends_at,
        expires_at = v_row.ends_at,
        updated_at = now(),
        metadata_safe = coalesce(metadata_safe, '{}'::jsonb) || jsonb_build_object(
          'lineage_validator_repaired', true,
          'lineage_validator_repaired_at', now()
        )
    where id = v_row.authorization_id
      and status = 'expired'
      and consumed_at is null;

    update public.account_incidents
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'recovery', coalesce(metadata -> 'recovery', '{}'::jsonb) || jsonb_build_object(
            'state', 'ready_to_resume',
            'authorization_id', v_row.authorization_id,
            'source', 'pre_run_lineage_validator_repair',
            'updated_at', now()
          )
        ),
        updated_at = now()
    where id = v_row.incident_id;
  end loop;
end
$migration$;
