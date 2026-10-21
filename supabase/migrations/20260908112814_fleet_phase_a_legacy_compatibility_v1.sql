-- Phase A compatibility only. Tokenized bodies are not modified.
-- Historical service-only APIs retain their names and argument contracts.
-- Add bounded identity checks where coexistence would otherwise rebind a new owner.
begin;
CREATE OR REPLACE FUNCTION public.auto_restart_acquire_device_lock(p_device_id uuid, p_worker_id text, p_account_id uuid, p_app_instance_id uuid, p_lease_seconds integer DEFAULT 900, p_reason text DEFAULT 'auto_restart'::text, p_owner_kind text DEFAULT 'worker'::text, p_operation_phase text DEFAULT 'executing'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => greatest(p_lease_seconds, 30));
  v_existing public.auto_restart_device_locks%rowtype;
  v_lease_id uuid;
begin

  if pg_catalog.current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fleet-device:'||p_device_id::text,0));
  select * into v_existing from public.auto_restart_device_locks where device_id=p_device_id for update;
  if found then
    if exists(select 1 from public.account_run_requests q where q.id=v_existing.request_id
        and q.metadata_safe ? 'device_lock_binding'
        and not (q.metadata_safe->'device_lock_binding'->>'phase_a_legacy_generation' is not distinct from v_existing.lease_id::text
          and not exists(select 1 from public.fleet_runtime_owners_v1 o where o.request_id=q.id)))
        and v_existing.lease_expires_at<=v_now then
      if not public.fleet_reclaim_expired_device_lease_v1(p_device_id) then
        return jsonb_build_object('ok',false,'acquired',false,'reason','device_lock_held');
      end if;
    end if;
  end if;
  delete from public.auto_restart_device_locks as device_lock
  where device_lock.device_id = p_device_id
    and device_lock.lease_expires_at <= v_now
    and not exists(select 1 from public.ig_runs g where g.id=device_lock.run_id
      and g.status in ('running','pending','starting','queued','in_progress','active'))
    and (
      device_lock.request_id is null
      or not exists (
        select 1
        from public.account_run_requests as bound_request
        where bound_request.id = device_lock.request_id
          and bound_request.status in ('queued', 'claimed', 'starting', 'running', 'cancel_requested')
      )
    );

  select * into v_existing
  from public.auto_restart_device_locks
  where device_id = p_device_id
  for update;

  if found then
    if v_existing.account_id is distinct from p_account_id
      or v_existing.app_instance_id is distinct from p_app_instance_id then
      return jsonb_build_object('ok',false,'acquired',false,'reason','device_lock_binding_mismatch');
    end if;
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
revoke all on function public.auto_restart_acquire_device_lock(uuid,text,uuid,uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.auto_restart_acquire_device_lock(uuid,text,uuid,uuid,integer,text,text,text) to service_role;

CREATE OR REPLACE FUNCTION public.auto_restart_bind_device_lock_to_request(p_device_id uuid, p_worker_id text, p_request_id uuid, p_lease_seconds integer DEFAULT 900)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => greatest(p_lease_seconds, 30));
  v_row public.auto_restart_device_locks%rowtype;
