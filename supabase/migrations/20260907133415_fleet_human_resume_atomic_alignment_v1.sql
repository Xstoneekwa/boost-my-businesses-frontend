-- Human resume uses the canonical atomic enqueue, never a pre-request lease.
-- Consumption remains in the same SQL transaction as enqueue and lineage triggers.
begin;

create function public.fleet_lock_human_resume_v1(
  p_authorization_id uuid, p_worker_id text, p_device_id uuid,
  p_metadata jsonb, p_entry text
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $body$
declare
  v_before public.incident_resume_authorizations%rowtype;
  v_auth public.incident_resume_authorizations%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_plan public.account_session_resume_plans%rowtype;
  v_source uuid;
  v_request public.account_run_requests%rowtype;
  v_lock public.auto_restart_device_locks%rowtype;
  v_binding jsonb;
  v_inputs jsonb;
  v_input jsonb := jsonb_build_object('worker_id',p_worker_id,'device_id',p_device_id,'metadata',coalesce(p_metadata,'{}'::jsonb));
begin
  if p_entry not in ('v2','v3','v4') then
    raise exception 'resume_entry_invalid' using errcode='22023';
  end if;
  select * into v_before from public.incident_resume_authorizations where id=p_authorization_id;
  if v_before.id is null then
    raise exception 'resume_authorization_missing' using errcode='22023';
  end if;
  -- Matches atomic enqueue's account/assignment prefix, then device -> request
  -- -> authorization -> resume plan. No wrapper takes authorization first.
  perform 1 from public.ig_accounts where id=v_before.account_id for update;
  select * into v_assignment from public.account_assignments
    where account_id=v_before.account_id and status in ('active','reserved')
    order by created_at desc limit 1 for share;
  if v_assignment.device_id is null
     or p_device_id is distinct from v_assignment.device_id then
    raise exception 'resume_device_binding_mismatch' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fleet-device:' || v_assignment.device_id::text,0));
  select * into v_lock from public.auto_restart_device_locks
    where device_id=v_assignment.device_id for update;
  select run_request_id into v_source from public.account_session_resume_plans where id=v_before.resume_plan_id;
  perform 1 from public.account_run_requests
    where id in (v_source,v_before.consumed_by_request_id) order by id for share;
  select * into v_auth from public.incident_resume_authorizations where id=p_authorization_id for update;
  if v_auth.account_id is distinct from v_before.account_id
     or v_auth.resume_plan_id is distinct from v_before.resume_plan_id
     or v_auth.run_id is distinct from v_before.run_id
     or v_auth.consumed_by_request_id is distinct from v_before.consumed_by_request_id then
    -- A concurrent successful retry may have filled consumed_by_request_id.
    -- Its account lock serializes us, so refresh through a new transaction.
    raise exception 'resume_authority_changed_retry_required' using errcode='40001';
  end if;
  select * into v_plan from public.account_session_resume_plans where id=v_auth.resume_plan_id for update;
  if v_plan.run_request_id is distinct from v_source then
    raise exception 'resume_plan_changed_retry_required' using errcode='40001';
  end if;
  v_inputs := coalesce(v_auth.metadata_safe->'fleet_atomic_resume_inputs_v1','{}'::jsonb);
  if v_auth.status='consumed' then
    if v_inputs->p_entry is distinct from v_input then
      raise exception 'resume_idempotency_payload_conflict' using errcode='22023';
    end if;
    select * into v_request from public.account_run_requests where id=v_auth.consumed_by_request_id;
    v_binding := v_request.metadata_safe->'device_lock_binding';
    if v_request.id is null or v_request.account_id is distinct from v_auth.account_id
       or v_binding->>'request_id' is distinct from v_request.id::text
       or v_binding->>'account_id' is distinct from v_auth.account_id::text
       or v_binding->>'device_id' is distinct from p_device_id::text
       or nullif(v_binding->>'lease_id','') is null then
      raise exception 'resume_committed_binding_invalid' using errcode='22023';
    end if;
    if v_request.status in ('queued','claimed','starting','running','cancel_requested') and (
       v_lock.lease_id::text is distinct from v_binding->>'lease_id'
       or v_lock.request_id is distinct from v_request.id
       or v_lock.account_id is distinct from v_auth.account_id
       or v_lock.worker_id is distinct from v_binding->>'worker_id') then
      raise exception 'resume_committed_lease_no_longer_owned' using errcode='40001';
    end if;
    return jsonb_build_object('request_id',v_request.id,'authorization_id',v_auth.id,
      'retry_generation',v_auth.retry_generation,'idempotent',true,'device_lock_binding',v_binding);
  end if;
  update public.incident_resume_authorizations
    set metadata_safe=coalesce(metadata_safe,'{}'::jsonb)||jsonb_build_object(
      'fleet_atomic_resume_inputs_v1',v_inputs||jsonb_build_object(p_entry,v_input))
    where id=v_auth.id;
  return null;
end
$body$;
revoke all on function public.fleet_lock_human_resume_v1(uuid,text,uuid,jsonb,text)
  from public,anon,authenticated,service_role;

-- Preserve the actual canonical guard bodies; refuse unexpected lineage.
do $patch$
declare
  v_def text;
  v_new text;
  v_name text;
  v_version text;
  v_old text;
  v_entry_guard text;
  v_replay_code text;
begin
  foreach v_version in array array['v2','v3','v4'] loop
    v_name := 'consume_resume_authorization_and_create_request_'||v_version;
    select pg_get_functiondef(to_regprocedure('public.'||v_name||'(uuid,text,uuid,jsonb)')) into v_def;
    if v_def is null or position(E'\ndeclare\n' in v_def)=0
       or position(E'\nbegin\n' in v_def)=0 then
      raise exception 'human_resume_canonical_body_missing: %',v_name;
    end if;
    v_new := replace(v_def,E'\ndeclare\n',E'\ndeclare\n  v_fleet_replay jsonb;\n');
    v_replay_code := E'  v_fleet_replay := public.fleet_lock_human_resume_v1(p_authorization_id,p_worker_id,p_device_id,p_metadata_safe,'||quote_literal(v_version)||E');\n  if v_fleet_replay is not null then return v_fleet_replay; end if;\n';
    if v_version='v2' then
      v_new := replace(v_new,E'\nbegin\n',E'\nbegin\n'||v_replay_code);
    else
      -- Keep the original role guard authoritative and execute it first.
      v_entry_guard := $guard$  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
$guard$;
      if (length(v_new)-length(replace(v_new,v_entry_guard,'')))/length(v_entry_guard) <> 1 then
        raise exception 'human_resume_role_guard_lineage_mismatch: %',v_name;
      end if;
      v_new := replace(v_new,v_entry_guard,v_entry_guard||v_replay_code);
    end if;
    if v_version='v2' then
      v_old := $old$  if p_device_id is not null and not exists (
    select 1 from public.auto_restart_device_locks l
    where l.device_id = p_device_id
      and l.account_id = v_auth.account_id
      and l.worker_id = p_worker_id
      and l.lease_expires_at > now()
    for update
  ) then
    raise exception 'resume_device_lock_missing' using errcode = '40001';
  end if;
$old$;
      if position(v_old in v_new)=0 then raise exception 'human_resume_prelease_lineage_mismatch'; end if;
      v_new := replace(v_new,v_old,'');
      v_old := $old$  if p_device_id is not null then
    update public.auto_restart_device_locks
    set request_id = v_request.id, updated_at = now()
    where device_id = p_device_id and worker_id = p_worker_id;
  end if;
$old$;
      if position(v_old in v_new)=0 then raise exception 'human_resume_rebind_lineage_mismatch'; end if;
      v_new := replace(v_new,v_old,'');
      v_old := $old$    'idempotent', false
$old$;
      if position(v_old in v_new)=0 then raise exception 'human_resume_return_lineage_mismatch'; end if;
      v_new := replace(v_new,v_old,$new$    'idempotent', false,
    'device_lock_binding', v_request.metadata_safe -> 'device_lock_binding'
$new$);
    end if;
    execute v_new;
  end loop;
end
$patch$;
commit;
