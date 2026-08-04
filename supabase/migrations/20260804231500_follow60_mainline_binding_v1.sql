-- Follow60 Mainline V1: normal runs bind to run_id; canary controls remain optional.
-- Additive only. Applying this migration never creates a request, run or control.

alter table public.follow_60s_completed_cycle_ledger
  add column if not exists binding_kind text not null default 'canary';

alter table public.follow_60s_completed_cycle_ledger
  drop constraint if exists follow_60s_completed_cycle_binding_kind_check;
alter table public.follow_60s_completed_cycle_ledger
  add constraint follow_60s_completed_cycle_binding_kind_check
  check (binding_kind in ('canary','mainline'));

create or replace function public.persist_follow60_post_follow_v3(
  p_binding_kind text, p_binding_id uuid, p_worker_sha text,
  p_account_id uuid, p_run_id uuid, p_request_id uuid,
  p_action_id text, p_action_id_hash text, p_username text,
  p_source_profile text, p_attempt_id integer, p_business_session_id text,
  p_cycle_complete boolean, p_stages jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_kind text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_binding_kind,'')));
  v_username text := pg_catalog.lower(pg_catalog.ltrim(pg_catalog.btrim(coalesce(p_username,'')),'@'));
  v_source text := pg_catalog.lower(pg_catalog.ltrim(pg_catalog.btrim(coalesce(p_source_profile,'')),'@'));
  v_expected_hash text;
  v_stage jsonb; v_name text; v_key text; v_event_id uuid;
  v_event_type text; v_interaction_type text; v_liked integer;
  v_like_increment integer := 0;
  v_inserted text[] := array[]::text[]; v_duplicates text[] := array[]::text[];
  v_seen text[] := array[]::text[]; v_projection jsonb := '{}'::jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;
  if v_kind='canary' then
    return public.persist_follow_60s_post_follow_v2(
      p_account_id,p_run_id,p_request_id,p_action_id,p_action_id_hash,p_username,
      p_source_profile,p_attempt_id,p_business_session_id,p_cycle_complete,p_stages
    ) || pg_catalog.jsonb_build_object(
      'binding_kind','canary','binding_id',p_binding_id,'worker_sha',pg_catalog.lower(p_worker_sha)
    );
  end if;
  v_expected_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(coalesce(p_action_id,''),'UTF8'),'sha256'),'hex'
  );
  if v_kind<>'mainline' or p_binding_id is distinct from p_run_id
    or p_account_id is null or p_run_id is null or p_request_id is null
    or nullif(pg_catalog.btrim(p_action_id),'') is null
    or p_action_id_hash !~ '^[0-9a-f]{64}$' or p_action_id_hash<>v_expected_hash
    or nullif(v_username,'') is null or nullif(v_source,'') is null
    or coalesce(p_attempt_id,0)<1
    or nullif(pg_catalog.btrim(p_business_session_id),'') is null
    or pg_catalog.lower(coalesce(p_worker_sha,'')) !~ '^[0-9a-f]{40}$'
    or p_cycle_complete is null or pg_catalog.jsonb_typeof(p_stages)<>'array'
    or pg_catalog.jsonb_array_length(p_stages) not between 1 and 4 then
    raise exception 'follow60_mainline_binding_missing_or_invalid' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text||':'||p_run_id::text||':'||p_action_id_hash,0)
  );
  perform 1 from public.ig_runs r
   where r.id=p_run_id and r.account_id=p_account_id for update;
  if not found then raise exception 'follow_60s_run_binding_mismatch' using errcode='23503'; end if;
  perform 1 from public.account_run_requests q
   where q.id=p_request_id and q.account_id=p_account_id and q.run_id=p_run_id for update;
  if not found then raise exception 'follow_60s_run_request_binding_mismatch' using errcode='23503'; end if;
  if exists (
    select 1 from public.follow_60s_canary_controls c where c.account_id=p_account_id
      and c.status in ('armed','running','barrier_waiting_stop','waiting_operator_evaluation','continuation_authorized')
  ) then raise exception 'follow60_mainline_active_canary_collision' using errcode='55000'; end if;
  perform 1 from public.ig_interacted_users u
   where u.account_id=p_account_id and u.run_id=p_run_id and u.request_id=p_request_id
     and pg_catalog.lower(pg_catalog.ltrim(u.username,'@'))=v_username
     and u.interaction_type='follow' and u.was_successful is true
     and u.payload->>'action_id'=p_action_id for update;
  if not found then raise exception 'follow_60s_canonical_follow_missing' using errcode='23503'; end if;

  for v_stage in select value from pg_catalog.jsonb_array_elements(p_stages)
  loop
    v_name:=coalesce(v_stage->>'stage','');
    if v_name not in ('mute_posts_verified','mute_stories_verified','like_verified','return_ct_exact')
      or v_name=any(v_seen)
      or pg_catalog.jsonb_typeof(coalesce(v_stage->'payload','{}'::jsonb))<>'object'
      or nullif(v_stage->>'event_at','') is null
      or pg_catalog.lower(coalesce(v_stage->'payload'->>'worker_sha',''))<>pg_catalog.lower(p_worker_sha)
      or coalesce(v_stage->'payload'->>'binding_kind','')<>'mainline'
      or coalesce(v_stage->'payload'->>'control_id','')<>p_binding_id::text then
      raise exception 'invalid_follow60_mainline_post_follow_stage' using errcode='22023';
    end if;
    v_seen:=pg_catalog.array_append(v_seen,v_name);
    v_event_id:=null; v_key:='follow60:v2:'||p_action_id_hash||':'||v_name;
    v_liked:=greatest(1,least(3,coalesce((v_stage->'payload'->>'liked_count')::integer,1)));
    case v_name
      when 'mute_posts_verified' then v_event_type:='mute_posts_verified'; v_interaction_type:='mute';
      when 'mute_stories_verified' then v_event_type:='mute_success'; v_interaction_type:='mute';
      when 'like_verified' then v_event_type:='post_like_success'; v_interaction_type:='like';
      when 'return_ct_exact' then v_event_type:='return_ct_exact'; v_interaction_type:='navigation';
    end case;
    insert into public.ig_interaction_events(
      account_id,run_id,request_id,session_id,username,source_profile,event_type,
      event_status,event_reason,event_at,payload,interaction_type,interaction_status,
      evidence_source,evidence_confidence,evidence_summary,metadata_safe,stage_idempotency_key
    ) values (
      p_account_id,p_run_id,p_request_id,p_business_session_id,v_username,v_source,
      v_event_type,'success',v_name,(v_stage->>'event_at')::timestamptz,
      coalesce(v_stage->'payload','{}'::jsonb)||pg_catalog.jsonb_build_object(
        'schema','FOLLOW60_MAINLINE_POST_FOLLOW_V3','action_id_hash',p_action_id_hash,
        'stage',v_name,'attempt_id',p_attempt_id,'business_session_id',p_business_session_id,
        'binding_kind','mainline','binding_id',p_binding_id,'worker_sha',pg_catalog.lower(p_worker_sha)
      ),v_interaction_type,'success','follow60_mainline_post_follow_v3','high',v_name,
      pg_catalog.jsonb_build_object('stage',v_name,'action_id_hash',p_action_id_hash,
        'binding_kind','mainline','binding_id',p_binding_id),v_key
    ) on conflict(account_id,run_id,stage_idempotency_key)
      where stage_idempotency_key is not null do nothing returning id into v_event_id;
    if v_event_id is null then
      v_duplicates:=pg_catalog.array_append(v_duplicates,v_name); continue;
    end if;
    v_inserted:=pg_catalog.array_append(v_inserted,v_name);
    if v_name in ('mute_posts_verified','mute_stories_verified','like_verified') then
      update public.ig_interacted_users u set
        last_run_id=p_run_id,request_id=p_request_id,last_session_id=p_business_session_id,
        last_source_profile=v_source,last_interaction_at=(v_stage->>'event_at')::timestamptz,
        updated_at=pg_catalog.now(),was_successful=true,
        muted_posts=coalesce(u.muted_posts,false) or v_name='mute_posts_verified',
        muted_stories=coalesce(u.muted_stories,false) or v_name='mute_stories_verified',
        last_muted_at=case when v_name like 'mute_%' then greatest(u.last_muted_at,(v_stage->>'event_at')::timestamptz) else u.last_muted_at end,
        posts_liked_count=coalesce(u.posts_liked_count,0)+case when v_name='like_verified' then v_liked else 0 end,
        metadata_safe=coalesce(u.metadata_safe,'{}'::jsonb)||pg_catalog.jsonb_build_object('last_post_follow_stage',v_name)
       where u.account_id=p_account_id and pg_catalog.lower(pg_catalog.ltrim(u.username,'@'))=v_username;
    end if;
    if v_name='like_verified' then v_like_increment:=v_like_increment+v_liked; end if;
  end loop;
  if p_cycle_complete is distinct from ('return_ct_exact'=any(v_seen)) then
    raise exception 'follow_60s_cycle_complete_mismatch' using errcode='22023';
  end if;
  if v_like_increment>0 then update public.ig_runs r
    set total_like=coalesce(r.total_like,0)+v_like_increment,updated_at=pg_catalog.now()
    where r.id=p_run_id and r.account_id=p_account_id; end if;
  select pg_catalog.jsonb_build_object(
    'muted_posts',coalesce(u.muted_posts,false),'muted_stories',coalesce(u.muted_stories,false),
    'posts_liked_count',coalesce(u.posts_liked_count,0),'run_total_like',coalesce(r.total_like,0),
    'return_ct_exact',exists(select 1 from public.ig_interaction_events e
      where e.account_id=p_account_id and e.run_id=p_run_id and e.username=v_username
        and e.stage_idempotency_key='follow60:v2:'||p_action_id_hash||':return_ct_exact')
  ) into v_projection from public.ig_interacted_users u join public.ig_runs r
    on r.id=p_run_id and r.account_id=p_account_id
   where u.account_id=p_account_id and pg_catalog.lower(pg_catalog.ltrim(u.username,'@'))=v_username;
  return pg_catalog.jsonb_build_object(
    'ok',true,'binding_valid',true,'schema','FOLLOW60_MAINLINE_POST_FOLLOW_V3',
    'binding_kind','mainline','binding_id',p_binding_id,'worker_sha',pg_catalog.lower(p_worker_sha),
    'inserted_stages',pg_catalog.to_jsonb(v_inserted),'duplicate_stages',pg_catalog.to_jsonb(v_duplicates),
    'like_increment',v_like_increment,'run_id',p_run_id,'request_id',p_request_id,
    'action_id_hash',p_action_id_hash,'cycle_complete',p_cycle_complete,
    'current_projection',v_projection,'reason','ok'
  );