begin

  if pg_catalog.current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  select * into v_row
  from public.auto_restart_device_locks
  where device_id = p_device_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'bound', false, 'reason', 'device_lock_missing');
  end if;

  if v_row.worker_id is distinct from p_worker_id then
    return jsonb_build_object(
      'ok', false,
      'bound', false,
      'reason', 'device_lock_owner_mismatch',
      'holder_worker_id', v_row.worker_id
    );
  end if;

  if p_request_id is null or
    (v_row.request_id is not null and v_row.request_id is distinct from p_request_id)
    or not exists(select 1 from public.account_run_requests q where q.id=p_request_id
       and q.account_id=v_row.account_id and q.status in ('queued','claimed','starting','running','cancel_requested')) then
    return jsonb_build_object('ok',false,'bound',false,'reason','device_lock_rebind_forbidden');
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
revoke all on function public.auto_restart_bind_device_lock_to_request(uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.auto_restart_bind_device_lock_to_request(uuid,text,uuid,integer) to service_role;

CREATE OR REPLACE FUNCTION public.auto_restart_release_device_lock(p_device_id uuid, p_worker_id text, p_request_id uuid DEFAULT NULL::uuid, p_release_reason text DEFAULT 'terminal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_deleted integer;
  v_row public.auto_restart_device_locks%rowtype;
begin

  if pg_catalog.current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  select * into v_row
  from public.auto_restart_device_locks
  where device_id = p_device_id
    and worker_id = p_worker_id
    and ((p_request_id is null and request_id is null) or request_id = p_request_id)
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
    and ((p_request_id is null and request_id is null) or request_id = p_request_id);
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'released', v_deleted > 0, 'lease_id', v_row.lease_id);
end;
$function$;
revoke all on function public.auto_restart_release_device_lock(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.auto_restart_release_device_lock(uuid,text,uuid,text) to service_role;

CREATE OR REPLACE FUNCTION public.auto_restart_renew_device_lock(p_device_id uuid, p_worker_id text, p_request_id uuid, p_lease_seconds integer DEFAULT 900)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => greatest(p_lease_seconds, 30));
  v_row public.auto_restart_device_locks%rowtype;
begin

  if pg_catalog.current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
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

  if v_row.worker_id is distinct from p_worker_id then
    return jsonb_build_object('ok', false, 'renewed', false, 'reason', 'device_lock_owner_mismatch');
  end if;

  if p_request_id is null or (v_row.request_id is not null and v_row.request_id is distinct from p_request_id) then
    return jsonb_build_object('ok', false, 'renewed', false, 'reason', 'device_lock_request_mismatch');
  end if;

  if not exists(select 1 from public.account_run_requests q where q.id=p_request_id
      and q.account_id=v_row.account_id and q.status in ('queued','claimed','starting','running','cancel_requested')) then
    return jsonb_build_object('ok',false,'renewed',false,'reason','device_lock_request_mismatch');
  end if;
  update public.auto_restart_device_locks
  set lease_expires_at = v_expires,
      request_id = coalesce(request_id, p_request_id),
      updated_at = v_now
  where device_id = p_device_id;

  return jsonb_build_object('ok', true, 'renewed', true);
end;
$function$;
revoke all on function public.auto_restart_renew_device_lock(uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.auto_restart_renew_device_lock(uuid,text,uuid,integer) to service_role;

CREATE OR REPLACE FUNCTION public.auto_restart_transfer_device_lock(p_device_id uuid, p_request_id uuid, p_new_worker_id text, p_lease_seconds integer DEFAULT 900)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => greatest(p_lease_seconds, 30));
  v_row public.auto_restart_device_locks%rowtype;
begin

  if pg_catalog.current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  select * into v_row
  from public.auto_restart_device_locks
  where device_id = p_device_id
    and request_id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'transferred', false, 'reason', 'device_lock_missing');
  end if;

  if not exists(select 1 from public.account_run_requests q where q.id=p_request_id
      and q.account_id=v_row.account_id and q.claimed_by=p_new_worker_id
      and q.status in ('claimed','starting','running','cancel_requested')) then
    return jsonb_build_object('ok',false,'transferred',false,'reason','device_lock_claim_mismatch');
  end if;
  update public.auto_restart_device_locks
  set worker_id = p_new_worker_id,
      lease_id = gen_random_uuid(),
      lease_expires_at = v_expires,
      updated_at = v_now
  where device_id = p_device_id
    and request_id = p_request_id
  returning * into v_row;

  -- Taking ownership through the legacy contract fences any previously issued
  -- new token. Record server-derived provenance for this exact generation only.
  update public.account_run_requests q set metadata_safe=jsonb_set(q.metadata_safe,
    '{device_lock_binding}',(q.metadata_safe->'device_lock_binding')||jsonb_build_object(
      'lease_id',v_row.lease_id,'generation',v_row.lease_id,'worker_id',p_new_worker_id,
      'lease_expires_at',v_expires,'phase_a_legacy_generation',v_row.lease_id))
    where q.id=p_request_id and q.metadata_safe ? 'device_lock_binding';

  return jsonb_build_object('ok', true, 'transferred', true, 'worker_id', p_new_worker_id);
