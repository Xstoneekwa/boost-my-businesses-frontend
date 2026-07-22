-- Recycle expired device locks once their bound request is no longer active.
-- Active request-bound locks remain conservative even after their lease TTL.

create or replace function public.auto_restart_acquire_device_lock(
  p_device_id uuid,
  p_worker_id text,
  p_account_id uuid,
  p_app_instance_id uuid,
  p_lease_seconds integer default 900,
  p_reason text default 'auto_restart',
  p_owner_kind text default 'worker',
  p_operation_phase text default 'executing'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => greatest(p_lease_seconds, 30));
  v_existing public.auto_restart_device_locks%rowtype;
  v_lease_id uuid;
begin
  delete from public.auto_restart_device_locks as device_lock
  where device_lock.device_id = p_device_id
    and device_lock.lease_expires_at <= v_now
    and (
      device_lock.request_id is null
      or not exists (
        select 1
        from public.account_run_requests as bound_request
        where bound_request.id = device_lock.request_id
          and bound_request.status in ('queued', 'claimed', 'running', 'cancel_requested')
      )
    );

  select * into v_existing
  from public.auto_restart_device_locks
  where device_id = p_device_id
  for update;

  if found then
    if v_existing.worker_id = p_worker_id then
      update public.auto_restart_device_locks
      set lease_expires_at = v_expires,
          account_id = p_account_id,
          app_instance_id = p_app_instance_id,
          reason = coalesce(nullif(p_reason, ''), v_existing.reason),
          owner_kind = coalesce(nullif(p_owner_kind, ''), v_existing.owner_kind),
          operation_phase = coalesce(nullif(p_operation_phase, ''), v_existing.operation_phase),
          heartbeat_at = v_now,
          updated_at = v_now
      where device_id = p_device_id
      returning lease_id into v_lease_id;
      perform public._device_ui_lease_audit(
        v_lease_id, p_device_id, 'renewed', p_owner_kind, p_worker_id, v_existing.request_id, v_existing.run_id, p_reason
      );
      return jsonb_build_object(
        'ok', true, 'acquired', true, 'renewed', true,
        'lease_id', v_lease_id, 'device_id', p_device_id
      );
    end if;
    return jsonb_build_object(
      'ok', false,
      'acquired', false,
      'reason', 'device_lease_unavailable',
      'legacy_reason', 'device_lock_held',
      'holder_worker_id', v_existing.worker_id,
      'lease_id', v_existing.lease_id
    );
  end if;

  insert into public.auto_restart_device_locks (
    device_id, worker_id, account_id, app_instance_id, lease_expires_at, reason,
    owner_kind, operation_phase, heartbeat_at
  ) values (
    p_device_id, p_worker_id, p_account_id, p_app_instance_id, v_expires,
    coalesce(nullif(p_reason, ''), 'auto_restart'),
    coalesce(nullif(p_owner_kind, ''), 'worker'),
    coalesce(nullif(p_operation_phase, ''), 'executing'),
    v_now
  )
  returning lease_id into v_lease_id;

  perform public._device_ui_lease_audit(
    v_lease_id, p_device_id, 'acquired', p_owner_kind, p_worker_id, null, null, p_reason
  );

  return jsonb_build_object(
    'ok', true, 'acquired', true, 'renewed', false,
    'lease_id', v_lease_id, 'device_id', p_device_id
  );
end;
$$;