end;
$$;

create or replace function public.ack_follow60_completed_cycle_v2(
  p_binding_kind text,p_binding_id uuid,p_account_id uuid,p_run_id uuid,p_request_id uuid,
  p_action_id text,p_action_id_hash text,p_attempt_id integer,p_business_session_id text,
  p_candidate_username text,p_source_profile text,p_worker_sha text,
  p_like_terminal_status text,p_like_terminal_reason text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_kind text:=pg_catalog.lower(pg_catalog.btrim(coalesce(p_binding_kind,'')));
  v_candidate text:=pg_catalog.lower(pg_catalog.ltrim(pg_catalog.btrim(coalesce(p_candidate_username,'')),'@'));
  v_source text:=pg_catalog.lower(pg_catalog.ltrim(pg_catalog.btrim(coalesce(p_source_profile,'')),'@'));
  v_expected_hash text; v_revision bigint:=0; v_count integer:=0; v_new boolean:=false;
  v_prefix text;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if v_kind='canary' then
    return public.ack_follow_60s_completed_cycle_v1(
      p_binding_id,p_account_id,p_run_id,p_request_id,p_action_id,p_action_id_hash,
      p_attempt_id,p_business_session_id,p_candidate_username,p_source_profile,
      p_worker_sha,p_like_terminal_status,p_like_terminal_reason
    )||pg_catalog.jsonb_build_object('binding_kind','canary','binding_id',p_binding_id);
  end if;
  v_expected_hash:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(coalesce(p_action_id,''),'UTF8'),'sha256'),'hex');
  if v_kind<>'mainline' or p_binding_id is distinct from p_run_id
    or p_account_id is null or p_run_id is null or p_request_id is null
    or nullif(pg_catalog.btrim(p_action_id),'') is null
    or p_action_id_hash !~ '^[0-9a-f]{64}$' or p_action_id_hash<>v_expected_hash
    or coalesce(p_attempt_id,0)<1 or nullif(pg_catalog.btrim(p_business_session_id),'') is null
    or nullif(v_candidate,'') is null or nullif(v_source,'') is null
    or pg_catalog.lower(coalesce(p_worker_sha,'')) !~ '^[0-9a-f]{40}$'
    or p_like_terminal_status not in ('verified','safe_skip')
    or nullif(pg_catalog.btrim(p_like_terminal_reason),'') is null then
    raise exception 'follow60_mainline_cycle_ledger_binding_invalid' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_account_id::text||':'||p_run_id::text||':'||p_action_id_hash,0));
  perform 1 from public.ig_runs r where r.id=p_run_id and r.account_id=p_account_id for update;
  if not found then raise exception 'follow60_cycle_ledger_run_mismatch' using errcode='23503'; end if;
  perform 1 from public.account_run_requests q
   where q.id=p_request_id and q.account_id=p_account_id and q.run_id=p_run_id for update;
  if not found then raise exception 'follow60_cycle_ledger_request_mismatch' using errcode='23503'; end if;
  if exists(select 1 from public.follow_60s_canary_controls c where c.account_id=p_account_id
    and c.status in ('armed','running','barrier_waiting_stop','waiting_operator_evaluation','continuation_authorized')) then
    raise exception 'follow60_mainline_active_canary_collision' using errcode='55000'; end if;
  perform 1 from public.ig_interacted_users u where u.account_id=p_account_id
    and u.run_id=p_run_id and u.request_id=p_request_id
    and pg_catalog.lower(pg_catalog.ltrim(u.username,'@'))=v_candidate
    and u.interaction_type='follow' and u.was_successful is true and u.payload->>'action_id'=p_action_id;
  if not found then raise exception 'follow60_cycle_ledger_follow_missing' using errcode='23503'; end if;
  v_prefix:='follow60:v2:'||p_action_id_hash||':';
  perform 1 from public.ig_interaction_events e where e.account_id=p_account_id and e.run_id=p_run_id
    and e.request_id=p_request_id and e.stage_idempotency_key=v_prefix||'mute_posts_verified' and e.event_status='success';
  if not found then raise exception 'follow60_cycle_ledger_mute_posts_missing' using errcode='23503'; end if;
  perform 1 from public.ig_interaction_events e where e.account_id=p_account_id and e.run_id=p_run_id
    and e.request_id=p_request_id and e.stage_idempotency_key=v_prefix||'mute_stories_verified' and e.event_status='success';
  if not found then raise exception 'follow60_cycle_ledger_mute_stories_missing' using errcode='23503'; end if;
  perform 1 from public.ig_interaction_events e where e.account_id=p_account_id and e.run_id=p_run_id
    and e.request_id=p_request_id and e.stage_idempotency_key=v_prefix||'return_ct_exact' and e.event_status='success';
  if not found then raise exception 'follow60_cycle_ledger_return_ct_missing' using errcode='23503'; end if;
  if p_like_terminal_status='verified' then
    perform 1 from public.ig_interaction_events e where e.account_id=p_account_id and e.run_id=p_run_id
      and e.request_id=p_request_id and e.stage_idempotency_key=v_prefix||'like_verified' and e.event_status='success';
    if not found then raise exception 'follow60_cycle_ledger_like_missing' using errcode='23503'; end if;
  end if;
  select l.revision into v_revision from public.follow_60s_completed_cycle_ledger l
   where l.control_id=p_binding_id and l.action_id_hash=p_action_id_hash;
  if coalesce(v_revision,0)=0 then
    select coalesce(max(l.revision),0)+1 into v_revision from public.follow_60s_completed_cycle_ledger l
     where l.control_id=p_binding_id;
    insert into public.follow_60s_completed_cycle_ledger(
      control_id,action_id_hash,account_id,run_id,request_id,attempt_id,business_session_id,
      candidate_username,source_profile,worker_sha,like_terminal_status,like_terminal_reason,
      revision,metadata_safe,binding_kind
    ) values (
      p_binding_id,p_action_id_hash,p_account_id,p_run_id,p_request_id,p_attempt_id,p_business_session_id,
      v_candidate,v_source,pg_catalog.lower(p_worker_sha),p_like_terminal_status,p_like_terminal_reason,
      v_revision,pg_catalog.jsonb_build_object('schema','FOLLOW60_MAINLINE_CYCLE_LEDGER_V2',
        'binding_kind','mainline','binding_id',p_binding_id,'action_id_hash',p_action_id_hash),
      'mainline'
    ) on conflict(control_id,action_id_hash) do nothing;
    v_new:=found;
  end if;
  select count(*)::integer into v_count from public.follow_60s_completed_cycle_ledger l
   where l.control_id=p_binding_id and l.run_id=p_run_id and l.account_id=p_account_id;
  return pg_catalog.jsonb_build_object(
    'ok',true,'schema','FOLLOW60_MAINLINE_CYCLE_LEDGER_V2','binding_kind','mainline',
    'binding_id',p_binding_id,'cycle_was_new',v_new,'new_cycle_count',v_count,
    'max_cycles',0,'barrier_target',0,'barrier_reached',false,
    'next_candidate_permitted',true,'terminal_status','','revision',v_revision,
    'run_id',p_run_id,'request_id',p_request_id
  );
end;
$$;

revoke all on function public.persist_follow60_post_follow_v3(
  text,uuid,text,uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb
) from public,anon,authenticated;
grant execute on function public.persist_follow60_post_follow_v3(
  text,uuid,text,uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb
) to service_role;
revoke all on function public.ack_follow60_completed_cycle_v2(
  text,uuid,uuid,uuid,uuid,text,text,integer,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.ack_follow60_completed_cycle_v2(
  text,uuid,uuid,uuid,uuid,text,text,integer,text,text,text,text,text,text
) to service_role;
