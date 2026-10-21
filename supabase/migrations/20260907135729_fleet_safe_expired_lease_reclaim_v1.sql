-- Reuse canonical terminal/process-group evidence, not terminal status alone.
begin;
create function public.fleet_reclaim_expired_device_lease_v1(p_device_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  l public.auto_restart_device_locks%rowtype;
  q public.account_run_requests%rowtype;
  t public.fleet_terminal_receipts_v1%rowtype;
  b jsonb;
begin
  select * into l from public.auto_restart_device_locks where device_id=p_device_id for update;
  if not found then return false; end if;
  if l.lease_expires_at is null or l.lease_expires_at>clock_timestamp()
    or l.request_id is null or l.account_id is null then return false; end if;
  select * into q from public.account_run_requests where id=l.request_id for share;
  if not found or q.account_id is distinct from l.account_id
    or q.status::text not in ('completed','failed','canceled','expired')
    or q.run_id is null or q.claimed_by is distinct from l.worker_id then return false; end if;
  b:=q.metadata_safe->'device_lock_binding';
  if jsonb_typeof(b) is distinct from 'object'
    or b->>'lease_id' is distinct from l.lease_id::text
    or b->>'generation' is distinct from l.lease_id::text
    or b->>'device_id' is distinct from l.device_id::text
    or b->>'account_id' is distinct from l.account_id::text
    or b->>'request_id' is distinct from l.request_id::text
    or b->>'worker_id' is distinct from l.worker_id then return false; end if;
  perform 1 from public.ig_runs where id=q.run_id and account_id=q.account_id for share;
  if not found then return false; end if;
  -- This predicate already rejects retired/misbound owners, unresolved groups,
  -- missing evidence and live executions. No Fleet policy row is required here.
  for t in select * from public.fleet_terminal_receipts_v1
    where account_id=q.account_id and request_id=q.id and attempt_id=q.run_id
      and consumer_instance_id=q.claimed_by
  loop
    b:=jsonb_build_object('account_id',t.account_id,'request_id',t.request_id,
      'attempt_id',t.attempt_id,'consumer_instance_id',t.consumer_instance_id,
      'consumer_boot_id',t.consumer_boot_id);
    if public.fleet_terminal_receipt_valid_v1(b,t.cancellation_receipt) then
      delete from public.auto_restart_device_locks where device_id=l.device_id
        and lease_id=l.lease_id and account_id=l.account_id and request_id=l.request_id
        and worker_id=l.worker_id and lease_expires_at<=clock_timestamp();
      if not found then return false; end if;
      perform public._device_ui_lease_audit(l.lease_id,l.device_id,'stale_reconciled',
        l.owner_kind,l.worker_id,l.request_id,l.run_id,'canonical_process_group_quiescence');
      return true;
    end if;
  end loop;
  return false;
end $$;
revoke all on function public.fleet_reclaim_expired_device_lease_v1(uuid)
  from public,anon,authenticated,service_role;

do $patch$
declare d text; old_block text := $old$  if v_lock.device_id is not null then
    raise exception 'device_lock_held' using errcode = '22023';
  end if;$old$;
begin
  select pg_get_functiondef('public.create_account_run_request(uuid,uuid,text,text,text,text,integer,jsonb)'::regprocedure) into d;
  if (length(d)-length(replace(d,old_block,'')))/length(old_block) <> 1 then
    raise exception 'safe_reclaim_atomic_enqueue_lineage_mismatch';
  end if;
  execute replace(d,old_block,$new$  if v_lock.device_id is not null then
    if not public.fleet_reclaim_expired_device_lease_v1(v_lock.device_id) then
      raise exception 'device_lock_held' using errcode = '22023';
    end if;
  end if;$new$);
end $patch$;
commit;
