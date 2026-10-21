begin;

-- Enrich the existing canonical audit event, without adding a second write or
-- a second source of ownership truth. Public callers must not forge receipts.
revoke all on function public._device_ui_lease_audit(uuid,uuid,text,text,text,uuid,uuid,text,jsonb)
  from public,anon,authenticated;

do $patch$
declare oid_release oid; oid_transfer oid; source text; definition text; needle text; replacement text;
begin
  oid_release:='public.auto_restart_release_device_lock(uuid,text,uuid,uuid,uuid)'::regprocedure;
  oid_transfer:='public.auto_restart_transfer_device_lock(uuid,uuid,text,text,uuid,uuid,integer)'::regprocedure;
  select prosrc into source from pg_proc where oid=oid_release;
  needle:='perform public._device_ui_lease_audit(l.lease_id,l.device_id,''released'',l.owner_kind,l.worker_id,l.request_id,l.run_id,''token_fenced_release'');';
  replacement:=$body$perform public._device_ui_lease_audit(l.lease_id,l.device_id,'released',l.owner_kind,l.worker_id,l.request_id,l.run_id,'token_fenced_release',
    jsonb_build_object('fleet_operation','release','expected',jsonb_build_object(
      'p_device_id',p_device_id,'p_worker_id',p_worker_id,'p_request_id',p_request_id,
      'p_expected_lease_id',p_expected_lease_id,'p_account_id',p_account_id),
      'result',jsonb_build_object('ok',true,'released',true,'device_id',l.device_id,
        'lease_id',l.lease_id,'generation',l.lease_id,'account_id',l.account_id,
        'request_id',l.request_id,'worker_id',l.worker_id)));$body$;
  if position(needle in source)=0 then raise exception 'release_receipt_lineage_mismatch'; end if;
  definition:=pg_get_functiondef(oid_release);
  execute replace(definition,source,replace(source,needle,replacement));

  select prosrc into source from pg_proc where oid=oid_transfer;
  needle:='perform public._device_ui_lease_audit(l.lease_id,l.device_id,''bind_request'',l.owner_kind,l.worker_id,l.request_id,l.run_id,''token_fenced_transfer'');';
  replacement:=$body$perform public._device_ui_lease_audit(l.lease_id,l.device_id,'bind_request',l.owner_kind,l.worker_id,l.request_id,l.run_id,'token_fenced_transfer',
    jsonb_build_object('fleet_operation','transfer','expected',jsonb_build_object(
      'p_device_id',p_device_id,'p_request_id',p_request_id,'p_new_worker_id',p_new_worker_id,
      'p_previous_worker_id',p_previous_worker_id,'p_expected_lease_id',p_expected_lease_id,
      'p_account_id',p_account_id,'p_lease_seconds',p_lease_seconds),
      'result',b||jsonb_build_object('ok',true,'transferred',true)));$body$;
  if position(needle in source)=0 then raise exception 'transfer_receipt_lineage_mismatch'; end if;
  definition:=pg_get_functiondef(oid_transfer);
  execute replace(definition,source,replace(source,needle,replacement));
end $patch$;

create function public.fleet_device_lock_operation_receipt_v1(p_operation text,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare expected jsonb; result jsonb; device uuid; account uuid; request uuid; token uuid;
begin
  if p_operation not in ('release','transfer') or jsonb_typeof(p_expected) is distinct from 'object' then
    raise exception 'device_lock_receipt_identity_required' using errcode='22023';
  end if;
  device:=(p_expected->>'p_device_id')::uuid;
  account:=(p_expected->>'p_account_id')::uuid;
  request:=(p_expected->>'p_request_id')::uuid;
  token:=(p_expected->>'p_expected_lease_id')::uuid;
  if device is null or account is null or request is null or token is null then
    raise exception 'device_lock_receipt_identity_required' using errcode='22023';
  end if;
  expected:=jsonb_build_object('p_device_id',device,'p_account_id',account,
    'p_request_id',request,'p_expected_lease_id',token);
  if p_operation='release' then
    if nullif(p_expected->>'p_worker_id','') is null then
      raise exception 'device_lock_receipt_identity_required' using errcode='22023';
    end if;
    expected:=expected||jsonb_build_object('p_worker_id',p_expected->>'p_worker_id');
  else
    if nullif(p_expected->>'p_previous_worker_id','') is null
      or nullif(p_expected->>'p_new_worker_id','') is null
      or jsonb_typeof(p_expected->'p_lease_seconds') is distinct from 'number'
      or (p_expected->>'p_lease_seconds')::integer not between 60 and 3600 then
      raise exception 'device_lock_receipt_identity_required' using errcode='22023';
    end if;
    expected:=expected||jsonb_build_object('p_previous_worker_id',p_expected->>'p_previous_worker_id',
      'p_new_worker_id',p_expected->>'p_new_worker_id','p_lease_seconds',(p_expected->>'p_lease_seconds')::integer);
  end if;
  if expected is distinct from p_expected then
    raise exception 'device_lock_receipt_identity_mismatch' using errcode='22023';
  end if;
  select e.metadata_safe->'result' into result
  from public.device_ui_lease_events e
  join public.account_run_requests q on q.id=e.request_id and q.account_id=account
  where e.device_id=device and e.request_id=request
    and e.reason='token_fenced_'||p_operation
    and e.metadata_safe->>'fleet_operation'=p_operation
    and e.metadata_safe->'expected'=expected
  order by e.created_at desc,e.id desc limit 1;
  if result is null then return jsonb_build_object('ok',false,'reason','device_lock_operation_not_proven'); end if;
  -- A transfer receipt cannot re-adopt a generation that has since been replaced.
  if p_operation='transfer' and not exists (
    select 1 from public.auto_restart_device_locks l
    where l.device_id=device and l.account_id=account and l.request_id=request
      and l.worker_id=p_expected->>'p_new_worker_id'
      and l.lease_id=(result->>'lease_id')::uuid
  ) then return jsonb_build_object('ok',false,'reason','device_lock_receipt_generation_stale'); end if;
  return result||jsonb_build_object('reconciled',true);
end $$;
revoke all on function public.fleet_device_lock_operation_receipt_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.fleet_device_lock_operation_receipt_v1(text,jsonb) to service_role;

commit;
