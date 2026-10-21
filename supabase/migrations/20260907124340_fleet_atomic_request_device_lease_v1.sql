begin;
-- Local Fleet candidate only. Preserve the installed enqueue guards verbatim.
-- Request creation and its device lease commit in the same RPC transaction.
do $copy_guarded_enqueue$
declare
  v_source text;
begin
  if to_regprocedure('public.fleet_enqueue_guarded_internal_v1(uuid,uuid,text,text,text,text,integer,jsonb)') is not null then
    raise exception 'fleet_atomic_enqueue_internal_already_exists';
  end if;
  v_source := pg_get_functiondef('public.create_account_run_request(uuid,uuid,text,text,text,text,integer,jsonb)'::regprocedure);
  if position('FUNCTION public.create_account_run_request(' in v_source) = 0 then
    raise exception 'fleet_atomic_enqueue_source_mismatch';
  end if;
  execute replace(v_source, 'FUNCTION public.create_account_run_request(', 'FUNCTION public.fleet_enqueue_guarded_internal_v1(');
end;
$copy_guarded_enqueue$;

revoke all on function public.fleet_enqueue_guarded_internal_v1(uuid,uuid,text,text,text,text,integer,jsonb) from public, anon, authenticated, service_role;

create or replace function public.create_account_run_request(
  p_account_id uuid,
  p_requested_by uuid default null,
  p_actor_type text default 'admin',
  p_source_surface text default 'instagram_dashboard',
  p_requested_run_type text default 'account_session',
  p_idempotency_key text default null,
  p_priority integer default 0,
  p_metadata_safe jsonb default '{}'::jsonb
) returns public.account_run_requests
language plpgsql security definer set search_path = public, pg_temp
as $atomic_request_lease$
declare
  v_assignment public.account_assignments%rowtype;
  v_request public.account_run_requests%rowtype;
  v_lock public.auto_restart_device_locks%rowtype;
  v_metadata jsonb := coalesce(p_metadata_safe, '{}'::jsonb);
  v_payload jsonb;
  v_binding jsonb;
  v_key text := coalesce(nullif(trim(p_idempotency_key), ''), 'dashboard:' || p_account_id::text || ':' || gen_random_uuid()::text);
  v_worker text;
  v_now timestamptz;
  v_lease_seconds integer;
  v_legacy_prelease boolean := false;
