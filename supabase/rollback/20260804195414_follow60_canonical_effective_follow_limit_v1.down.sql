begin;

drop function if exists public.resolve_authoritative_follow_day_limit_v1(uuid, date);

create or replace function public.create_or_rearm_follow_60s_canary_control_v1(
  p_account_id uuid,p_control_id uuid,p_expected_worker_sha text,
  p_baseline_follow_count integer,p_max_new_cycles integer,p_expires_at timestamptz,
  p_expected_username text,p_expected_package text,p_baseline jsonb,
  p_idempotency_key text,p_created_by text,p_source text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_existing public.follow_60s_canary_controls%rowtype; v_meta jsonb; v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_account_id is null or p_control_id is null
    or lower(btrim(coalesce(p_expected_worker_sha,''))) !~ '^[0-9a-f]{40}$'
    or coalesce(p_baseline_follow_count,-1) < 0 or p_max_new_cycles not between 1 and 50
    or p_baseline_follow_count+p_max_new_cycles > 50 or p_expires_at <= now()
    or nullif(btrim(p_expected_username),'') is null or nullif(btrim(p_expected_package),'') is null
    or nullif(btrim(p_idempotency_key),'') is null or nullif(btrim(p_created_by),'') is null
    or nullif(btrim(p_source),'') is null or jsonb_typeof(p_baseline)<>'object'
    or p_baseline->>'account_id' <> p_account_id::text
    or p_baseline->>'package' <> p_expected_package
    or nullif(btrim(p_baseline->>'captured_at'),'') is null
    or nullif(btrim(p_baseline->>'timezone'),'') is null
    or coalesce((p_baseline->>'warmup_ready')::boolean,false) is not true
  then raise exception 'canonical_control_incomplete' using errcode='22023'; end if;
  begin
    perform (p_baseline->>'captured_at')::timestamptz;
  exception when others then
    raise exception 'canonical_baseline_timestamp_invalid' using errcode='22023';
  end;
  perform pg_advisory_xact_lock(hashtextextended('follow60-control-constructor-v1',0));
  select * into v_existing from public.follow_60s_canary_controls where account_id=p_account_id for update;
  if found and v_existing.metadata_safe->>'idempotency_key'=p_idempotency_key
    and v_existing.metadata_safe->>'control_id'=p_control_id::text then
    return to_jsonb(v_existing)||jsonb_build_object('ok',true,'idempotent_replay',true);
  end if;
  if found and v_existing.status in (
    'running','barrier_waiting_stop','waiting_operator_evaluation','continuation_authorized'
  ) then
    raise exception 'same_account_active_control_collision' using errcode='P0001';
  end if;
  if found then
    insert into public.follow_60s_canary_control_history(
      account_id,control_id,status,archived_reason,control_snapshot,archived_by
    ) values (
      p_account_id,nullif(v_existing.metadata_safe->>'control_id','')::uuid,
      v_existing.status,'superseded_by_canonical_rearm',to_jsonb(v_existing),p_created_by
    );
  end if;
  select count(*)::integer into v_count from public.follow_60s_canary_controls
   where status in ('armed','running','barrier_waiting_stop','waiting_operator_evaluation','continuation_authorized')
     and account_id<>p_account_id;
  if v_count <> 0 then raise exception 'active_control_collision' using errcode='P0001'; end if;
  v_meta := jsonb_build_object(
    'schema','FOLLOW_60S_CANARY_CONTROL_V3','control_id',p_control_id,
    'account_id',p_account_id,'expected_username',lower(ltrim(btrim(p_expected_username),'@')),
    'expected_worker_sha',lower(btrim(p_expected_worker_sha)),
    'baseline_release_sha',lower(btrim(p_expected_worker_sha)),
    'baseline_account_id',p_account_id,'baseline_captured_at',p_baseline->>'captured_at',
    'baseline_timezone',p_baseline->>'timezone','baseline_package',p_expected_package,
    'baseline_warmup_ready',true,'baseline',p_baseline,'expected_package',p_expected_package,
    'expected_run_type','account_session','binding_version','FOLLOW_60S_CANARY_BINDING_V2',
    'idempotency_key',p_idempotency_key,'created_by',p_created_by,'source',p_source,
    'armed_at',now(),'expires_at',p_expires_at,'max_new_cycles',p_max_new_cycles,
    'current_new_cycle_count',0,'active_control_count',1,'runtime_binding_consumed',false
  );
  insert into public.follow_60s_canary_controls(
    account_id,status,baseline_follow_count,evaluation_increment,target_follow_count,
    run_id,request_id,barrier_reached_at,hold_armed_at,released_at,metadata_safe,updated_at
  ) values (
    p_account_id,'armed',p_baseline_follow_count,p_max_new_cycles,
    p_baseline_follow_count+p_max_new_cycles,null,null,null,null,null,v_meta,now()
  ) on conflict(account_id) do update set
    status='armed',baseline_follow_count=excluded.baseline_follow_count,
    evaluation_increment=excluded.evaluation_increment,target_follow_count=excluded.target_follow_count,
    run_id=null,request_id=null,barrier_reached_at=null,hold_armed_at=null,released_at=null,
    metadata_safe=excluded.metadata_safe,updated_at=now();
  return jsonb_build_object('ok',true,'idempotent_replay',false,'control_id',p_control_id,
    'account_id',p_account_id,'status','armed','barrier_target',p_baseline_follow_count+p_max_new_cycles);
end;
$$;

revoke all on function public.create_or_rearm_follow_60s_canary_control_v1(uuid,uuid,text,integer,integer,timestamptz,text,text,jsonb,text,text,text)
  from public,anon,authenticated;
grant execute on function public.create_or_rearm_follow_60s_canary_control_v1(uuid,uuid,text,integer,integer,timestamptz,text,text,jsonb,text,text,text)
  to service_role;

commit;