end;
$function$;
revoke all on function public.auto_restart_transfer_device_lock(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.auto_restart_transfer_device_lock(uuid,uuid,text,integer) to service_role;

CREATE OR REPLACE FUNCTION public.handoff_preflight_device_lock_to_request(p_device_id uuid, p_preflight_request_id uuid, p_scheduler_request_id uuid, p_new_worker_id text, p_lease_seconds integer DEFAULT 900)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare l public.auto_restart_device_locks%rowtype; q public.account_run_requests%rowtype;
begin
  if pg_catalog.current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  select * into l from public.auto_restart_device_locks where device_id=p_device_id for update;
  perform 1 from public.account_run_requests where id in (p_preflight_request_id,p_scheduler_request_id) order by id for update;
  select * into q from public.account_run_requests where id=p_scheduler_request_id;
  if l.request_id is distinct from p_preflight_request_id or q.account_id is distinct from l.account_id
    or q.id is null or q.status not in ('queued','claimed') or nullif(p_new_worker_id,'') is null
    or coalesce(q.metadata_safe,'{}'::jsonb) ? 'device_lock_binding'
    or not exists(select 1 from public.account_run_requests old where old.id=l.request_id
       and old.account_id=l.account_id and old.status in ('completed','failed','canceled','expired')
       and not (coalesce(old.metadata_safe,'{}'::jsonb) ? 'device_lock_binding')) then
    return jsonb_build_object('ok',false,'transferred',false,'reason','legacy_handoff_identity_mismatch');
  end if;
  -- Explicit legacy succession, never an arbitrary bind or tokenized-owner rewrite.
  update public.auto_restart_device_locks set request_id=p_scheduler_request_id,
    worker_id=p_new_worker_id,owner_kind='scheduler',operation_phase='queued',reason='scheduler_run',
    lease_expires_at=clock_timestamp()+make_interval(secs=>greatest(p_lease_seconds,30)),updated_at=clock_timestamp()
    where device_id=p_device_id and lease_id=l.lease_id and request_id=p_preflight_request_id;
  return jsonb_build_object('ok',true,'transferred',true,'request_id',p_scheduler_request_id);
end;
$function$;
revoke all on function public.handoff_preflight_device_lock_to_request(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.handoff_preflight_device_lock_to_request(uuid,uuid,uuid,text,integer) to service_role;

CREATE OR REPLACE FUNCTION public.reconcile_stale_device_ui_leases(p_grace_seconds integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz := now();
  v_cutoff timestamptz := v_now - make_interval(secs => greatest(p_grace_seconds, 0));
  v_row public.auto_restart_device_locks%rowtype;
  v_reconciled integer := 0;
  v_skipped_active integer := 0;
begin

  if pg_catalog.current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  for v_row in
    select *
    from public.auto_restart_device_locks
    where lease_expires_at <= v_cutoff
    for update
  loop
    if exists(select 1 from public.account_run_requests q where q.id=v_row.request_id
        and q.metadata_safe ? 'device_lock_binding'
        and not (q.metadata_safe->'device_lock_binding'->>'phase_a_legacy_generation' is not distinct from v_row.lease_id::text
          and not exists(select 1 from public.fleet_runtime_owners_v1 o where o.request_id=q.id))) then
      if public.fleet_reclaim_expired_device_lease_v1(v_row.device_id) then
        v_reconciled:=v_reconciled+1;
      else v_skipped_active:=v_skipped_active+1;
      end if;
      continue;
    end if;
    if v_row.request_id is not null and exists (
      select 1 from public.account_run_requests r
      where r.id = v_row.request_id
        and r.status in ('queued', 'claimed', 'starting', 'running', 'cancel_requested')
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
revoke all on function public.reconcile_stale_device_ui_leases(integer) from public,anon,authenticated;
grant execute on function public.reconcile_stale_device_ui_leases(integer) to service_role;

commit;