begin
  if v_metadata ?| array['device_lock_binding', 'fleet_atomic_enqueue_payload'] then
    raise exception 'caller_supplied_device_lease_authority_forbidden' using errcode = '22023';
  end if;

  if v_metadata ? 'device_lock_lease_seconds' then
    if jsonb_typeof(v_metadata -> 'device_lock_lease_seconds') is distinct from 'number'
       or (v_metadata ->> 'device_lock_lease_seconds') !~ '^[0-9]+$' then
      raise exception 'device_lock_lease_duration_invalid' using errcode = '22023';
    end if;
    if (v_metadata ->> 'device_lock_lease_seconds')::numeric not between 60 and 3600 then
      raise exception 'device_lock_lease_duration_invalid' using errcode = '22023';
    end if;
    v_lease_seconds := (v_metadata ->> 'device_lock_lease_seconds')::integer;
  else
    -- Existing default for callers with no configured Auto Restart duration.
    v_lease_seconds := 900;
  end if;

  -- Admission already orders account/assignment before device. Request row
  -- locks below are never taken before the device lock.
  perform 1 from public.ig_accounts where id = p_account_id for update;
  select * into v_assignment from public.account_assignments
    where account_id = p_account_id and status in ('active', 'reserved')
    order by created_at desc limit 1 for share;

  if not found or v_assignment.device_id is null then
    -- No device ownership is created here. Preserve existing non-device guards.
    return public.fleet_enqueue_guarded_internal_v1(p_account_id, p_requested_by,
      p_actor_type, p_source_surface, p_requested_run_type, v_key, p_priority, v_metadata);
  end if;

  if nullif(trim(v_metadata ->> 'device_id'), '') is not null
     and v_metadata ->> 'device_id' <> v_assignment.device_id::text then
    raise exception 'device_binding_mismatch' using errcode = '22023';
  end if;
  if nullif(trim(v_metadata ->> 'app_instance_id'), '') is not null
     and (v_metadata ->> 'app_instance_id') is distinct from v_assignment.app_instance_id::text then
    raise exception 'app_instance_binding_mismatch' using errcode = '22023';
  end if;
  if nullif(trim(v_metadata ->> 'worker_id'), '') is not null
     and nullif(trim(v_metadata ->> 'execution_worker_id'), '') is not null
     and trim(v_metadata ->> 'worker_id') <> trim(v_metadata ->> 'execution_worker_id') then
    raise exception 'device_worker_binding_mismatch' using errcode = '22023';
  end if;

  -- Serialize acquisition even when the device lock row does not exist yet.
  -- The unique device_id constraint also fences legacy concurrent insertions.
  perform pg_advisory_xact_lock(hashtextextended('fleet-device:' || v_assignment.device_id::text, 0));
  select * into v_lock from public.auto_restart_device_locks
    where device_id = v_assignment.device_id for update;

  v_payload := jsonb_build_object(
    'account_id', p_account_id, 'requested_by', p_requested_by,
    'actor_type', lower(coalesce(nullif(trim(p_actor_type), ''), 'admin')),
    'source_surface', coalesce(nullif(trim(p_source_surface), ''), 'instagram_dashboard'),
    'requested_run_type', lower(coalesce(nullif(trim(p_requested_run_type), ''), 'account_session')),
    'priority', coalesce(p_priority, 0), 'metadata', v_metadata,
    'device_id', v_assignment.device_id, 'app_instance_id', v_assignment.app_instance_id);

  select * into v_request from public.account_run_requests
    where idempotency_key = v_key for update;
  if found then
    if v_request.account_id is distinct from p_account_id
       or (v_request.metadata_safe -> 'fleet_atomic_enqueue_payload') is distinct from v_payload then
      raise exception 'device_enqueue_idempotency_conflict' using errcode = '22023';
    end if;
    v_binding := v_request.metadata_safe -> 'device_lock_binding';
    if v_binding ->> 'request_id' is distinct from v_request.id::text
       or v_binding ->> 'account_id' is distinct from p_account_id::text
       or v_binding ->> 'device_id' is distinct from v_assignment.device_id::text
       or nullif(v_binding ->> 'lease_id', '') is null then
      raise exception 'device_enqueue_binding_invalid';
    end if;
    if v_request.status in ('queued', 'claimed', 'starting', 'running', 'cancel_requested')
       and (v_lock.lease_id::text is distinct from v_binding ->> 'lease_id'
         or v_lock.request_id is distinct from v_request.id
         or v_lock.account_id is distinct from p_account_id
         or v_lock.worker_id is distinct from v_binding ->> 'worker_id') then
      raise exception 'device_enqueue_binding_no_longer_owned';
    end if;
    -- Read-only retry: never reacquire, rotate, renew, or adopt another token.
    return v_request;
  end if;

  v_legacy_prelease := v_lock.device_id is not null
    and v_lock.request_id is null and v_lock.run_id is null
    and v_lock.account_id is not distinct from p_account_id
    and v_lock.app_instance_id is not distinct from v_assignment.app_instance_id
    and v_lock.worker_id is not distinct from coalesce(
      nullif(trim(v_metadata->>'execution_worker_id'),''),nullif(trim(v_metadata->>'worker_id'),''))
    and v_lock.lease_expires_at > clock_timestamp();
  if v_legacy_prelease then
    -- Retain the locked row for exact adoption after all canonical enqueue guards.
    v_lock.device_id := null;
  end if;

  if v_lock.device_id is not null then
    raise exception 'device_lock_held' using errcode = '22023';
  end if;

  -- All historical eligibility and Fleet admission guards execute unchanged.
  v_request := public.fleet_enqueue_guarded_internal_v1(p_account_id, p_requested_by,
    p_actor_type, p_source_surface, p_requested_run_type, v_key, p_priority, v_metadata);
  if v_request.id is null or v_request.account_id is distinct from p_account_id
     or v_request.idempotency_key is distinct from v_key or v_request.status <> 'queued' then
    raise exception 'device_enqueue_request_identity_mismatch';
  end if;

  v_worker := coalesce(nullif(trim(v_metadata ->> 'execution_worker_id'), ''),
    nullif(trim(v_metadata ->> 'worker_id'), ''), 'pending-request:' || v_request.id::text);
  v_now := clock_timestamp();
  if v_legacy_prelease then
    update public.auto_restart_device_locks
      set request_id=v_request.id, operation_phase='queued', heartbeat_at=v_now, updated_at=v_now
      where device_id=v_assignment.device_id and lease_id=v_lock.lease_id
        and request_id is null and run_id is null and account_id=p_account_id
        and worker_id=v_worker returning * into v_lock;
    if not found then raise exception 'legacy_prelease_adoption_changed'; end if;
  else
  insert into public.auto_restart_device_locks
    (device_id, worker_id, account_id, app_instance_id, request_id,
     lease_expires_at, reason, owner_kind, operation_phase, heartbeat_at, updated_at)
    values (v_assignment.device_id, v_worker, p_account_id, v_assignment.app_instance_id,
      v_request.id, v_now + make_interval(secs => v_lease_seconds), 'atomic_enqueue', 'worker', 'queued', v_now, v_now)
    returning * into v_lock;
  end if;
  v_binding := jsonb_build_object('lease_id', v_lock.lease_id, 'generation', v_lock.lease_id,
    'device_id', v_lock.device_id, 'account_id', v_lock.account_id,
    'app_instance_id', v_lock.app_instance_id, 'request_id', v_request.id,
    'worker_id', v_lock.worker_id, 'lease_seconds', v_lease_seconds,
    'lease_expires_at', v_lock.lease_expires_at);
  if v_legacy_prelease then
    -- Server-derived provenance for the exact pre-token generation. The new
    -- tokenized transfer rebuilds this binding and rotates its lease_id.
    v_binding := v_binding || jsonb_build_object('phase_a_legacy_generation',v_lock.lease_id);
  end if;
  update public.account_run_requests set metadata_safe = coalesce(metadata_safe, '{}'::jsonb)
      || jsonb_build_object('device_lock_binding', v_binding, 'fleet_atomic_enqueue_payload', v_payload)
    where id = v_request.id returning * into v_request;
  perform public._device_ui_lease_audit(v_lock.lease_id, v_lock.device_id, 'acquired',
    v_lock.owner_kind, v_lock.worker_id, v_request.id, null, 'atomic_enqueue');
  return v_request;
end;
$atomic_request_lease$;

-- Phase B alone enforces non-null request_id. Legacy pre-request leases remain valid.

revoke all on function public.create_account_run_request(uuid,uuid,text,text,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.create_account_run_request(uuid,uuid,text,text,text,text,integer,jsonb) to service_role;
commit;
