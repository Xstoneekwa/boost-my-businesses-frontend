-- Human confirmation + authoritative operator-cancel override V2.
-- Forward-only: preserve incident history, neutralize only exact run-created
-- blockers, and let a later natural scheduler tick create at most one retry.

create or replace function public.reconcile_operator_canceled_run_v1(
  p_account_id uuid,
  p_run_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_request public.account_run_requests%rowtype;
  v_run public.ig_runs%rowtype;
  v_plan public.account_session_resume_plans%rowtype;
  v_incident_ids uuid[] := '{}'::uuid[];
  v_incidents integer := 0;
  v_actions integer := 0;
  v_authorizations integer := 0;
  v_holds integer := 0;
  v_independent_blockers integer := 0;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_account_id is null or p_run_id is null or p_request_id is null then
    return jsonb_build_object('ok', false, 'reason', 'operator_canceled_lineage_required');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'operator-canceled-override-v1:' || p_account_id::text || ':' || p_request_id::text, 0
  ));

  select * into v_request
  from public.account_run_requests r
  where r.id = p_request_id and r.account_id = p_account_id and r.run_id = p_run_id
  for update;
  select * into v_run
  from public.ig_runs r
  where r.id = p_run_id and r.account_id = p_account_id
  for update;
  select * into v_plan
  from public.account_session_resume_plans p
  where p.run_id = p_run_id and p.run_request_id = p_request_id and p.account_id = p_account_id
  order by p.last_updated_at desc nulls last, p.created_at desc
  limit 1
  for update;

  if v_request.id is null or v_request.status <> 'canceled'
     or v_request.cancel_requested_at is null
     or v_run.id is null or v_run.status not in ('stopped', 'canceled')
     or v_plan.id is null or v_plan.resume_state <> 'completed'
     or v_plan.restart_block_reason <> 'operator_canceled'
     or v_plan.terminal_reason_code <> 'operator_canceled' then
    return jsonb_build_object('ok', false, 'reason', 'operator_canceled_terminal_proof_mismatch');
  end if;

  -- Make the terminal plan authoritative before resolving incidents so the
  -- ordinary incident-resolution trigger cannot arm an immediate resume.
  update public.account_session_resume_plans p
  set resume_stage = 'completed', resume_state = 'completed',
      restart_allowed = false, restart_block_reason = 'operator_canceled',
      terminal_reason_code = 'operator_canceled',
      plan = coalesce(p.plan, '{}'::jsonb) || jsonb_build_object(
        'operator_canceled_override', jsonb_build_object(
          'applied_at', v_now, 'request_id', p_request_id,
          'history_preserved', true, 'immediate_restart_allowed', false
        )
      ), last_updated_at = v_now
  where p.id = v_plan.id;

  select coalesce(array_agg(i.id order by i.created_at), '{}'::uuid[])
  into v_incident_ids
  from public.account_incidents i
  where i.account_id = p_account_id and i.run_id = p_run_id
    and i.status in ('open', 'acknowledged', 'investigating') and i.archived_at is null
    and i.created_at >= coalesce(v_run.started_at, v_request.started_at, v_request.created_at)
    and (
      i.metadata ->> 'request_id' = p_request_id::text
      or (not (i.metadata ? 'request_id') and i.source = 'instagram_ui')
    );

  update public.account_incidents i
  set status = 'resolved', resolved_at = coalesce(i.resolved_at, v_now),
      resolution_reason = 'operator_canceled_override',
      resolution_note = 'Run canceled by operator; exact run-created blocker neutralized.',
      lifecycle_version = i.lifecycle_version + 1,
      metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
        'operator_canceled_override', jsonb_build_object(
          'applied_at', v_now, 'request_id', p_request_id,
          'run_id', p_run_id, 'detected_history_preserved', true
        )
      ), updated_at = v_now
  where i.id = any(v_incident_ids) and i.status in ('open', 'acknowledged', 'investigating');
  get diagnostics v_incidents = row_count;

  update public.account_dashboard_actions a
  set status = 'resolved', blocking_campaign = false, requires_client_action = false,
      resolved_at = coalesce(a.resolved_at, v_now), updated_at = v_now,
      metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object(
        'last_transition', 'operator_canceled_override', 'transition_at', v_now,
        'request_id', p_request_id, 'run_id', p_run_id
      )
  where a.incident_id = any(v_incident_ids)
    and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted');
  get diagnostics v_actions = row_count;

  update public.incident_resume_authorizations a
  set status = 'revoked', updated_at = v_now,
      metadata_safe = coalesce(a.metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'revoked_reason', 'operator_canceled_override', 'request_id', p_request_id
      )
  where a.account_id = p_account_id and a.run_id = p_run_id
    and a.incident_id = any(v_incident_ids) and a.status = 'armed';
  get diagnostics v_authorizations = row_count;

  update public.instagram_account_restriction_holds h
  set status = 'superseded', updated_at = v_now,
      metadata_safe = coalesce(h.metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'superseded_reason', 'operator_canceled_override', 'request_id', p_request_id
      )
  where h.account_id = p_account_id and h.incident_id = any(v_incident_ids)
    and h.status in ('active', 'verification_required');
  get diagnostics v_holds = row_count;

  select (
    (select count(*) from public.account_incidents i
      where i.account_id = p_account_id and i.archived_at is null
        and i.status in ('open', 'acknowledged', 'investigating') and not (i.id = any(v_incident_ids)))
    + (select count(*) from public.account_dashboard_actions a
      where a.account_id = p_account_id
        and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
        and (a.blocking_campaign or a.requires_client_action)
        and (a.incident_id is null or not (a.incident_id = any(v_incident_ids))))
    + (select count(*) from public.instagram_account_restriction_holds h
      where h.account_id = p_account_id and h.status in ('active', 'verification_required')
        and not (h.incident_id = any(v_incident_ids)))
  )::integer into v_independent_blockers;

  return jsonb_build_object(
    'ok', true, 'reason', 'operator_canceled_override',
    'account_id', p_account_id, 'run_id', p_run_id, 'request_id', p_request_id,
    'incidents_resolved', v_incidents, 'dashboard_actions_resolved', v_actions,
    'resume_authorizations_revoked', v_authorizations,
    'restriction_holds_superseded', v_holds,
    'independent_blockers_preserved', v_independent_blockers,
    'immediate_restart_created', false,
    'next_natural_tick_eligible', v_independent_blockers = 0
  );
