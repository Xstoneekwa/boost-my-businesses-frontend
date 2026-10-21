CREATE OR REPLACE FUNCTION public._device_ui_lease_audit(p_lease_id uuid, p_device_id uuid, p_event_type text, p_owner_kind text, p_worker_id text, p_request_id uuid, p_run_id uuid, p_reason text, p_metadata_safe jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.device_ui_lease_events (
    lease_id, device_id, event_type, owner_kind, worker_id, request_id, run_id, reason, metadata_safe
  ) values (
    p_lease_id, p_device_id, p_event_type, p_owner_kind, p_worker_id, p_request_id, p_run_id,
    coalesce(p_reason, ''), coalesce(p_metadata_safe, '{}'::jsonb)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.account_has_active_ig_run(p_account_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.ig_runs r
    where r.account_id = p_account_id
      and lower(coalesce(r.status, '')) in (
        'running',
        'queued',
        'pending',
        'in_progress',
        'active',
        'starting'
      )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.admit_account_run_attempt_v1(p_request_id uuid, p_worker_id text, p_assignment_id uuid, p_device_id uuid, p_app_instance_id uuid, p_expected_package text, p_scheduled_window_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_scheduled_window_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_lease_seconds integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_account_id uuid;
  v_account public.ig_accounts%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_lock public.auto_restart_device_locks%rowtype;
  v_request public.account_run_requests%rowtype;
  v_run public.ig_runs%rowtype;
  v_plan public.account_session_resume_plans%rowtype;
  v_device public.phone_devices%rowtype;
  v_instance public.phone_app_instances%rowtype;
  v_contract jsonb;
  v_schedule jsonb;
  v_run_id uuid;
begin
  perform set_config('lock_timeout', '2s', true);
  perform set_config('statement_timeout', '5s', true);
  if p_request_id is null or nullif(trim(p_worker_id), '') is null
     or p_assignment_id is null or p_device_id is null
     or p_app_instance_id is null or nullif(trim(p_expected_package), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'admission_binding_missing');
  end if;

  select account_id into v_account_id
  from public.account_run_requests where id = p_request_id;
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;

  -- Global lock order: account -> assignment -> device lock -> request -> run -> capsule.
  select * into v_account from public.ig_accounts
  where id = v_account_id for update;
  select * into v_assignment from public.account_assignments
  where id = p_assignment_id for update;
  select * into v_lock from public.auto_restart_device_locks
  where device_id = p_device_id for update;
  select * into v_request from public.account_run_requests
  where id = p_request_id for update;
  if v_request.run_id is not null then
    select * into v_run from public.ig_runs
    where id = v_request.run_id for update;
  end if;
  if v_request.run_id is not null then
    select * into v_plan from public.account_session_resume_plans
    where run_id = v_request.run_id for update;
  end if;

  if v_request.account_id is distinct from v_account.id
     or v_request.requested_run_type <> 'account_session'
     or v_request.status not in ('claimed', 'starting', 'running')
     or v_request.claimed_by is distinct from p_worker_id
     or v_request.lease_expires_at is null or v_request.lease_expires_at <= v_now
     or v_request.cancel_requested_at is not null or v_request.cancel_reason is not null then
    return jsonb_build_object('ok', false, 'reason', 'request_not_admissible');
  end if;
  if v_plan.zero_work_contract_version = 1 then
    if v_plan.irreversible_work_state <> 'PRE_DEVICE' then
      return jsonb_build_object('ok', false, 'reason', 'admission_already_left_pre_device');
    end if;
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'run_id', v_plan.run_id,
      'request_id', v_request.id,
      'irreversible_work_state', v_plan.irreversible_work_state
    );
  end if;
  if v_request.run_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'legacy_run_not_admissible');
  end if;
  if v_account.id is null
     or coalesce(v_account.admin_lifecycle_status, 'active') <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'account_not_active');
  end if;
  if v_assignment.id is null
     or v_assignment.account_id <> v_account.id
     or v_assignment.device_id <> p_device_id
     or v_assignment.app_instance_id <> p_app_instance_id
     or v_assignment.status not in ('pending', 'reserved', 'active')
     or (p_scheduled_window_start is not null and v_assignment.starts_at is distinct from p_scheduled_window_start)
     or (p_scheduled_window_end is not null and v_assignment.ends_at is distinct from p_scheduled_window_end) then
    return jsonb_build_object('ok', false, 'reason', 'assignment_not_admissible');
  end if;
  select * into v_device from public.phone_devices where id = p_device_id;
  select * into v_instance from public.phone_app_instances where id = p_app_instance_id;
  if v_device.id is null or v_device.status in ('maintenance','offline','unauthorized','disabled','retired')
     or v_instance.id is null or v_instance.device_id <> p_device_id
     or not v_instance.is_launchable or not v_instance.usable_for_auto_login
     or v_instance.status = 'disabled'
     or v_instance.package_name is distinct from p_expected_package then
    return jsonb_build_object('ok', false, 'reason', 'device_or_instance_not_admissible');
  end if;
  if v_lock.device_id is null or v_lock.lease_expires_at <= v_now
     or v_lock.account_id is distinct from v_account.id
     or v_lock.request_id is distinct from v_request.id then
    return jsonb_build_object('ok', false, 'reason', 'device_lock_not_bound');
  end if;

  if exists (
    select 1
    from public.canonical_active_operational_blockers_v1(array[v_account.id])
  ) then
    return jsonb_build_object('ok', false, 'reason', 'active_blocking_incident');
  end if;
  v_contract := public.account_package_runtime_contract_status(v_account.id);
  if not coalesce((v_contract->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', coalesce(v_contract->>'reason','package_contract_blocked'));
  end if;
  v_schedule := public.evaluate_account_schedule_gate(
    v_account.id,
    'account_session',
    case
      when v_request.metadata_safe->>'schedule_trigger' = 'manual'
        or v_request.actor_type in ('admin', 'client') then 'manual'
      else 'auto'
    end
  );
  if not coalesce((v_schedule->>'ok')::boolean, false)
     or (v_schedule->>'assignment_id')::uuid is distinct from v_assignment.id then
    return jsonb_build_object('ok', false, 'reason', coalesce(v_schedule->>'reason','assignment_window_closed'));
  end if;
  if v_request.execution_attempt_no > 3 then
    return jsonb_build_object('ok', false, 'reason', 'execution_attempt_exhausted');
  end if;

  insert into public.ig_runs(account_id, status, started_at, updated_at)
  values (v_account.id, 'running', v_now, v_now)
  returning id into v_run_id;

  update public.account_run_requests
  set run_id = v_run_id, status = 'running', started_at = coalesce(started_at, v_now),
      lease_expires_at = v_now + make_interval(secs => greatest(p_lease_seconds, 30)),
      updated_at = v_now
  where id = v_request.id;

  insert into public.account_session_resume_plans(
    run_id, run_request_id, account_id, assignment_id, device_id, app_instance_id,
    expected_username, expected_package, scheduled_window_start, scheduled_window_end,
    source_surface, run_trigger, resume_stage, resume_state, restart_allowed,
    restart_block_reason, attempts_in_window, plan, zero_work_contract_version,
    irreversible_work_state, last_updated_at
  ) values (
    v_run_id, v_request.id, v_account.id, v_assignment.id, p_device_id, p_app_instance_id,
    v_account.username, p_expected_package, v_assignment.starts_at, v_assignment.ends_at,
    v_request.source_surface, 'atomic_admission_v1', 'preflight', 'run_active', false,
    'run_in_progress', v_request.retry_index,
    jsonb_build_object(
      'root_business_session_id', v_request.root_business_session_id,
      'execution_attempt_no', v_request.execution_attempt_no,
      'retry_index', v_request.retry_index
    ), 1, 'PRE_DEVICE', v_now
  );

  update public.auto_restart_device_locks
  set run_id = v_run_id, lease_expires_at = greatest(lease_expires_at, v_now + make_interval(secs => greatest(p_lease_seconds,30))), updated_at = v_now
  where device_id = p_device_id;

  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'run_id', v_run_id,
    'request_id', v_request.id, 'root_business_session_id', v_request.root_business_session_id,
    'execution_attempt_no', v_request.execution_attempt_no,
    'irreversible_work_state', 'PRE_DEVICE'
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.begin_device_activity_v1(p_run_id uuid, p_request_id uuid, p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_account_id uuid;
  v_assignment_id uuid;
  v_device_id uuid;
  v_request public.account_run_requests%rowtype;
  v_plan public.account_session_resume_plans%rowtype;
begin
  perform set_config('lock_timeout', '2s', true);
  perform set_config('statement_timeout', '5s', true);
  select account_id, assignment_id, device_id into v_account_id, v_assignment_id, v_device_id
  from public.account_session_resume_plans
  where run_id = p_run_id and run_request_id = p_request_id;
  if v_account_id is null then return jsonb_build_object('ok',false,'reason','capsule_not_found'); end if;

  perform 1 from public.ig_accounts where id = v_account_id for update;
  perform 1 from public.account_assignments where id = v_assignment_id for update;
  perform 1 from public.auto_restart_device_locks where device_id = v_device_id for update;
  select * into v_request from public.account_run_requests where id = p_request_id for update;
  perform 1 from public.ig_runs where id = p_run_id for update;
  select * into v_plan from public.account_session_resume_plans where run_id = p_run_id for update;

  if v_plan.zero_work_contract_version <> 1
     or v_plan.run_request_id <> v_request.id
     or v_request.run_id <> p_run_id
     or v_request.status <> 'running'
     or v_request.claimed_by is distinct from p_worker_id
     or v_request.lease_expires_at is null or v_request.lease_expires_at <= v_now
     or v_request.cancel_requested_at is not null or v_request.cancel_reason is not null then
    return jsonb_build_object('ok',false,'reason','device_gate_lineage_or_lease_invalid');
  end if;
  if v_plan.irreversible_work_state = 'STARTED_OR_AMBIGUOUS' then
    return jsonb_build_object('ok',true,'idempotent',true,'irreversible_work_state','STARTED_OR_AMBIGUOUS');
  end if;
  if v_plan.irreversible_work_state <> 'PRE_DEVICE' then
    return jsonb_build_object('ok',false,'reason','device_gate_state_invalid');
  end if;
  update public.account_session_resume_plans
  set irreversible_work_state = 'STARTED_OR_AMBIGUOUS', last_updated_at = v_now
  where id = v_plan.id;
  return jsonb_build_object('ok',true,'idempotent',false,'irreversible_work_state','STARTED_OR_AMBIGUOUS');
end;
$function$
;
CREATE OR REPLACE FUNCTION public.certify_zero_work_and_enqueue_recovery_v1(p_source_run_id uuid, p_source_request_id uuid, p_worker_id text, p_lease_seconds integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_account_id uuid; v_assignment_id uuid; v_device_id uuid; v_app_instance_id uuid;
  v_account public.ig_accounts%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_lock public.auto_restart_device_locks%rowtype;
  v_request public.account_run_requests%rowtype;
  v_plan public.account_session_resume_plans%rowtype;
  v_device public.phone_devices%rowtype;
  v_instance public.phone_app_instances%rowtype;
  v_contract jsonb;
  v_schedule jsonb;
  v_key text;
  v_new_request_id uuid := gen_random_uuid();
  v_existing_request_id uuid;
  v_next_attempt smallint;
begin
  perform set_config('lock_timeout','2s',true);
  perform set_config('statement_timeout','5s',true);
  if nullif(trim(p_worker_id),'') is null then
    return jsonb_build_object('ok',false,'reason','worker_id_required');
  end if;
  select account_id, assignment_id, device_id, app_instance_id
  into v_account_id, v_assignment_id, v_device_id, v_app_instance_id
  from public.account_session_resume_plans
  where run_id=p_source_run_id and run_request_id=p_source_request_id;
  if v_account_id is null then return jsonb_build_object('ok',false,'reason','capsule_not_found'); end if;

  -- Same global order as admission and the device gate.
  select * into v_account from public.ig_accounts where id=v_account_id for update;
  select * into v_assignment from public.account_assignments where id=v_assignment_id for update;
  select * into v_lock from public.auto_restart_device_locks where device_id=v_device_id for update;
  select * into v_request from public.account_run_requests where id=p_source_request_id for update;
  perform 1 from public.ig_runs where id=p_source_run_id for update;
  select * into v_plan from public.account_session_resume_plans where run_id=p_source_run_id for update;

  v_next_attempt := v_request.execution_attempt_no + 1;
  v_key := 'control-plane-zero-work:' || v_request.root_business_session_id::text || ':S' || v_next_attempt::text;
  select id into v_existing_request_id
  from public.account_run_requests where idempotency_key=v_key;
  if v_existing_request_id is not null then
    return jsonb_build_object(
      'ok',true,'enqueued',true,'deduplicated',true,
      'request_id',v_existing_request_id,'idempotency_key',v_key,
      'execution_attempt_no',v_next_attempt
    );
  end if;

  if v_plan.zero_work_contract_version <> 1
     or v_plan.irreversible_work_state <> 'PRE_DEVICE'
     or v_plan.run_request_id <> v_request.id
     or v_request.run_id <> p_source_run_id then
    return jsonb_build_object('ok',false,'reason','zero_work_not_certifiable');
  end if;
  if v_request.cancel_requested_at is not null or v_request.cancel_reason is not null
     or v_request.status = 'canceled' then
    return jsonb_build_object('ok',false,'reason','user_canceled');
  end if;
  if not (
    (v_request.status in ('failed','blocked')
      and v_request.error_code in (
        'control_plane_unavailable_pre_device',
        'PRE_DEVICE_SAFE_STOP',
        'certified_zero_work_recovery'
      ))
    or (v_request.status in ('claimed','starting','running')
      and v_request.lease_expires_at is not null
      and v_request.lease_expires_at <= v_now)
  ) then
    return jsonb_build_object('ok',false,'reason','source_not_pre_device_safe_stopped');
  end if;
  if v_next_attempt > 3 then
    update public.account_session_resume_plans
    set resume_state='not_recoverable', restart_allowed=false,
        restart_block_reason='execution_attempt_exhausted', last_updated_at=v_now
    where id=v_plan.id;
    return jsonb_build_object('ok',false,'reason','execution_attempt_exhausted');
  end if;
  if v_account.id is null or coalesce(v_account.admin_lifecycle_status,'active') <> 'active' then
    return jsonb_build_object('ok',false,'reason','account_not_active');
  end if;
  if v_assignment.id is null or v_assignment.account_id <> v_account.id
     or v_assignment.status not in ('pending','reserved','active')
     or v_assignment.device_id <> v_device_id
     or v_assignment.app_instance_id <> v_app_instance_id then
    return jsonb_build_object('ok',false,'reason','assignment_not_admissible');
  end if;
  select * into v_device from public.phone_devices where id=v_device_id;
  select * into v_instance from public.phone_app_instances where id=v_app_instance_id;
  if v_device.id is null or v_device.status in ('maintenance','offline','unauthorized','disabled','retired')
     or v_instance.id is null or v_instance.device_id <> v_device_id
     or not v_instance.is_launchable or not v_instance.usable_for_auto_login
     or v_instance.status='disabled'
     or v_instance.package_name is distinct from v_plan.expected_package then
    return jsonb_build_object('ok',false,'reason','device_or_instance_not_admissible');
  end if;
  if v_lock.device_id is not null and v_lock.lease_expires_at > v_now
     and v_lock.request_id is not null
     and v_lock.request_id <> p_source_request_id then
    return jsonb_build_object('ok',false,'reason','device_lock_held');
  end if;

  if exists (
    select 1
    from public.canonical_active_operational_blockers_v1(array[v_account.id])
  ) then return jsonb_build_object('ok',false,'reason','active_blocking_incident'); end if;
  v_contract := public.account_package_runtime_contract_status(v_account.id);
  if not coalesce((v_contract->>'ok')::boolean,false) then
    return jsonb_build_object('ok',false,'reason',coalesce(v_contract->>'reason','package_contract_blocked'));
  end if;
  v_schedule := public.evaluate_account_schedule_gate(
    v_account.id,
    'account_session',
    case
      when v_request.metadata_safe->>'schedule_trigger' = 'manual'
        or v_request.actor_type in ('admin', 'client') then 'manual'
      else 'auto'
    end
  );
  if not coalesce((v_schedule->>'ok')::boolean,false)
     or (v_schedule->>'assignment_id')::uuid is distinct from v_assignment.id then
    return jsonb_build_object('ok',false,'reason',coalesce(v_schedule->>'reason','assignment_window_closed'));
  end if;

  -- Terminalize the source and certify zero work before creating its successor.
  update public.account_run_requests
  set status='failed', completed_at=coalesce(completed_at,v_now), lease_expires_at=null,
      error_code=coalesce(error_code,'certified_zero_work_recovery'),
      error_message_safe=coalesce(error_message_safe,'Certified zero-work attempt superseded by bounded recovery.'),
      updated_at=v_now
  where id=v_request.id and status in ('claimed','starting','running','failed','blocked');
  update public.ig_runs
  set status='stopped', finished_at=coalesce(finished_at,v_now),
      completed_at=coalesce(completed_at,v_now), updated_at=v_now
  where id=p_source_run_id and status in ('pending','running');
  update public.account_session_resume_plans
  set resume_state='recovery_enqueued', restart_allowed=false,
      restart_block_reason='recovery_enqueued', zero_work_certified_at=coalesce(zero_work_certified_at,v_now),
      last_updated_at=v_now
  where id=v_plan.id;

  insert into public.account_run_requests(
    id, account_id, requested_by, actor_type, source_surface, requested_run_type,
    status, priority, idempotency_key, metadata_safe, root_business_session_id,
    execution_attempt_no, retry_index
  ) values (
    v_new_request_id, v_account.id, v_request.requested_by, 'system',
    'control_plane_zero_work_recovery_v1', 'account_session', 'queued',
    v_request.priority, v_key,
    coalesce(v_request.metadata_safe,'{}'::jsonb) || jsonb_build_object(
      'zero_work_recovery_v1',true,
      'source_run_id',p_source_run_id::text,
      'source_request_id',p_source_request_id::text,
      'root_business_session_id',v_request.root_business_session_id::text,
      'execution_attempt_no',v_next_attempt,
      'retry_index',v_next_attempt-1,
      'schedule_trigger',case
        when v_request.metadata_safe->>'schedule_trigger' = 'manual'
          or v_request.actor_type in ('admin', 'client') then 'manual'
        else 'auto'
      end,
      'worker_id',p_worker_id
    ),
    v_request.root_business_session_id, v_next_attempt, v_next_attempt-1
  );

  insert into public.auto_restart_device_locks(
    device_id, worker_id, account_id, app_instance_id, request_id, run_id,
    lease_expires_at, reason, metadata_safe, created_at, updated_at
  ) values (
    v_device_id, p_worker_id, v_account.id, v_app_instance_id, v_new_request_id, null,
    v_now + make_interval(secs=>greatest(p_lease_seconds,30)),
    'control_plane_zero_work_recovery_v1',
    jsonb_build_object('root_business_session_id',v_request.root_business_session_id::text,'execution_attempt_no',v_next_attempt),
    v_now,v_now
  )
  on conflict (device_id) do update
  set worker_id=excluded.worker_id, account_id=excluded.account_id,
      app_instance_id=excluded.app_instance_id, request_id=excluded.request_id,
      run_id=null, lease_expires_at=excluded.lease_expires_at,
      reason=excluded.reason, metadata_safe=excluded.metadata_safe, updated_at=v_now
  where public.auto_restart_device_locks.lease_expires_at <= v_now
     or public.auto_restart_device_locks.request_id = p_source_request_id;

  if not exists (
    select 1 from public.auto_restart_device_locks
    where device_id=v_device_id and request_id=v_new_request_id
  ) then raise exception using errcode='40001', message='device_lock_concurrent_change'; end if;

  return jsonb_build_object(
    'ok',true,'enqueued',true,'deduplicated',false,'request_id',v_new_request_id,
    'idempotency_key',v_key,'root_business_session_id',v_request.root_business_session_id,
    'execution_attempt_no',v_next_attempt,'retry_index',v_next_attempt-1
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.consume_resume_authorization_and_create_request_v2(p_authorization_id uuid, p_worker_id text, p_device_id uuid, p_metadata_safe jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_auth public.incident_resume_authorizations%rowtype;
  v_incident public.account_incidents%rowtype;
  v_plan public.account_session_resume_plans%rowtype;
  v_request public.account_run_requests%rowtype;
  v_plan_error text;
begin
  select * into v_auth
  from public.incident_resume_authorizations
  where id = p_authorization_id
  for update;

  if v_auth.id is null then
    raise exception 'resume_authorization_missing' using errcode = '22023';
  end if;
  if v_auth.status = 'consumed' and v_auth.consumed_by_request_id is not null then
    return jsonb_build_object(
      'request_id', v_auth.consumed_by_request_id,
      'authorization_id', v_auth.id,
      'idempotent', true
    );
  end if;
  if v_auth.status <> 'armed' then
    raise exception 'resume_authorization_consumed' using errcode = '40001';
  end if;
  if v_auth.test then
    raise exception 'test_authorization_excluded' using errcode = '22023';
  end if;
  if v_auth.scheduled_window_start is null or v_auth.scheduled_window_end is null
     or not (v_auth.scheduled_window_start <= now() and now() < v_auth.scheduled_window_end) then
    raise exception 'resume_authorization_expired' using errcode = '22023';
  end if;

  select * into v_incident from public.account_incidents
  where id = v_auth.incident_id and account_id = v_auth.account_id
  for share;
  if v_incident.id is null or v_incident.status <> 'resolved' then
    raise exception 'resume_incident_not_resolved' using errcode = '22023';
  end if;

  select * into v_plan from public.account_session_resume_plans
  where id = v_auth.resume_plan_id
    and account_id = v_auth.account_id
    and run_id = v_auth.run_id
  for update;
  if v_plan.id is null
     or v_plan.resume_state <> 'awaiting_human_resume_authorization' then
    raise exception 'resume_plan_not_recoverable' using errcode = '22023';
  end if;

  if p_metadata_safe ->> 'incident_id' <> v_auth.incident_id::text
     or p_metadata_safe ->> 'authorization_id' <> v_auth.id::text
     or p_metadata_safe -> 'resume_plan' ->> 'account_id' <> v_auth.account_id::text then
    raise exception 'resume_phase_plan_identity_mismatch' using errcode = '22023';
  end if;
  v_plan_error := public.auto_restart_phase_plan_v2_error(p_metadata_safe -> 'resume_plan');
  if v_plan_error is not null then
    raise exception '%', v_plan_error using errcode = '22023';
  end if;

  if p_device_id is not null and not exists (
    select 1 from public.auto_restart_device_locks l
    where l.device_id = p_device_id
      and l.account_id = v_auth.account_id
      and l.worker_id = p_worker_id
      and l.lease_expires_at > now()
    for update
  ) then
    raise exception 'resume_device_lock_missing' using errcode = '40001';
  end if;

  update public.incident_resume_authorizations
  set status = 'consumed', consumed_at = now(), consume_error = null,
      frozen_phase_plan = p_metadata_safe -> 'resume_plan', updated_at = now()
  where id = v_auth.id;

  v_request := public.create_account_run_request(
    p_account_id => v_auth.account_id,
    p_requested_by => null,
    p_actor_type => 'system',
    p_source_surface => 'auto_restart_tick',
    p_requested_run_type => 'account_session',
    p_idempotency_key => 'resume-auth:' || v_auth.id::text || ':g' || v_auth.retry_generation::text,
    p_priority => 0,
    p_metadata_safe => p_metadata_safe
  );

  update public.incident_resume_authorizations
  set consumed_by_request_id = v_request.id, updated_at = now()
  where id = v_auth.id;

  update public.account_session_resume_plans
  set resume_state = 'resume_requested', plan = coalesce(plan, '{}'::jsonb) || jsonb_build_object(
        'frozen_phase_plan', p_metadata_safe -> 'resume_plan',
        'resume_request_id', v_request.id,
        'retry_generation', v_auth.retry_generation
      ), last_updated_at = now()
  where id = v_plan.id;

  update public.account_incidents
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'recovery', coalesce(metadata -> 'recovery', '{}'::jsonb) || jsonb_build_object(
          'state', 'resume_requested', 'resume_request_id', v_request.id,
          'authorization_id', v_auth.id, 'retry_generation', v_auth.retry_generation,
          'updated_at', now()
        )
      ), updated_at = now()
  where id = v_incident.id;

  if p_device_id is not null then
    update public.auto_restart_device_locks
    set request_id = v_request.id, updated_at = now()
    where device_id = p_device_id and worker_id = p_worker_id;
  end if;

  return jsonb_build_object(
    'request_id', v_request.id,
    'authorization_id', v_auth.id,
    'retry_generation', v_auth.retry_generation,
    'idempotent', false
  );
end
$function$
;
CREATE OR REPLACE FUNCTION public.consume_resume_authorization_and_create_request_v3(p_authorization_id uuid, p_worker_id text, p_device_id uuid, p_metadata_safe jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_auth public.incident_resume_authorizations%rowtype;
  v_incident public.account_incidents%rowtype;
  v_hold public.instagram_account_restriction_holds%rowtype;
  v_plan jsonb := p_metadata_safe -> 'resume_plan';
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into v_auth
  from public.incident_resume_authorizations
  where id = p_authorization_id
  for update;
  if v_auth.id is null then
    raise exception 'resume_authorization_missing' using errcode = '22023';
  end if;

  if coalesce((v_plan ->> 'restriction_preflight_only')::boolean, false) then
    select * into v_incident
    from public.account_incidents
    where id = v_auth.incident_id and account_id = v_auth.account_id
    for share;
    if v_incident.id is null
       or v_incident.status <> 'resolved'
       or v_incident.incident_type <> 'instagram_account_restriction' then
      raise exception 'restriction_preflight_not_authorized' using errcode = '22023';
    end if;
    if p_metadata_safe ->> 'restriction_preflight_only' <> 'true'
       or v_plan ->> 'incident_id' <> v_auth.incident_id::text
       or v_plan ->> 'authorization_id' <> v_auth.id::text
       or public.auto_restart_phase_plan_v2_error(v_plan) is not null then
      raise exception 'restriction_preflight_contract_invalid' using errcode = '22023';
    end if;

    select * into v_hold
    from public.instagram_account_restriction_holds
    where account_id = v_auth.account_id
      and incident_id = v_auth.incident_id
      and status = 'verification_required'
    for update;
    if v_hold.id is null then
      raise exception 'restriction_preflight_not_authorized' using errcode = '22023';
    end if;
  end if;

  return public.consume_resume_authorization_and_create_request_v2(
    p_authorization_id,
    p_worker_id,
    p_device_id,
    p_metadata_safe
  );
end
$function$
;
CREATE OR REPLACE FUNCTION public.consume_resume_authorization_and_create_request_v4(p_authorization_id uuid, p_worker_id text, p_device_id uuid, p_metadata_safe jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_auth public.incident_resume_authorizations%rowtype;
  v_plan public.account_session_resume_plans%rowtype;
  v_source public.account_run_requests%rowtype;
  v_next_attempt integer;
  v_metadata jsonb := coalesce(p_metadata_safe, '{}'::jsonb);
  v_embedded jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if coalesce((v_metadata -> 'resume_plan' ->> 'restriction_preflight_only')::boolean, false) then
    return public.consume_resume_authorization_and_create_request_v3(
      p_authorization_id, p_worker_id, p_device_id, v_metadata
    );
  end if;

  select * into v_auth from public.incident_resume_authorizations
  where id = p_authorization_id for update;
  if v_auth.id is null then
    raise exception 'resume_authorization_missing' using errcode = '22023';
  end if;
  if v_auth.status = 'consumed' and v_auth.consumed_by_request_id is not null then
    return public.consume_resume_authorization_and_create_request_v3(
      p_authorization_id, p_worker_id, p_device_id, v_metadata
    );
  end if;
  select * into v_plan from public.account_session_resume_plans
  where id = v_auth.resume_plan_id and account_id = v_auth.account_id and run_id = v_auth.run_id
  for update;
  select * into v_source from public.account_run_requests
  where id = v_plan.run_request_id and account_id = v_auth.account_id for share;
  v_next_attempt := v_source.execution_attempt_no + 1;
  if v_plan.id is null or v_source.id is null or v_source.root_business_session_id is null
     or v_next_attempt not between 2 and 3 then
    raise exception 'resume_plan_lineage_incomplete' using errcode = '22023';
  end if;

  v_embedded := v_metadata -> 'resume_plan';
  if (nullif(v_metadata ->> 'business_session_id', '') is not null
      and v_metadata ->> 'business_session_id' <> v_source.root_business_session_id::text)
     or (nullif(v_embedded ->> 'business_session_id', '') is not null
      and v_embedded ->> 'business_session_id' <> v_source.root_business_session_id::text)
     or (nullif(v_embedded ->> 'root_business_session_id', '') is not null
      and v_embedded ->> 'root_business_session_id' <> v_source.root_business_session_id::text)
     or (nullif(v_embedded ->> 'parent_request_id', '') is not null
      and v_embedded ->> 'parent_request_id' <> v_source.id::text)
     or (nullif(v_embedded ->> 'attempt_id', '') is not null
      and (v_embedded ->> 'attempt_id')::integer <> v_next_attempt)
     or (nullif(v_embedded ->> 'execution_attempt_no', '') is not null
      and (v_embedded ->> 'execution_attempt_no')::integer <> v_next_attempt) then
    raise exception 'resume_plan_lineage_mismatch' using errcode = '22023';
  end if;

  v_embedded := v_embedded || jsonb_build_object(
    'business_session_id', v_source.root_business_session_id::text,
    'root_business_session_id', v_source.root_business_session_id::text,
    'parent_request_id', v_source.id::text,
    'source_request_id', v_source.id::text,
    'attempt_id', v_next_attempt,
    'execution_attempt_no', v_next_attempt,
    'retry_index', v_next_attempt - 1
  );
  v_metadata := v_metadata || jsonb_build_object(
    'resume_lineage_contract_v1', true,
    'business_session_id', v_source.root_business_session_id::text,
    'root_business_session_id', v_source.root_business_session_id::text,
    'parent_request_id', v_source.id::text,
    'source_request_id', v_source.id::text,
    'attempt_id', v_next_attempt,
    'execution_attempt_no', v_next_attempt,
    'retry_index', v_next_attempt - 1,
    'resume_plan', v_embedded
  );
  return public.consume_resume_authorization_and_create_request_v3(
    p_authorization_id, p_worker_id, p_device_id, v_metadata
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'resume_plan_lineage_mismatch' using errcode = '22023';
end
$function$
;
CREATE OR REPLACE FUNCTION public.create_account_run_request(p_account_id uuid, p_requested_by uuid DEFAULT NULL::uuid, p_actor_type text DEFAULT 'admin'::text, p_source_surface text DEFAULT 'instagram_dashboard'::text, p_requested_run_type text DEFAULT 'account_session'::text, p_idempotency_key text DEFAULT NULL::text, p_priority integer DEFAULT 0, p_metadata_safe jsonb DEFAULT '{}'::jsonb)
 RETURNS account_run_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor_type text := lower(coalesce(nullif(trim(p_actor_type), ''), 'admin'));
  v_source_surface text := coalesce(nullif(trim(p_source_surface), ''), 'instagram_dashboard');
  v_requested_run_type text := lower(coalesce(nullif(trim(p_requested_run_type), ''), 'account_session'));
  v_idempotency_key text := coalesce(
    nullif(trim(p_idempotency_key), ''),
    'dashboard:' || p_account_id::text || ':' || gen_random_uuid()::text
  );
  v_metadata jsonb := coalesce(p_metadata_safe, '{}'::jsonb);
  v_existing public.account_run_requests;
  v_row public.account_run_requests;
  v_assignment public.account_assignments;
  v_app_instance public.phone_app_instances;
  v_parent_binding jsonb;
  v_resume_action_id text;
  v_parent_request_id text;
  v_scheduler_enabled boolean;
begin
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;

  if v_actor_type not in ('admin', 'assistant', 'ops', 'system', 'internal', 'client') then
    raise exception 'invalid_actor_type' using errcode = '22023';
  end if;

  if not public.run_control_metadata_is_safe(v_metadata) then
    raise exception 'metadata_forbidden_key' using errcode = '22023';
  end if;

  if v_requested_run_type = 'login_email_code_resume' then
    v_resume_action_id := coalesce(
      nullif(trim(v_metadata ->> 'action_id'), ''),
      nullif(trim(v_metadata ->> 'verification_action_id'), '')
    );
    if v_resume_action_id is null then
      raise exception 'login_resume_action_id_required' using errcode = '22023';
    end if;
  end if;

  select *
    into v_existing
  from public.account_run_requests arr
  where arr.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    return v_existing;
  end if;

  if v_source_surface in ('auto_restart_tick', 'instagram_schedule_session_cron') then
    select s.auto_restart_enabled
      into v_scheduler_enabled
    from public.auto_restart_settings s
    where s.id = 'global'
    for share;

    if not coalesce(v_scheduler_enabled, false) then
      raise exception 'scheduler_disabled' using errcode = '22023';
    end if;
  end if;

  if v_requested_run_type in ('login_provisioning', 'login_email_code_resume') then
    select aa.*
      into v_assignment
    from public.account_assignments aa
    where aa.account_id = p_account_id
      and aa.status in ('reserved', 'active')
    order by aa.created_at desc
    limit 1
    for share;

    if v_assignment.id is null then
      raise exception 'login_assignment_binding_missing' using errcode = '22023';
    end if;
    if v_assignment.app_instance_id is null then
      raise exception 'login_app_instance_binding_missing' using errcode = '22023';
    end if;

    select pai.*
      into v_app_instance
    from public.phone_app_instances pai
    where pai.id = v_assignment.app_instance_id
    for share;

    if v_app_instance.id is null then
      raise exception 'login_app_instance_binding_missing' using errcode = '22023';
    end if;
    if v_app_instance.device_id <> v_assignment.device_id then
      raise exception 'login_app_instance_device_mismatch' using errcode = '22023';
    end if;
    if nullif(trim(v_app_instance.package_name), '') is null
       or v_app_instance.package_name !~ '^[A-Za-z0-9_.]+$' then
      raise exception 'login_package_binding_missing' using errcode = '22023';
    end if;
    if not v_app_instance.is_launchable
       or not v_app_instance.usable_for_auto_login
       or v_app_instance.status not in ('available', 'active', 'occupied', 'reserved') then
      raise exception 'login_app_instance_unavailable' using errcode = '22023';
    end if;
    if v_app_instance.current_account_id is not null
       and v_app_instance.current_account_id <> p_account_id then
      raise exception 'login_app_instance_account_mismatch' using errcode = '22023';
    end if;

    -- Reject caller-provided routing that disagrees with the canonical rows.
    if nullif(trim(v_metadata ->> 'assignment_id'), '') is not null
       and v_metadata ->> 'assignment_id' <> v_assignment.id::text then
      raise exception 'login_assignment_binding_mismatch' using errcode = '22023';
    end if;
    if nullif(trim(v_metadata ->> 'device_id'), '') is not null
       and v_metadata ->> 'device_id' <> v_assignment.device_id::text then
      raise exception 'login_device_binding_mismatch' using errcode = '22023';
    end if;
    if nullif(trim(v_metadata ->> 'app_instance_id'), '') is not null
       and v_metadata ->> 'app_instance_id' <> v_app_instance.id::text then
      raise exception 'login_app_instance_binding_mismatch' using errcode = '22023';
    end if;
    if nullif(trim(v_metadata ->> 'package_name'), '') is not null
       and v_metadata ->> 'package_name' <> v_app_instance.package_name then
      raise exception 'login_package_binding_mismatch' using errcode = '22023';
    end if;
    if v_metadata ? 'clone_index' then
      if coalesce(v_metadata ->> 'clone_index', '') !~ '^[0-9]+$'
         or (v_metadata ->> 'clone_index')::integer <> v_app_instance.instance_index then
        raise exception 'login_clone_index_binding_mismatch' using errcode = '22023';
      end if;
    end if;

    v_metadata := v_metadata || jsonb_build_object(
      'binding_version', 'auto_login_app_instance_v1',
      'assignment_id', v_assignment.id,
      'device_id', v_assignment.device_id,
      'app_instance_id', v_app_instance.id,
      'package_name', v_app_instance.package_name,
      'clone_index', v_app_instance.instance_index
    );

    -- A verification-code resume must remain on the exact parent binding.
    if v_requested_run_type = 'login_email_code_resume' then
      v_parent_request_id := nullif(trim(v_metadata ->> 'parent_request_id'), '');
      if v_parent_request_id is not null then
        select arr.metadata_safe
          into v_parent_binding
        from public.account_run_requests arr
        where arr.id::text = v_parent_request_id
          and arr.account_id = p_account_id
          and arr.requested_run_type = 'login_provisioning'
        limit 1;

        if v_parent_binding is null
           or v_parent_binding ->> 'binding_version' <> 'auto_login_app_instance_v1'
           or nullif(trim(v_parent_binding ->> 'assignment_id'), '') is null
           or nullif(trim(v_parent_binding ->> 'device_id'), '') is null
           or nullif(trim(v_parent_binding ->> 'app_instance_id'), '') is null
           or nullif(trim(v_parent_binding ->> 'package_name'), '') is null
           or not (v_parent_binding ? 'clone_index') then
          raise exception 'login_parent_binding_missing' using errcode = '22023';
        end if;
        if v_parent_binding ->> 'assignment_id' <> v_metadata ->> 'assignment_id'
           or v_parent_binding ->> 'device_id' <> v_metadata ->> 'device_id'
           or v_parent_binding ->> 'app_instance_id' <> v_metadata ->> 'app_instance_id'
           or v_parent_binding ->> 'package_name' <> v_metadata ->> 'package_name'
           or (v_parent_binding ->> 'clone_index')::integer <> (v_metadata ->> 'clone_index')::integer then
          raise exception 'login_parent_binding_changed' using errcode = '22023';
        end if;
      end if;
    end if;
  end if;

  if v_requested_run_type not in ('login_provisioning', 'login_email_code_resume')
     and public.account_has_active_ig_run(p_account_id) then
    raise exception 'account_already_running' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.account_run_requests arr
    where arr.account_id = p_account_id
      and arr.status in ('queued', 'claimed', 'starting', 'running')
  ) then
    raise exception 'account_run_already_requested' using errcode = '22023';
  end if;

  insert into public.account_run_requests (
    account_id,
    requested_by,
    actor_type,
    source_surface,
    requested_run_type,
    status,
    priority,
    idempotency_key,
    metadata_safe
  )
  values (
    p_account_id,
    p_requested_by,
    v_actor_type,
    v_source_surface,
    v_requested_run_type,
    'queued',
    coalesce(p_priority, 0),
    v_idempotency_key,
    v_metadata
  )
  returning * into v_row;

  return v_row;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_pre_device_safe_stop_v1(p_run_id uuid, p_request_id uuid, p_worker_id text, p_reason_code text DEFAULT 'control_plane_unavailable_pre_device'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_account_id uuid; v_assignment_id uuid; v_device_id uuid;
  v_request public.account_run_requests%rowtype;
  v_plan public.account_session_resume_plans%rowtype;
begin
  perform set_config('lock_timeout','2s',true);
  perform set_config('statement_timeout','5s',true);
  select account_id, assignment_id, device_id into v_account_id, v_assignment_id, v_device_id
  from public.account_session_resume_plans where run_id=p_run_id and run_request_id=p_request_id;
  if v_account_id is null then return jsonb_build_object('ok',false,'reason','capsule_not_found'); end if;
  perform 1 from public.ig_accounts where id=v_account_id for update;
  perform 1 from public.account_assignments where id=v_assignment_id for update;
  perform 1 from public.auto_restart_device_locks where device_id=v_device_id for update;
  select * into v_request from public.account_run_requests where id=p_request_id for update;
  perform 1 from public.ig_runs where id=p_run_id for update;
  select * into v_plan from public.account_session_resume_plans where run_id=p_run_id for update;
  if v_plan.zero_work_contract_version <> 1
     or v_plan.irreversible_work_state <> 'PRE_DEVICE'
     or v_request.run_id <> p_run_id
     or v_request.claimed_by is distinct from p_worker_id
     or v_request.cancel_requested_at is not null or v_request.cancel_reason is not null then
    return jsonb_build_object('ok',false,'reason','zero_work_not_certifiable');
  end if;
  if p_reason_code not in (
    'control_plane_unavailable_pre_device',
    'PRE_DEVICE_SAFE_STOP'
  ) then
    return jsonb_build_object('ok',false,'reason','safe_stop_reason_not_transient');
  end if;
  update public.account_run_requests
  set status='failed', completed_at=v_now, lease_expires_at=null,
      error_code=left(p_reason_code,120),
      error_message_safe='Account session stopped before device activity; recovery may be enqueued.',
      updated_at=v_now
  where id=p_request_id;
  update public.ig_runs
  set status='stopped', finished_at=v_now, completed_at=v_now, updated_at=v_now
  where id=p_run_id and status in ('pending','running');
  update public.account_session_resume_plans
  set resume_state='pre_device_stopped', restart_allowed=true,
      restart_block_reason='certified_zero_work', terminal_reason_code=left(p_reason_code,120),
      zero_work_certified_at=v_now, last_updated_at=v_now
  where id=v_plan.id;
  return jsonb_build_object('ok',true,'zero_work_certified',true,'resume_state','pre_device_stopped');
end;
$function$
;