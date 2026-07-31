-- Follow 60s Post-Follow V2: atomic, idempotent stage projection.
-- Additive only. This migration does not arm, schedule or start a run.

create or replace function public.bind_follow_60s_canary_runtime_v2(
  p_account_id uuid,
  p_run_id uuid,
  p_request_id uuid,
  p_attempt_id integer,
  p_business_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control public.follow_60s_canary_controls%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_account_id <> 'b024e94e-395d-4f02-9787-81ddc679b014'::uuid
    or p_run_id is null or p_request_id is null
    or coalesce(p_attempt_id, 0) < 1
    or nullif(pg_catalog.btrim(p_business_session_id), '') is null then
    raise exception 'follow60_stage_binding_missing_or_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text || ':follow60-runtime-bind', 0)
  );
  perform 1 from public.ig_runs r
   where r.id = p_run_id and r.account_id = p_account_id
   for update;
  if not found then
    raise exception 'follow_60s_run_binding_mismatch' using errcode = '23503';
  end if;
  perform 1 from public.account_run_requests q
   where q.id = p_request_id and q.account_id = p_account_id and q.run_id = p_run_id
   for update;
  if not found then
    raise exception 'follow_60s_run_request_binding_mismatch' using errcode = '23503';
  end if;
  select * into v_control
    from public.follow_60s_canary_controls c
   where c.account_id = p_account_id
   for update;
  if not found
    or v_control.status <> 'armed'
    or (v_control.run_id is not null and v_control.run_id <> p_run_id)
    or (v_control.request_id is not null and v_control.request_id <> p_request_id) then
    raise exception 'follow_60s_control_binding_mismatch' using errcode = '55000';
  end if;

  update public.follow_60s_canary_controls c
     set run_id = p_run_id,
         request_id = p_request_id,
         metadata_safe = coalesce(c.metadata_safe, '{}'::jsonb)
           || pg_catalog.jsonb_build_object(
             'runtime_binding_schema', 'FOLLOW_60S_RUNTIME_BINDING_V2',
             'attempt_id', p_attempt_id,
             'business_session_id', p_business_session_id,
             'bound_at', pg_catalog.now()
           ),
         updated_at = pg_catalog.now()
   where c.account_id = p_account_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'binding_valid', true,
    'status', 'armed',
    'account_id', p_account_id,
    'run_id', p_run_id,
    'request_id', p_request_id,
    'attempt_id', p_attempt_id,
    'business_session_id', p_business_session_id,
    'baseline_follow_count', v_control.baseline_follow_count,
    'evaluation_increment', v_control.evaluation_increment,
    'target_follow_count', v_control.target_follow_count
  );
end;
$$;