end;
$function$;

revoke all on function public.reconcile_operator_canceled_run_v1(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_operator_canceled_run_v1(uuid,uuid,uuid)
  to service_role;

create or replace function public.create_schedule_session_retry_v2(
  p_account_id uuid,
  p_assignment_id uuid,
  p_window_starts_at timestamptz,
  p_window_ends_at timestamptz,
  p_base_idempotency_key text,
  p_worker_id text,
  p_device_timezone text default null,
  p_retry_limit integer default 1,
  p_min_remaining_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_assignment public.account_assignments%rowtype;
  v_base public.account_run_requests%rowtype;
  v_plan public.account_session_resume_plans%rowtype;
  v_retry public.account_run_requests%rowtype;
  v_contract jsonb;
  v_retry_count integer := 0;
  v_retry_limit integer := least(greatest(coalesce(p_retry_limit, 1), 1), 3);
  v_min_remaining integer := least(greatest(coalesce(p_min_remaining_seconds, 600), 60), 3600);
  v_retry_ordinal integer;
  v_retry_key text;
  v_retry_reason text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_account_id is null or p_assignment_id is null or p_window_starts_at is null
     or p_window_ends_at is null or nullif(trim(p_base_idempotency_key), '') is null then
    return jsonb_build_object('created', false, 'reason', 'scheduled_retry_not_needed');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'schedule-session-retry-v2:' || p_assignment_id::text || ':' || p_window_starts_at::text, 0
  ));
  select * into v_assignment from public.account_assignments a
  where a.id = p_assignment_id and a.account_id = p_account_id
    and a.status in ('reserved', 'active') and a.schedule_mode = 'scheduled'
    and a.assignment_type = 'full_cycle' for share;
  if v_assignment.id is null or v_assignment.starts_at is distinct from p_window_starts_at
     or v_assignment.ends_at is distinct from p_window_ends_at then
    return jsonb_build_object('created', false, 'reason', 'scheduled_retry_not_needed');
  end if;
  if v_now < p_window_starts_at or v_now >= p_window_ends_at
     or extract(epoch from (p_window_ends_at - v_now)) < v_min_remaining then
    return jsonb_build_object('created', false, 'reason', 'scheduled_retry_window_closed');
  end if;

  select * into v_base from public.account_run_requests r
  where r.account_id = p_account_id and r.idempotency_key = trim(p_base_idempotency_key)
    and r.source_surface = 'instagram_schedule_session_cron'
    and r.requested_run_type = 'account_session' for share;
  if v_base.id is null then
    return jsonb_build_object('created', false, 'reason', 'scheduled_retry_not_needed');
  end if;

  if v_base.status = 'blocked' and v_base.error_code in ('package_settings_incomplete', 'runtime_contract_not_ready')
     and v_base.run_id is null then
    v_retry_reason := v_base.error_code;
  elsif v_base.status = 'canceled' and v_base.cancel_requested_at is not null and v_base.run_id is not null then
    select * into v_plan from public.account_session_resume_plans p
    where p.account_id = p_account_id and p.run_id = v_base.run_id
      and p.run_request_id = v_base.id
    order by p.last_updated_at desc nulls last, p.created_at desc limit 1;
    if v_plan.id is null or v_plan.resume_state <> 'completed'
       or v_plan.restart_block_reason <> 'operator_canceled'
       or v_plan.terminal_reason_code <> 'operator_canceled' then
      return jsonb_build_object('created', false, 'reason', 'scheduled_retry_not_needed');
    end if;
    v_retry_reason := 'operator_canceled';
  else
    return jsonb_build_object('created', false, 'reason', 'scheduled_retry_not_needed');
  end if;

  v_contract := public.account_package_runtime_contract_status(p_account_id);
  if not coalesce((v_contract ->> 'ok')::boolean, false) then
    return jsonb_build_object('created', false, 'reason', 'package_runtime_contract_blocked');
  end if;
  if public.account_has_active_ig_run(p_account_id)
     or exists (select 1 from public.account_run_requests r where r.account_id = p_account_id and r.status in ('queued','claimed','starting','running'))
     or exists (select 1 from public.auto_restart_device_locks l where l.device_id = v_assignment.device_id and l.lease_expires_at > v_now)
     or exists (select 1 from public.ig_account_settings s where s.account_id = p_account_id and coalesce(s.manual_stop_requested, false))
     or exists (select 1 from public.account_incidents i where i.account_id = p_account_id and i.archived_at is null and i.status in ('open','acknowledged','investigating'))
     or exists (
       select 1
       from public.account_dashboard_actions a
       where a.account_id = p_account_id
         and coalesce(a.blocking_campaign, false)
         and a.status in ('pending','acknowledged','pending_verification','code_submitted')
         and (
           a.incident_id is null
           or exists (
             select 1
             from public.account_incidents linked_incident
             where linked_incident.id = a.incident_id
               and linked_incident.account_id = a.account_id
               and linked_incident.status in ('open','acknowledged','investigating')
               and linked_incident.resolved_at is null
               and linked_incident.archived_at is null
           )
         )
     )
     or exists (
       select 1
       from public.instagram_account_restriction_holds h
       where h.account_id = p_account_id
         and h.status in ('active','verification_required')
     ) then
    return jsonb_build_object('created', false, 'reason', 'scheduled_retry_not_needed');
  end if;

  select count(*)::integer into v_retry_count from public.account_run_requests r
  where r.account_id = p_account_id and r.source_surface = 'instagram_schedule_session_cron'
    and r.metadata_safe ->> 'retry_of_request_id' = v_base.id::text;
  if v_retry_count >= v_retry_limit then
    return jsonb_build_object('created', false, 'reason', 'scheduled_retry_limit_reached', 'retry_count', v_retry_count);
  end if;

  v_retry_ordinal := v_retry_count + 1;
  v_retry_key := left(trim(p_base_idempotency_key) || ':retry:v2:' || v_retry_ordinal::text, 240);
  v_retry := public.create_account_run_request(
    p_account_id => p_account_id, p_requested_by => null, p_actor_type => 'system',
    p_source_surface => 'instagram_schedule_session_cron',
    p_requested_run_type => 'account_session', p_idempotency_key => v_retry_key,
    p_priority => 0,
    p_metadata_safe => jsonb_build_object(
      'source', 'schedule_session_cron', 'trigger', 'scheduler',
      'assignment_id', p_assignment_id, 'worker_id', coalesce(nullif(trim(p_worker_id), ''), 'schedule_session_cron'),
      'scheduled_session_at', p_window_starts_at, 'scheduled_session_ends_at', p_window_ends_at,
      'business_action_deadline', p_window_ends_at,
      'business_action_deadline_source', 'scheduler_canonical_device_window_v1',
      'device_timezone', p_device_timezone, 'retry_of_request_id', v_base.id,
      'retry_reason', v_retry_reason, 'schedule_retry_version', 2,
      'schedule_retry_ordinal', v_retry_ordinal, 'fresh_business_session_required', true
    )
  );
  insert into public.account_package_runtime_contract_events (
    account_id, assignment_id, request_id, event_type, source,
    idempotency_key, details_safe
  ) values (
    p_account_id, p_assignment_id, v_retry.id, 'scheduled_retry_created',
    'schedule_session_cron', left(v_retry_key || ':decision:created', 240),
    jsonb_build_object(
      'retry_of_request_id', v_base.id, 'retry_request_id', v_retry.id,
      'retry_ordinal', v_retry_ordinal, 'retry_reason', v_retry_reason,
      'schedule_retry_version', 2
    )
  ) on conflict (idempotency_key) where idempotency_key is not null do nothing;
  return jsonb_build_object(
    'created', true, 'reason', 'scheduled_retry_created', 'request_id', v_retry.id,
    'status', v_retry.status, 'idempotency_key', v_retry.idempotency_key,
    'retry_of_request_id', v_base.id, 'retry_ordinal', v_retry_ordinal,
    'retry_limit', v_retry_limit, 'retry_reason', v_retry_reason
  );
end;
$function$;

revoke all on function public.create_schedule_session_retry_v2(uuid,uuid,timestamptz,timestamptz,text,text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.create_schedule_session_retry_v2(uuid,uuid,timestamptz,timestamptz,text,text,text,integer,integer)
  to service_role;
