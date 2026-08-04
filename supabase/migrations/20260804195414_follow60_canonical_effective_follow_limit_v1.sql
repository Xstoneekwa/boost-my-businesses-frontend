-- Follow60 controls must use the same authoritative daily Follow ceiling as
-- the Worker: min(configured account day cap, effective package/warmup day
-- cap, package maximum). The caller cannot provide or raise this ceiling.

begin;

create or replace function public.resolve_authoritative_follow_day_limit_v1(
  p_account_id uuid,
  p_business_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_configured_day integer;
  v_effective_preview_day integer;
  v_package_day integer;
  v_effective_limit integer;
  v_current_business_date date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if p_account_id is null
     or p_business_date is null
     or p_business_date is distinct from v_current_business_date then
    return jsonb_build_object(
      'ok', false,
      'reason', 'canonical_follow_limit_unresolved',
      'business_date', p_business_date,
      'current_business_date', v_current_business_date
    );
  end if;

  select
    s.max_actions_per_day,
    nullif(aps.effective_caps_preview ->> 'follow_day', '')::integer,
    nullif(aps.package_caps ->> 'follow_day', '')::integer
  into
    v_configured_day,
    v_effective_preview_day,
    v_package_day
  from public.ig_account_settings s
  join public.account_package_summary aps on aps.account_id = s.account_id
  where s.account_id = p_account_id;

  if not found
     or coalesce(v_configured_day, 0) <= 0
     or coalesce(v_effective_preview_day, 0) <= 0
     or coalesce(v_package_day, 0) <= 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'canonical_follow_limit_unresolved',
      'configured_day', v_configured_day,
      'effective_preview_day', v_effective_preview_day,
      'package_day', v_package_day
    );
  end if;

  v_effective_limit := least(
    v_configured_day,
    v_effective_preview_day,
    v_package_day
  );

  if v_effective_limit <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'canonical_follow_limit_unresolved');
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', 'resolved',
    'account_id', p_account_id,
    'business_date', p_business_date,
    'effective_follow_day_limit', v_effective_limit,
    'configured_day', v_configured_day,
    'effective_preview_day', v_effective_preview_day,
    'package_day', v_package_day,
    'source', 'min(ig_account_settings.max_actions_per_day,account_package_summary.effective_caps_preview.follow_day,account_package_summary.package_caps.follow_day)'
  );
end;
$function$;

revoke all on function public.resolve_authoritative_follow_day_limit_v1(uuid, date)
  from public, anon, authenticated;
grant execute on function public.resolve_authoritative_follow_day_limit_v1(uuid, date)
  to service_role;