create or replace function public.persist_follow_60s_post_follow_v2(
  p_account_id uuid,
  p_run_id uuid,
  p_request_id uuid,
  p_action_id text,
  p_action_id_hash text,
  p_username text,
  p_source_profile text,
  p_attempt_id integer,
  p_business_session_id text,
  p_cycle_complete boolean,
  p_stages jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  v_source_profile text := lower(ltrim(btrim(coalesce(p_source_profile, '')), '@'));
  v_expected_hash text;
  v_stage jsonb;
  v_stage_name text;
  v_stage_key text;
  v_event_id uuid;
  v_event_type text;
  v_interaction_type text;
  v_liked_count integer;
  v_like_increment integer := 0;
  v_inserted text[] := array[]::text[];
  v_duplicates text[] := array[]::text[];
  v_seen text[] := array[]::text[];
  v_projection jsonb := '{}'::jsonb;
  v_control public.follow_60s_canary_controls%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  v_expected_hash := encode(
    extensions.digest(convert_to(coalesce(p_action_id, ''), 'UTF8'), 'sha256'),
    'hex'
  );
  if p_account_id <> 'b024e94e-395d-4f02-9787-81ddc679b014'::uuid
    or p_run_id is null or p_request_id is null
    or nullif(btrim(p_action_id), '') is null
    or p_action_id_hash !~ '^[0-9a-f]{64}$'
    or p_action_id_hash <> v_expected_hash
    or nullif(v_username, '') is null
    or nullif(v_source_profile, '') is null
    or coalesce(p_attempt_id, 0) < 1
    or nullif(btrim(p_business_session_id), '') is null
    or p_cycle_complete is null
    or jsonb_typeof(p_stages) <> 'array'
    or jsonb_array_length(p_stages) < 1
    or jsonb_array_length(p_stages) > 4 then
    raise exception 'follow60_stage_binding_missing_or_invalid' using errcode = '22023';
  end if;

  -- Deterministic lock order: advisory key, run, request, control, canonical Follow.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_account_id::text || ':' || p_run_id::text || ':' || p_action_id_hash,
      0
    )
  );
  perform 1 from public.ig_runs r
   where r.id = p_run_id and r.account_id = p_account_id
   for update;
  if not found then
    raise exception 'follow_60s_run_binding_mismatch' using errcode = '23503';
  end if;
  perform 1 from public.account_run_requests q
   where q.id = p_request_id and q.account_id = p_account_id and q.run_id = p_run_id
   for update;
  if not found then
    raise exception 'follow_60s_run_request_binding_mismatch' using errcode = '23503';
  end if;
  select * into v_control
    from public.follow_60s_canary_controls c
   where c.account_id = p_account_id
   for update;
  if not found
    or v_control.status not in (
      'armed','barrier_waiting_stop','continuation_authorized','waiting_operator_evaluation'
    )
    or v_control.run_id is distinct from p_run_id
    or v_control.request_id is distinct from p_request_id
    or coalesce((v_control.metadata_safe->>'attempt_id')::integer, 0) <> p_attempt_id
    or coalesce(v_control.metadata_safe->>'business_session_id', '') <> p_business_session_id
    or (
      v_control.status = 'waiting_operator_evaluation'
      and (
        v_control.run_id is distinct from p_run_id
        or v_control.request_id is distinct from p_request_id
        or v_control.hold_armed_at is null
        or v_control.hold_armed_at < pg_catalog.now() - interval '6 hours'
      )
    ) then
    raise exception 'follow_60s_control_binding_mismatch' using errcode = '55000';
  end if;
  perform 1 from public.ig_interacted_users u
   where u.account_id = p_account_id
     and u.run_id = p_run_id
     and u.request_id = p_request_id
     and lower(ltrim(u.username, '@')) = v_username
     and u.interaction_type = 'follow'
     and u.was_successful is true
     and u.payload->>'action_id' = p_action_id
   for update;
  if not found then
    raise exception 'follow_60s_canonical_follow_missing' using errcode = '23503';
  end if;

  for v_stage in
    select value
      from jsonb_array_elements(p_stages) with ordinality s(value, ord)
     order by case value->>'stage'
       when 'mute_posts_verified' then 1
       when 'mute_stories_verified' then 2
       when 'like_verified' then 3
       when 'return_ct_exact' then 4
       else 99 end, ord
  loop
    v_stage_name := coalesce(v_stage->>'stage', '');
    if v_stage_name not in (
      'mute_posts_verified','mute_stories_verified','like_verified','return_ct_exact'
    ) or v_stage_name = any(v_seen)
      or jsonb_typeof(coalesce(v_stage->'payload', '{}'::jsonb)) <> 'object'
      or nullif(v_stage->>'event_at', '') is null then
      raise exception 'invalid_follow_60s_post_follow_stage' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_stage_name);
    v_event_id := null;
    v_stage_key := 'follow60:v2:' || p_action_id_hash || ':' || v_stage_name;
    v_liked_count := greatest(
      1,
      least(3, coalesce((v_stage->'payload'->>'liked_count')::integer, 1))
    );
    case v_stage_name
      when 'mute_posts_verified' then
        v_event_type := 'mute_posts_verified'; v_interaction_type := 'mute';
      when 'mute_stories_verified' then
        v_event_type := 'mute_success'; v_interaction_type := 'mute';
      when 'like_verified' then
        v_event_type := 'post_like_success'; v_interaction_type := 'like';
      when 'return_ct_exact' then
        v_event_type := 'return_ct_exact'; v_interaction_type := 'navigation';
    end case;

    insert into public.ig_interaction_events (
      account_id, run_id, request_id, session_id, username, source_profile,
      event_type, event_status, event_reason, event_at, payload,
      interaction_type, interaction_status, evidence_source,
      evidence_confidence, evidence_summary, metadata_safe,
      stage_idempotency_key
    ) values (
      p_account_id, p_run_id, p_request_id, p_business_session_id,
      v_username, v_source_profile, v_event_type, 'success', v_stage_name,
      (v_stage->>'event_at')::timestamptz,
      coalesce(v_stage->'payload', '{}'::jsonb) || jsonb_build_object(
        'schema','FOLLOW_60S_POST_FOLLOW_COMPOSITE_V2',
        'action_id_hash',p_action_id_hash,'stage',v_stage_name,
        'attempt_id',p_attempt_id,'business_session_id',p_business_session_id
      ),
      v_interaction_type, 'success', 'follow_60s_post_follow_composite_v2',
      'high', v_stage_name,
      jsonb_build_object('stage',v_stage_name,'action_id_hash',p_action_id_hash),
      v_stage_key
    )
    on conflict (account_id, run_id, stage_idempotency_key)
      where stage_idempotency_key is not null do nothing
    returning id into v_event_id;

    if v_event_id is null then
      v_duplicates := array_append(v_duplicates, v_stage_name);
      continue;
    end if;
    v_inserted := array_append(v_inserted, v_stage_name);
    if v_stage_name in ('mute_posts_verified','mute_stories_verified','like_verified') then
      update public.ig_interacted_users u set
        last_run_id = p_run_id,
        request_id = p_request_id,
        last_session_id = p_business_session_id,
        last_source_profile = v_source_profile,
        last_interaction_at = (v_stage->>'event_at')::timestamptz,
        updated_at = pg_catalog.now(),
        was_successful = true,
        muted_posts = coalesce(u.muted_posts, false) or v_stage_name = 'mute_posts_verified',
        muted_stories = coalesce(u.muted_stories, false) or v_stage_name = 'mute_stories_verified',
        last_muted_at = case when v_stage_name like 'mute_%'
          then greatest(u.last_muted_at, (v_stage->>'event_at')::timestamptz)
          else u.last_muted_at end,
        posts_liked_count = coalesce(u.posts_liked_count, 0)
          + case when v_stage_name = 'like_verified' then v_liked_count else 0 end,
        metadata_safe = coalesce(u.metadata_safe, '{}'::jsonb)
          || jsonb_build_object('last_post_follow_stage',v_stage_name)
      where u.account_id = p_account_id and lower(ltrim(u.username, '@')) = v_username;
    end if;
    if v_stage_name = 'like_verified' then
      v_like_increment := v_like_increment + v_liked_count;
    end if;
  end loop;

  if p_cycle_complete is distinct from ('return_ct_exact' = any(v_seen)) then
    raise exception 'follow_60s_cycle_complete_mismatch' using errcode = '22023';
  end if;

  if v_like_increment > 0 then
    update public.ig_runs r set
      total_like = coalesce(r.total_like, 0) + v_like_increment,
      updated_at = pg_catalog.now()
    where r.id = p_run_id and r.account_id = p_account_id;
  end if;

  select pg_catalog.jsonb_build_object(
    'muted_posts', coalesce(u.muted_posts, false),
    'muted_stories', coalesce(u.muted_stories, false),
    'posts_liked_count', coalesce(u.posts_liked_count, 0),
    'run_total_like', coalesce(r.total_like, 0),
    'return_ct_exact', exists (
      select 1 from public.ig_interaction_events e
      where e.account_id = p_account_id and e.run_id = p_run_id
        and e.username = v_username
        and e.stage_idempotency_key =
          'follow60:v2:' || p_action_id_hash || ':return_ct_exact'
    )
  ) into v_projection
  from public.ig_interacted_users u
  join public.ig_runs r on r.id = p_run_id and r.account_id = p_account_id
  where u.account_id = p_account_id
    and pg_catalog.lower(pg_catalog.ltrim(u.username, '@')) = v_username;

  return pg_catalog.jsonb_build_object(
    'ok',true,'binding_valid',true,'schema','FOLLOW_60S_POST_FOLLOW_COMPOSITE_V2',
    'inserted',pg_catalog.to_jsonb(v_inserted),
    'duplicate',pg_catalog.to_jsonb(v_duplicates),
    'rejected','[]'::jsonb,
    'inserted_stages',pg_catalog.to_jsonb(v_inserted),
    'duplicate_stages',pg_catalog.to_jsonb(v_duplicates),
    'like_increment',v_like_increment,'run_id',p_run_id,'request_id',p_request_id,
    'action_id_hash',p_action_id_hash,'cycle_complete',p_cycle_complete,
    'current_projection',v_projection,'reason','ok'
  );
end;
$$;

revoke all on function public.persist_follow_60s_post_follow_v2(
  uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb
) from public, anon, authenticated;
grant execute on function public.persist_follow_60s_post_follow_v2(
  uuid,uuid,uuid,text,text,text,text,integer,text,boolean,jsonb
) to service_role;
revoke all on function public.bind_follow_60s_canary_runtime_v2(
  uuid,uuid,uuid,integer,text
) from public, anon, authenticated;
grant execute on function public.bind_follow_60s_canary_runtime_v2(
  uuid,uuid,uuid,integer,text
) to service_role;
