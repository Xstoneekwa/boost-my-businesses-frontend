-- Follow60 transactional activation, canonical control lifecycle, and generic
-- terminal ig_runs reconciliation. Additive/source-first: this migration does
-- not arm a control, create a request, start a run, or touch a device.

alter table public.follow_60s_canary_controls
  drop constraint if exists follow_60s_canary_controls_status_check;
alter table public.follow_60s_canary_controls
  add constraint follow_60s_canary_controls_status_check check (
    status in (
      'disabled','armed','running','activation_failed','barrier_waiting_stop',
      'waiting_operator_evaluation','continuation_authorized','completed',
      'canceled','expired','archived'
    )
  );

create table if not exists public.follow_60s_canary_control_history (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  control_id uuid,
  status text not null,
  archived_reason text not null,
  control_snapshot jsonb not null,
  archived_at timestamptz not null default now(),
  archived_by text not null,
  constraint follow_60s_control_history_snapshot_object
    check (jsonb_typeof(control_snapshot) = 'object')
);
alter table public.follow_60s_canary_control_history enable row level security;
revoke all on table public.follow_60s_canary_control_history from public, anon, authenticated;
grant select, insert on table public.follow_60s_canary_control_history to service_role;

create or replace function public.prepare_follow_60s_canary_runtime_v3(
  p_control_id uuid,
  p_account_id uuid,
  p_expected_worker_sha text,
  p_baseline_release_sha text,
  p_run_request_id uuid,
  p_run_id uuid,
  p_attempt_id integer,
  p_business_session_id text,
  p_binding_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control public.follow_60s_canary_controls%rowtype;
  v_metadata jsonb;
  v_baseline jsonb;
  v_active_count integer;
  v_max integer;
  v_current integer;
  v_expected_sha text := lower(btrim(coalesce(p_expected_worker_sha,'')));
  v_baseline_sha text := lower(btrim(coalesce(p_baseline_release_sha,'')));
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  if p_control_id is null or p_account_id is null or p_run_request_id is null
    or p_run_id is null or coalesce(p_attempt_id,0) < 1
    or nullif(btrim(p_business_session_id),'') is null
    or p_binding_version <> 'FOLLOW_60S_CANARY_BINDING_V2' then
    raise exception 'follow60_prepare_input_invalid' using errcode='22023';
  end if;
  if v_expected_sha !~ '^[0-9a-f]{40}$' or v_baseline_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'worker_sha_mismatch' using errcode='P0001';
  end if;
  perform 1 from public.ig_runs r
   where r.id=p_run_id and r.account_id=p_account_id;
  if not found then raise exception 'run_mismatch' using errcode='P0001'; end if;
  perform 1 from public.account_run_requests q
   where q.id=p_run_request_id and q.account_id=p_account_id and q.run_id=p_run_id
     and coalesce(q.requested_run_type,'')='account_session';
  if not found then raise exception 'request_mismatch' using errcode='P0001'; end if;

  select * into v_control from public.follow_60s_canary_controls c
   where c.account_id=p_account_id
     and c.metadata_safe->>'control_id'=p_control_id::text;
  if not found then raise exception 'control_not_found' using errcode='P0001'; end if;
  if v_control.status <> 'armed' then raise exception 'control_not_armed' using errcode='P0001'; end if;
  v_metadata := coalesce(v_control.metadata_safe,'{}'::jsonb);
  v_baseline := case when jsonb_typeof(v_metadata->'baseline')='object'
    then v_metadata->'baseline' else '{}'::jsonb end;

  if nullif(btrim(v_metadata->>'idempotency_key'),'') is null
    or nullif(btrim(v_metadata->>'created_by'),'') is null
    or nullif(btrim(v_metadata->>'source'),'') is null
    or nullif(btrim(v_metadata->>'armed_at'),'') is null
    or nullif(btrim(v_metadata->>'expires_at'),'') is null
    or nullif(btrim(v_metadata->>'baseline_captured_at'),'') is null
    or nullif(btrim(v_metadata->>'baseline_timezone'),'') is null
    or nullif(btrim(v_metadata->>'baseline_package'),'') is null
    or nullif(btrim(v_metadata->>'expected_package'),'') is null
    or nullif(btrim(v_metadata->>'baseline_account_id'),'') is null
    or nullif(btrim(v_metadata->>'expected_worker_sha'),'') is null
    or nullif(btrim(v_metadata->>'baseline_release_sha'),'') is null
    or coalesce((v_metadata->>'active_control_count')::integer,0) <> 1
    or coalesce((v_metadata->>'baseline_warmup_ready')::boolean,false) is not true
  then raise exception 'control_incomplete' using errcode='P0001'; end if;
  if (v_metadata->>'expires_at')::timestamptz <= now() then
    raise exception 'control_expired' using errcode='P0001';
  end if;
  if lower(v_metadata->>'expected_worker_sha') <> v_expected_sha
    or lower(v_metadata->>'baseline_release_sha') <> v_baseline_sha
    or v_baseline_sha <> v_expected_sha
    or v_metadata->>'baseline_account_id' <> p_account_id::text
    or v_metadata->>'baseline_package' <> v_metadata->>'expected_package'
    or v_metadata->>'binding_version' <> p_binding_version
  then raise exception 'control_binding_contract_mismatch' using errcode='P0001'; end if;
  if coalesce((v_metadata->>'runtime_binding_consumed')::boolean,false) then
    raise exception 'binding_already_consumed' using errcode='P0001';
  end if;
  select count(*)::integer into v_active_count
    from public.follow_60s_canary_controls
    where status in (
      'armed','running','barrier_waiting_stop',
      'waiting_operator_evaluation','continuation_authorized'
    );
  if v_active_count <> 1 then raise exception 'active_control_collision' using errcode='P0001'; end if;
  v_max := coalesce(nullif(v_metadata->>'max_new_cycles','')::integer,v_control.evaluation_increment);
  v_current := coalesce(nullif(v_metadata->>'current_new_cycle_count','')::integer,0);
  if v_max < 1 or v_max > 50 or v_current < 0 or v_current >= v_max
    or v_control.baseline_follow_count + v_max <> v_control.target_follow_count then
    raise exception 'max_cycles_reached' using errcode='P0001';
  end if;

  return jsonb_build_object(
    'ok',true,'prepared',true,'binding_valid',true,
    'runtime_binding_consumed',false,'control_id',p_control_id,
    'account_id',p_account_id,'expected_username',coalesce(v_metadata->>'expected_username',''),
    'expected_worker_sha',v_expected_sha,'baseline_release_sha',v_baseline_sha,
    'baseline_account_id',p_account_id,'baseline_captured_at',v_metadata->>'baseline_captured_at',
    'baseline_timezone',v_metadata->>'baseline_timezone','baseline_package',v_metadata->>'baseline_package',
    'baseline_warmup_ready',true,'baseline_follow_count',v_control.baseline_follow_count,
    'max_new_cycles',v_max,'current_new_cycle_count',v_current,'status','armed',
    'armed_at',v_metadata->>'armed_at','expires_at',v_metadata->>'expires_at',
    'business_session_id',btrim(p_business_session_id),'expected_package',v_metadata->>'expected_package',
    'expected_run_type','account_session','binding_version',p_binding_version,
    'idempotency_key',v_metadata->>'idempotency_key','created_by',v_metadata->>'created_by',
    'source',v_metadata->>'source','active_control_count',v_active_count,
    'run_id',p_run_id,'request_id',p_run_request_id,'attempt_id',p_attempt_id,
    'evaluation_increment',v_control.evaluation_increment,'target_follow_count',v_control.target_follow_count
  );
end;
$$;

create or replace function public.commit_follow_60s_canary_runtime_v3(
  p_control_id uuid,p_account_id uuid,p_expected_worker_sha text,
  p_baseline_release_sha text,p_run_request_id uuid,p_run_id uuid,
  p_attempt_id integer,p_business_session_id text,p_binding_version text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_prepared jsonb; v_updated public.follow_60s_canary_controls%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('follow60-activation-v3',0));
  v_prepared := public.prepare_follow_60s_canary_runtime_v3(
    p_control_id,p_account_id,p_expected_worker_sha,p_baseline_release_sha,
    p_run_request_id,p_run_id,p_attempt_id,p_business_session_id,p_binding_version
  );
  update public.follow_60s_canary_controls c set
    status='running',run_id=p_run_id,request_id=p_run_request_id,
    metadata_safe=coalesce(c.metadata_safe,'{}'::jsonb)||jsonb_build_object(
      'runtime_binding_schema','FOLLOW_60S_RUNTIME_BINDING_V3',
      'runtime_binding_consumed',true,'attempt_id',p_attempt_id,
      'business_session_id',btrim(p_business_session_id),'bound_at',now(),
      'phase_plan_source','follow60_armed_control'
    ),updated_at=now()
   where c.account_id=p_account_id and c.status='armed'
     and c.metadata_safe->>'control_id'=p_control_id::text
   returning * into v_updated;
  if not found then raise exception 'activation_commit_conflict' using errcode='P0001'; end if;
  return v_prepared || jsonb_build_object(
    'committed',true,'status','running','runtime_binding_consumed',true
  );
end;
$$;

create or replace function public.terminalize_follow_60s_canary_control_v1(
  p_control_id uuid,p_account_id uuid,p_run_id uuid,p_request_id uuid,
  p_status text,p_reason text,p_metadata_safe jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.follow_60s_canary_controls%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_status not in ('activation_failed','waiting_operator_evaluation','completed','canceled','expired','archived')
    or nullif(btrim(p_reason),'') is null then
    raise exception 'terminal_status_invalid' using errcode='22023';
  end if;
  update public.follow_60s_canary_controls c set status=p_status,
    released_at=case when p_status in ('completed','canceled','expired','archived','activation_failed') then now() else c.released_at end,
    hold_armed_at=case when p_status='waiting_operator_evaluation' then coalesce(c.hold_armed_at,now()) else c.hold_armed_at end,
    metadata_safe=coalesce(c.metadata_safe,'{}'::jsonb)||coalesce(p_metadata_safe,'{}'::jsonb)||jsonb_build_object(
      'terminal_reason',p_reason,'terminalized_at',now(),
      'completed_at',case when p_status in ('completed','canceled','expired','archived','activation_failed') then now() else null end
    ),updated_at=now()
   where c.account_id=p_account_id and c.metadata_safe->>'control_id'=p_control_id::text
     and (p_run_id is null or c.run_id is null or c.run_id=p_run_id)
     and (p_request_id is null or c.request_id is null or c.request_id=p_request_id)
   returning * into v_row;
  if not found then raise exception 'control_terminalization_mismatch' using errcode='P0001'; end if;
  return jsonb_build_object('ok',true,'status',v_row.status,'control_id',p_control_id);
end;
$$;

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

create or replace function public.mark_follow_60s_canary_barrier_v1(
  p_account_id uuid,p_run_id uuid,p_request_id uuid,p_canonical_follow_count integer
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.follow_60s_canary_controls%rowtype; v_control_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select * into v_row from public.follow_60s_canary_controls where account_id=p_account_id for update;
  if not found or v_row.status not in ('running','barrier_waiting_stop')
    or v_row.run_id is distinct from p_run_id or v_row.request_id is distinct from p_request_id then
    raise exception 'follow_60s_barrier_not_running' using errcode='55000';
  end if;
  if p_canonical_follow_count <> v_row.baseline_follow_count+v_row.evaluation_increment then
    raise exception 'follow_60s_barrier_count_mismatch' using errcode='22023';
  end if;
  v_control_id := (v_row.metadata_safe->>'control_id')::uuid;
  update public.follow_60s_canary_controls set status='waiting_operator_evaluation',
    barrier_reached_at=coalesce(barrier_reached_at,now()),hold_armed_at=coalesce(hold_armed_at,now()),
    metadata_safe=metadata_safe||jsonb_build_object(
      'current_new_cycle_count',evaluation_increment,'barrier_target',p_canonical_follow_count,
      'barrier_reached_at',now(),'terminal_reason','evaluation_barrier_reached'
    ),updated_at=now() where account_id=p_account_id;
  return jsonb_build_object('ok',true,'status','waiting_operator_evaluation',
    'control_id',v_control_id,'current_new_cycle_count',v_row.evaluation_increment,
    'canonical_follow_count',p_canonical_follow_count);
end;
$$;

create or replace function public.reconcile_ig_run_canonical_totals_v1(
  p_run_id uuid,p_account_id uuid,p_terminal_status text,p_metadata_safe jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_run public.ig_runs%rowtype;
  v_follow integer;
  v_like integer;
  v_dm integer;
  v_story integer;
  v_dm_event_count integer;
  v_story_event_count integer;
  v_targets integer;
  v_totals jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_terminal_status not in ('completed','failed','stopped','canceled','blocked','aborted') then
    raise exception 'terminal_status_invalid' using errcode='22023';
  end if;
  select * into v_run from public.ig_runs where id=p_run_id and account_id=p_account_id for update;
  if not found then raise exception 'run_mismatch' using errcode='P0001'; end if;
  select count(distinct lower(ltrim(username,'@')))::integer into v_follow
    from public.ig_interaction_events where run_id=p_run_id and account_id=p_account_id
      and event_status in ('success','partial')
      and event_type in ('follow_verified','follow_verified_persisted_v1');
  select coalesce(sum(liked_count),0)::integer into v_like from (
    select coalesce(
        nullif(stage_idempotency_key,''),
        nullif(lower(ltrim(username,'@')),''),
        id::text
      ) k,
      max(greatest(1,least(3,coalesce((payload->>'liked_count')::integer,1)))) liked_count
    from public.ig_interaction_events where run_id=p_run_id and account_id=p_account_id
      and event_status in ('success','partial') and event_type in ('post_like_success','post_like_verified')
    group by coalesce(
      nullif(stage_idempotency_key,''),
      nullif(lower(ltrim(username,'@')),''),
      id::text
    )
  ) x;
  select count(distinct coalesce(nullif(stage_idempotency_key,''),id::text))::integer into v_dm_event_count
    from public.ig_interaction_events where run_id=p_run_id and account_id=p_account_id
      and event_status in ('success','partial') and event_type in ('welcome_dm_sent','dm_sent','outreach_dm_sent');
  select count(distinct coalesce(nullif(stage_idempotency_key,''),id::text))::integer into v_story_event_count
    from public.ig_interaction_events where run_id=p_run_id and account_id=p_account_id
      and event_status in ('success','partial') and event_type in ('story_viewed','story_reacted','story_reply_sent');
  v_dm := case when v_dm_event_count > 0 then v_dm_event_count else coalesce(v_run.total_dm,0) end;
  v_story := case when v_story_event_count > 0 then v_story_event_count else coalesce(v_run.total_story,0) end;
  select count(distinct lower(ltrim(username,'@')))::integer into v_targets
    from public.ig_interaction_events where run_id=p_run_id and account_id=p_account_id
      and event_status in ('success','partial') and nullif(btrim(username),'') is not null;
  v_totals := jsonb_build_object(
    'total',v_follow+v_like+v_dm+v_story,'success',v_follow+v_like+v_dm+v_story,
    'failed',0,'total_follow',v_follow,'total_like',v_like,'total_dm',v_dm,
    'total_story',v_story,'total_targets',v_targets,
    'source','canonical_event_reconciliation','reconciled_at',now(),
    'dm_coverage',case when v_dm_event_count > 0 then 'canonical_events' else 'preserved_existing_counter' end,
    'story_coverage',case when v_story_event_count > 0 then 'canonical_events' else 'preserved_existing_counter' end
  );
  update public.ig_runs set status=p_terminal_status,
    total_follow=v_follow,total_like=v_like,total_dm=v_dm,total_story=v_story,total_targets=v_targets,
    totals=v_totals,performance_summary=coalesce(performance_summary,'{}'::jsonb)
      || coalesce(p_metadata_safe,'{}'::jsonb)
      || jsonb_build_object('terminal_reconciliation_source','canonical_event_reconciliation',
                            'terminal_reconciled_at',now(),
                            'dm_coverage',case when v_dm_event_count > 0 then 'canonical_events' else 'preserved_existing_counter' end,
                            'story_coverage',case when v_story_event_count > 0 then 'canonical_events' else 'preserved_existing_counter' end),
    finished_at=coalesce(finished_at,now()),
    completed_at=case when p_terminal_status='completed' then coalesce(completed_at,now()) else completed_at end,
    updated_at=now()
   where id=p_run_id and account_id=p_account_id;
  return jsonb_build_object('ok',true,'run_id',p_run_id,'status',p_terminal_status,
    'total_follow',v_follow,'total_like',v_like,'total_dm',v_dm,'total_story',v_story,
    'total_targets',v_targets,'totals',v_totals);
end;
$$;

revoke all on function public.prepare_follow_60s_canary_runtime_v3(uuid,uuid,text,text,uuid,uuid,integer,text,text) from public,anon,authenticated;
revoke all on function public.commit_follow_60s_canary_runtime_v3(uuid,uuid,text,text,uuid,uuid,integer,text,text) from public,anon,authenticated;
revoke all on function public.terminalize_follow_60s_canary_control_v1(uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.create_or_rearm_follow_60s_canary_control_v1(uuid,uuid,text,integer,integer,timestamptz,text,text,jsonb,text,text,text) from public,anon,authenticated;
revoke all on function public.reconcile_ig_run_canonical_totals_v1(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.mark_follow_60s_canary_barrier_v1(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.prepare_follow_60s_canary_runtime_v3(uuid,uuid,text,text,uuid,uuid,integer,text,text) to service_role;
grant execute on function public.commit_follow_60s_canary_runtime_v3(uuid,uuid,text,text,uuid,uuid,integer,text,text) to service_role;
grant execute on function public.terminalize_follow_60s_canary_control_v1(uuid,uuid,uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.create_or_rearm_follow_60s_canary_control_v1(uuid,uuid,text,integer,integer,timestamptz,text,text,jsonb,text,text,text) to service_role;
grant execute on function public.reconcile_ig_run_canonical_totals_v1(uuid,uuid,text,jsonb) to service_role;
grant execute on function public.mark_follow_60s_canary_barrier_v1(uuid,uuid,uuid,integer) to service_role;