create or replace function public.create_or_rearm_follow_60s_canary_control_v1(
  p_account_id uuid,p_control_id uuid,p_expected_worker_sha text,
  p_baseline_follow_count integer,p_max_new_cycles integer,p_expires_at timestamptz,
  p_expected_username text,p_expected_package text,p_baseline jsonb,
  p_idempotency_key text,p_created_by text,p_source text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_existing public.follow_60s_canary_controls%rowtype;
  v_meta jsonb;
  v_count integer;
  v_limit_result jsonb;
  v_canonical_follow_limit integer;
  v_business_date date;
  v_requested_target integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_account_id is null or p_control_id is null
    or lower(btrim(coalesce(p_expected_worker_sha,''))) !~ '^[0-9a-f]{40}$'
    or coalesce(p_baseline_follow_count,-1) < 0 or p_max_new_cycles not between 1 and 50
    or p_expires_at <= now()
    or nullif(btrim(p_expected_username),'') is null or nullif(btrim(p_expected_package),'') is null
    or nullif(btrim(p_idempotency_key),'') is null or nullif(btrim(p_created_by),'') is null
    or nullif(btrim(p_source),'') is null or jsonb_typeof(p_baseline)<>'object'
    or p_baseline->>'account_id' <> p_account_id::text
    or p_baseline->>'package' <> p_expected_package
    or lower(btrim(coalesce(p_baseline->>'worker_sha',''))) <> lower(btrim(p_expected_worker_sha))
    or lower(btrim(coalesce(p_baseline->>'release_sha',''))) <> lower(btrim(p_expected_worker_sha))
    or nullif(btrim(p_baseline->>'captured_at'),'') is null
    or nullif(btrim(p_baseline->>'timezone'),'') is null
    or nullif(btrim(p_baseline->>'business_date'),'') is null
    or coalesce((p_baseline->>'warmup_ready')::boolean,false) is not true
  then raise exception 'canonical_control_incomplete' using errcode='22023'; end if;
  begin
    perform (p_baseline->>'captured_at')::timestamptz;
    v_business_date := (p_baseline->>'business_date')::date;
  exception when others then
    raise exception 'canonical_baseline_timestamp_invalid' using errcode='22023';
  end;

  perform pg_advisory_xact_lock(hashtextextended('follow60-control-constructor-v1',0));

  v_limit_result := public.resolve_authoritative_follow_day_limit_v1(
    p_account_id,
    v_business_date
  );
  if coalesce((v_limit_result->>'ok')::boolean, false) is not true then
    raise exception 'canonical_follow_limit_unresolved' using errcode='22023';
  end if;
  v_canonical_follow_limit := nullif(v_limit_result->>'effective_follow_day_limit','')::integer;
  v_requested_target := p_baseline_follow_count + p_max_new_cycles;
  if coalesce(v_canonical_follow_limit, 0) <= 0 then
    raise exception 'canonical_follow_limit_unresolved' using errcode='22023';
  end if;
  if v_requested_target <= p_baseline_follow_count
     or v_requested_target > v_canonical_follow_limit then
    raise exception 'canonical_follow_limit_exceeded' using errcode='22023';
  end if;

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
    'baseline_business_date',v_business_date,'baseline_timezone',p_baseline->>'timezone',
    'baseline_package',p_expected_package,
    'baseline_warmup_ready',true,'baseline',p_baseline,'expected_package',p_expected_package,
    'expected_run_type','account_session','binding_version','FOLLOW_60S_CANARY_BINDING_V2',
    'idempotency_key',p_idempotency_key,'created_by',p_created_by,'source',p_source,
    'armed_at',now(),'expires_at',p_expires_at,'max_new_cycles',p_max_new_cycles,
    'current_new_cycle_count',0,'active_control_count',1,'runtime_binding_consumed',false,
    'canonical_follow_limit',v_canonical_follow_limit,
    'canonical_follow_limit_source',v_limit_result->>'source'
  );
  insert into public.follow_60s_canary_controls(
    account_id,status,baseline_follow_count,evaluation_increment,target_follow_count,
    run_id,request_id,barrier_reached_at,hold_armed_at,released_at,metadata_safe,updated_at
  ) values (
    p_account_id,'armed',p_baseline_follow_count,p_max_new_cycles,
    v_requested_target,null,null,null,null,null,v_meta,now()
  ) on conflict(account_id) do update set
    status='armed',baseline_follow_count=excluded.baseline_follow_count,
    evaluation_increment=excluded.evaluation_increment,target_follow_count=excluded.target_follow_count,
    run_id=null,request_id=null,barrier_reached_at=null,hold_armed_at=null,released_at=null,
    metadata_safe=excluded.metadata_safe,updated_at=now();
  return jsonb_build_object('ok',true,'idempotent_replay',false,'control_id',p_control_id,
    'account_id',p_account_id,'status','armed','barrier_target',v_requested_target,
    'canonical_follow_limit',v_canonical_follow_limit);
end;
$$;

revoke all on function public.create_or_rearm_follow_60s_canary_control_v1(uuid,uuid,text,integer,integer,timestamptz,text,text,jsonb,text,text,text)
  from public,anon,authenticated;
grant execute on function public.create_or_rearm_follow_60s_canary_control_v1(uuid,uuid,text,integer,integer,timestamptz,text,text,jsonb,text,text,text)
  to service_role;

comment on function public.resolve_authoritative_follow_day_limit_v1(uuid, date) is
  'Server-side Follow day limit resolver matching Worker runtime inputs. Caller-provided caps are ignored.';
comment on function public.create_or_rearm_follow_60s_canary_control_v1(uuid,uuid,text,integer,integer,timestamptz,text,text,jsonb,text,text,text) is
  'Atomic Follow60 control constructor bounded by the authoritative per-account effective Follow day limit.';

commit;
