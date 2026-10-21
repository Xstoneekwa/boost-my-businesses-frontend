-- Read-only pg_get_functiondef snapshot of feb5086 production RPCs, 2026-09-08.
-- Only definitions, no production rows or credentials. Local fixture input.
CREATE OR REPLACE FUNCTION public.auto_restart_acquire_device_lock(p_device_id uuid, p_worker_id text, p_account_id uuid, p_app_instance_id uuid, p_lease_seconds integer DEFAULT 900, p_reason text DEFAULT 'auto_restart'::text, p_owner_kind text DEFAULT 'worker'::text, p_operation_phase text DEFAULT 'executing'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.auto_restart_bind_device_lock_to_request(p_device_id uuid, p_worker_id text, p_request_id uuid, p_lease_seconds integer DEFAULT 900)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => greatest(p_lease_seconds, 30));
  v_row public.auto_restart_device_locks%rowtype;
begin
  select * into v_row
  from public.auto_restart_device_locks
  where device_id = p_device_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'bound', false, 'reason', 'device_lock_missing');
  end if;

  if v_row.worker_id <> p_worker_id then
    return jsonb_build_object(
      'ok', false,
      'bound', false,
      'reason', 'device_lock_owner_mismatch',
      'holder_worker_id', v_row.worker_id
    );
  end if;

  update public.auto_restart_device_locks
  set request_id = p_request_id,
      lease_expires_at = v_expires,
      updated_at = v_now,
      metadata_safe = coalesce(metadata_safe, '{}'::jsonb) || jsonb_build_object('bound_request_id', p_request_id::text)
  where device_id = p_device_id;

  return jsonb_build_object('ok', true, 'bound', true, 'request_id', p_request_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.auto_restart_release_device_lock(p_device_id uuid, p_worker_id text, p_request_id uuid DEFAULT NULL::uuid, p_release_reason text DEFAULT 'terminal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_deleted integer;
  v_row public.auto_restart_device_locks%rowtype;
begin
  select * into v_row
  from public.auto_restart_device_locks
  where device_id = p_device_id
    and worker_id = p_worker_id
    and (p_request_id is null or request_id = p_request_id)
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'released', false);
  end if;

  perform public._device_ui_lease_audit(
    v_row.lease_id, p_device_id, 'released', v_row.owner_kind, p_worker_id,
    v_row.request_id, v_row.run_id, coalesce(p_release_reason, 'terminal')
  );

  delete from public.auto_restart_device_locks
  where device_id = p_device_id
    and worker_id = p_worker_id
    and (p_request_id is null or request_id = p_request_id);
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'released', v_deleted > 0, 'lease_id', v_row.lease_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.auto_restart_renew_device_lock(p_device_id uuid, p_worker_id text, p_request_id uuid, p_lease_seconds integer DEFAULT 900)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => greatest(p_lease_seconds, 30));
  v_row public.auto_restart_device_locks%rowtype;
begin
  delete from public.auto_restart_device_locks
  where device_id = p_device_id
    and lease_expires_at <= v_now
    and request_id is null;

  select * into v_row
  from public.auto_restart_device_locks
  where device_id = p_device_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'renewed', false, 'reason', 'device_lock_missing');
  end if;

  if v_row.worker_id <> p_worker_id then
    return jsonb_build_object('ok', false, 'renewed', false, 'reason', 'device_lock_owner_mismatch');
  end if;

  if v_row.request_id is not null and v_row.request_id <> p_request_id then
    return jsonb_build_object('ok', false, 'renewed', false, 'reason', 'device_lock_request_mismatch');
  end if;

  update public.auto_restart_device_locks
  set lease_expires_at = v_expires,
      request_id = coalesce(request_id, p_request_id),
      updated_at = v_now
  where device_id = p_device_id;

  return jsonb_build_object('ok', true, 'renewed', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.auto_restart_transfer_device_lock(p_device_id uuid, p_request_id uuid, p_new_worker_id text, p_lease_seconds integer DEFAULT 900)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => greatest(p_lease_seconds, 30));
  v_row public.auto_restart_device_locks%rowtype;
begin
  select * into v_row
  from public.auto_restart_device_locks
  where device_id = p_device_id
    and request_id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'transferred', false, 'reason', 'device_lock_missing');
  end if;

  update public.auto_restart_device_locks
  set worker_id = p_new_worker_id,
      lease_expires_at = v_expires,
      updated_at = v_now
  where device_id = p_device_id
    and request_id = p_request_id;

  return jsonb_build_object('ok', true, 'transferred', true, 'worker_id', p_new_worker_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.handoff_preflight_device_lock_to_request(p_device_id uuid, p_preflight_request_id uuid, p_scheduler_request_id uuid, p_new_worker_id text, p_lease_seconds integer DEFAULT 900)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_transfer jsonb; begin v_transfer := public.auto_restart_transfer_device_lock(p_device_id, p_preflight_request_id, p_new_worker_id, p_lease_seconds); if coalesce((v_transfer->>'ok')::boolean, false) is not true then return v_transfer; end if; update public.auto_restart_device_locks set request_id = p_scheduler_request_id, owner_kind = 'scheduler', operation_phase = 'queued', reason = 'scheduler_run', updated_at = now() where device_id = p_device_id and request_id = p_preflight_request_id; return jsonb_build_object('ok', true, 'transferred', true, 'request_id', p_scheduler_request_id); end; $function$;

CREATE OR REPLACE FUNCTION public.reconcile_stale_device_ui_leases(p_grace_seconds integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now();
  v_cutoff timestamptz := v_now - make_interval(secs => greatest(p_grace_seconds, 0));
  v_row public.auto_restart_device_locks%rowtype;
  v_reconciled integer := 0;
  v_skipped_active integer := 0;
begin
  for v_row in
    select *
    from public.auto_restart_device_locks
    where lease_expires_at <= v_cutoff
    for update
  loop
    if v_row.request_id is not null and exists (
      select 1 from public.account_run_requests r
      where r.id = v_row.request_id
        and r.status in ('queued', 'claimed', 'starting', 'running')
    ) then
      v_skipped_active := v_skipped_active + 1;
      continue;
    end if;

    if v_row.run_id is not null and exists (
      select 1 from public.ig_runs g
      where g.id = v_row.run_id
        and g.status in ('running', 'pending', 'starting', 'queued', 'in_progress', 'active')
    ) then
      v_skipped_active := v_skipped_active + 1;
      continue;
    end if;

    perform public._device_ui_lease_audit(
      v_row.lease_id, v_row.device_id, 'stale_reconciled', v_row.owner_kind, v_row.worker_id,
      v_row.request_id, v_row.run_id, 'lease_expired'
    );
    delete from public.auto_restart_device_locks where device_id = v_row.device_id;
    v_reconciled := v_reconciled + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'reconciled', v_reconciled,
    'skipped_active', v_skipped_active
  );
end;
$function$;
