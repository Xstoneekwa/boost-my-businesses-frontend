begin;
-- Copy the installed canonical bodies, including their existing business/Fleet
-- guards. A missing anchor is a lineage failure, never a permissive fallback.
do $patch$
declare r record; source text; definition text; replacement text; anchor text;
  signature text; guard text; expected text; arguments text;
begin
  for r in select p.oid,p.proname,p.prosrc,oidvectortypes(p.proargtypes) as types
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (
      p.oid=to_regprocedure('public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamptz,timestamptz,integer)')
      or p.oid=to_regprocedure('public.certify_zero_work_and_enqueue_recovery_v1(uuid,uuid,text,integer)')
      or p.oid=to_regprocedure('public.begin_device_activity_v1(uuid,uuid,text)'))
  loop
    source:=r.prosrc;
    if r.proname='admit_account_run_attempt_v1' then
      anchor:='(select \* into v_lock from public\.auto_restart_device_locks\s+where device_id = p_device_id for update;)';
      guard:=$g$
      if p_expected_lease_id is null or v_lock.lease_id is distinct from p_expected_lease_id
        or v_lock.request_id is distinct from p_request_id or v_lock.worker_id is distinct from p_worker_id
        or v_lock.account_id is distinct from v_account_id then
        return jsonb_build_object('ok',false,'reason','device_lock_stale_or_misbound');
      end if;
      $g$;
      if source !~ anchor then raise exception 'admission_token_binding_lineage_mismatch'; end if;
      source:=regexp_replace(source,anchor,E'\\1'||guard);
    elsif r.proname='begin_device_activity_v1' then
      anchor:='(perform 1 from public\.auto_restart_device_locks where device_id = v_device_id for update;)';
      guard:=$g$
      if p_expected_lease_id is null or not exists (
        select 1 from public.auto_restart_device_locks l where l.device_id=v_device_id
          and l.lease_id=p_expected_lease_id and l.account_id=v_account_id
          and l.request_id=p_request_id and l.worker_id=p_worker_id
      ) then return jsonb_build_object('ok',false,'reason','device_lock_stale_or_misbound'); end if;
      $g$;
      if source !~ anchor then raise exception 'device_gate_token_binding_lineage_mismatch'; end if;
      source:=regexp_replace(source,anchor,E'\\1'||guard);
    else
      -- The existing retry key is not ownership evidence. Only the exact
      -- canonical audit receipt may recover a committed generation transition.
      anchor:='if v_existing_request_id is not null then[\s\S]*?end if;';
      replacement:=$g$if v_existing_request_id is not null then
        select e.metadata_safe->'result' into v_recovery_result
          from public.device_ui_lease_events e
          where e.device_id=v_device_id and e.request_id=v_existing_request_id
            and e.reason='token_fenced_recovery'
            and e.metadata_safe->'expected'=jsonb_build_object(
              'source_run_id',p_source_run_id,'source_request_id',p_source_request_id,
              'worker_id',p_worker_id,'lease_seconds',p_lease_seconds,'lease_id',p_expected_lease_id)
          order by e.created_at desc,e.id desc limit 1;
        if v_recovery_result is not null and v_lock.lease_id=(v_recovery_result->'device_lock_binding'->>'lease_id')::uuid
          and v_lock.request_id=v_existing_request_id and v_lock.account_id=v_account_id
          and v_lock.worker_id=p_worker_id then
          return v_recovery_result||jsonb_build_object('deduplicated',true);
        end if;
        return jsonb_build_object('ok',false,'reason','device_lock_recovery_replay_mismatch');
      end if;
      if p_expected_lease_id is null or v_lock.lease_id is distinct from p_expected_lease_id
        or v_lock.request_id is distinct from p_source_request_id
        or v_lock.account_id is distinct from v_account_id
        or v_lock.worker_id is distinct from p_worker_id
        or p_lease_seconds is null or p_lease_seconds not between 60 and 3600 then
        return jsonb_build_object('ok',false,'reason','device_lock_stale_or_misbound');
      end if;$g$;
      if source !~ anchor then raise exception 'recovery_replay_lineage_mismatch'; end if;
      source:=regexp_replace(source,anchor,replacement);
      source:=replace(source,'v_next_attempt smallint;', 'v_next_attempt smallint; v_recovery_result jsonb; v_binding jsonb;');
      anchor:='set worker_id=excluded.worker_id, account_id=excluded.account_id,';
      if position(anchor in source)=0 then raise exception 'recovery_generation_lineage_mismatch'; end if;
      source:=replace(source,anchor,'set lease_id=gen_random_uuid(), worker_id=excluded.worker_id, account_id=excluded.account_id,');
      anchor:='or public.auto_restart_device_locks.request_id = p_source_request_id;';
      if position(anchor in source)=0 then raise exception 'recovery_returning_lineage_mismatch'; end if;
      source:=replace(source,anchor,'or public.auto_restart_device_locks.request_id = p_source_request_id returning * into v_lock;');
      anchor:=$g$  return jsonb_build_object(
    'ok',true,'enqueued',true,'deduplicated',false,'request_id',v_new_request_id,
    'idempotency_key',v_key,'root_business_session_id',v_request.root_business_session_id,
    'execution_attempt_no',v_next_attempt,'retry_index',v_next_attempt-1
  );$g$;
      replacement:=$g$  v_binding:=jsonb_build_object('lease_id',v_lock.lease_id,'generation',v_lock.lease_id,
        'device_id',v_lock.device_id,'account_id',v_lock.account_id,'request_id',v_lock.request_id,
        'worker_id',v_lock.worker_id,'app_instance_id',v_lock.app_instance_id,
        'lease_seconds',p_lease_seconds,'lease_expires_at',v_lock.lease_expires_at);
      update public.account_run_requests set metadata_safe=coalesce(metadata_safe,'{}'::jsonb)
        ||jsonb_build_object('device_lock_binding',v_binding) where id=v_new_request_id;
      v_recovery_result:=jsonb_build_object('ok',true,'enqueued',true,'deduplicated',false,
        'request_id',v_new_request_id,'idempotency_key',v_key,
        'root_business_session_id',v_request.root_business_session_id,
        'execution_attempt_no',v_next_attempt,'retry_index',v_next_attempt-1,
        'device_lock_binding',v_binding);
      perform public._device_ui_lease_audit(v_lock.lease_id,v_lock.device_id,'bind_request',
        v_lock.owner_kind,v_lock.worker_id,v_lock.request_id,v_lock.run_id,'token_fenced_recovery',
        jsonb_build_object('expected',jsonb_build_object('source_run_id',p_source_run_id,
          'source_request_id',p_source_request_id,'worker_id',p_worker_id,
          'lease_seconds',p_lease_seconds,'lease_id',p_expected_lease_id),'result',v_recovery_result));
      return v_recovery_result;$g$;
      if position(anchor in source)=0 then raise exception 'recovery_result_lineage_mismatch'; end if;
      source:=replace(source,anchor,replacement);
    end if;
    definition:=pg_get_functiondef(r.oid);
    definition:=replace(definition,r.prosrc,source);
    -- No defaults on the tokenized overload: legacy named calls must resolve
    -- unambiguously to the historical signature. New Worker supplies all args.
    select string_agg(quote_ident(p.proargnames[i+1])||' '||format_type(p.proargtypes[i],NULL),', ' order by i)
      into arguments from pg_proc p, generate_series(0,p.pronargs-1) i where p.oid=r.oid;
    definition:=regexp_replace(definition,E'\\([^\n]*\\)\n RETURNS',
      '('||arguments||E', p_expected_lease_id uuid)\n RETURNS');
    if position('p_expected_lease_id uuid)' in definition)=0 then
      raise exception 'device_lock_fenced_signature_generation_failed';
    end if;
    execute definition;
    signature:='public.'||quote_ident(r.proname)||'('||r.types||',uuid)';
    execute 'revoke all on function '||signature||' from public,anon,authenticated';
    execute 'grant execute on function '||signature||' to service_role';
    -- Preserve the legacy body and signature during Phase A.
  end loop;
  if to_regprocedure('public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamptz,timestamptz,integer,uuid)') is null
    or to_regprocedure('public.certify_zero_work_and_enqueue_recovery_v1(uuid,uuid,text,integer,uuid)') is null
    or to_regprocedure('public.begin_device_activity_v1(uuid,uuid,text,uuid)') is null then
    raise exception 'canonical_device_lock_mutation_boundary_missing';
  end if;
end $patch$;

-- Legacy reconciliation remains callable in Phase A under service-only ACLs.
commit;
