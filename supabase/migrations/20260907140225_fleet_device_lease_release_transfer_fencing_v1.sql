begin;
create function public.auto_restart_release_device_lock(
  p_device_id uuid,p_worker_id text,p_request_id uuid,p_expected_lease_id uuid,p_account_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.auto_restart_device_locks%rowtype; q public.account_run_requests%rowtype;
begin
  if p_device_id is null or nullif(p_worker_id,'') is null or p_request_id is null
    or p_expected_lease_id is null or p_account_id is null then
    raise exception 'device_lock_expected_identity_required' using errcode='22023';
  end if;
  select * into l from public.auto_restart_device_locks where device_id=p_device_id for update;
  select * into q from public.account_run_requests where id=p_request_id for share;
  if l.lease_id is distinct from p_expected_lease_id or l.request_id is distinct from p_request_id
    or l.account_id is distinct from p_account_id or l.worker_id is distinct from p_worker_id
    or q.account_id is distinct from p_account_id then
    return jsonb_build_object('ok',false,'released',false,'reason','device_lock_stale_or_misbound');
  end if;
  delete from public.auto_restart_device_locks where device_id=p_device_id and lease_id=p_expected_lease_id;
  perform public._device_ui_lease_audit(l.lease_id,l.device_id,'released',l.owner_kind,l.worker_id,l.request_id,l.run_id,'token_fenced_release');
  return jsonb_build_object('ok',true,'released',true,'device_id',l.device_id,'lease_id',l.lease_id,
    'generation',l.lease_id,'account_id',l.account_id,'request_id',l.request_id,'worker_id',l.worker_id);
end $$;
revoke all on function public.auto_restart_release_device_lock(uuid,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.auto_restart_release_device_lock(uuid,text,uuid,uuid,uuid) to service_role;

create function public.auto_restart_transfer_device_lock(
  p_device_id uuid,p_request_id uuid,p_new_worker_id text,p_previous_worker_id text,
  p_expected_lease_id uuid,p_account_id uuid,p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.auto_restart_device_locks%rowtype; q public.account_run_requests%rowtype; b jsonb;
begin
  if p_device_id is null or p_request_id is null or p_expected_lease_id is null or p_account_id is null
    or nullif(p_new_worker_id,'') is null or nullif(p_previous_worker_id,'') is null
    or p_lease_seconds is null or p_lease_seconds not between 60 and 3600 then
    raise exception 'device_lock_expected_identity_required' using errcode='22023';
  end if;
  select * into l from public.auto_restart_device_locks where device_id=p_device_id for update;
  select * into q from public.account_run_requests where id=p_request_id for update;
  if l.lease_id is distinct from p_expected_lease_id or l.request_id is distinct from p_request_id
    or l.account_id is distinct from p_account_id or l.worker_id is distinct from p_previous_worker_id
    or q.account_id is distinct from p_account_id or q.claimed_by is distinct from p_new_worker_id
    or q.status::text not in ('claimed','starting','running','cancel_requested') then
    return jsonb_build_object('ok',false,'transferred',false,'reason','device_lock_stale_or_misbound');
  end if;
  update public.auto_restart_device_locks set lease_id=gen_random_uuid(),worker_id=p_new_worker_id,
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    heartbeat_at=clock_timestamp(),updated_at=clock_timestamp()
    where device_id=p_device_id and lease_id=p_expected_lease_id returning * into l;
  b:=jsonb_build_object('lease_id',l.lease_id,'generation',l.lease_id,'device_id',l.device_id,
    'account_id',l.account_id,'request_id',l.request_id,'app_instance_id',l.app_instance_id,
    'worker_id',l.worker_id,'lease_seconds',p_lease_seconds,'lease_expires_at',l.lease_expires_at);
  update public.account_run_requests set metadata_safe=coalesce(metadata_safe,'{}'::jsonb)
    || jsonb_build_object('device_lock_binding',b) where id=q.id;
  perform public._device_ui_lease_audit(l.lease_id,l.device_id,'bind_request',l.owner_kind,l.worker_id,l.request_id,l.run_id,'token_fenced_transfer');
  return b||jsonb_build_object('ok',true,'transferred',true);
end $$;
revoke all on function public.auto_restart_transfer_device_lock(uuid,uuid,text,text,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.auto_restart_transfer_device_lock(uuid,uuid,text,text,uuid,uuid,integer) to service_role;

-- Phase A preserves the installed legacy overloads. Retirement is deferred.
commit;
