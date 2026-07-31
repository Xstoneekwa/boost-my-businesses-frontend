-- Move the Follow 60s pilot assignment from the historical Golden account to
-- the account selected by the durable canary control row. No run is started.

create or replace function public.persist_follow_60s_stage_v1(
  p_account_id uuid,
  p_run_id uuid,
  p_request_id uuid,
  p_action_id text,
  p_username text,
  p_source_profile text,
  p_stage text,
  p_stage_idempotency_key text,
  p_event_at timestamptz default now(),
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_type text;
  v_interaction_type text;
  v_inserted uuid;
  v_liked_count integer := greatest(1, least(3, coalesce((p_payload->>'liked_count')::integer, 1)));
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.follow_60s_canary_controls c
    where c.account_id = p_account_id
      and c.status in ('armed','barrier_waiting_stop','continuation_authorized')
  )
    or p_run_id is null or p_request_id is null
    or nullif(btrim(p_action_id), '') is null
    or nullif(btrim(p_username), '') is null
    or nullif(btrim(p_stage_idempotency_key), '') is null then
    raise exception 'invalid_follow_60s_stage_contract' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ig_runs r where r.id = p_run_id and r.account_id = p_account_id)
    or not exists (select 1 from public.account_run_requests q where q.id = p_request_id and q.account_id = p_account_id and q.run_id = p_run_id) then
    raise exception 'follow_60s_run_request_binding_mismatch' using errcode = '23503';
  end if;
  case p_stage
    when 'mute_posts_verified' then v_event_type := 'mute_posts_verified'; v_interaction_type := 'mute';
    when 'mute_stories_verified' then v_event_type := 'mute_success'; v_interaction_type := 'mute';
    when 'like_verified' then v_event_type := 'post_like_success'; v_interaction_type := 'like';
    when 'return_ct_exact' then v_event_type := 'return_ct_exact'; v_interaction_type := 'navigation';
    else raise exception 'unsupported_follow_60s_stage' using errcode = '22023';
  end case;

  insert into public.ig_interaction_events (
    account_id, run_id, request_id, username, source_profile, event_type,
    event_status, event_reason, event_at, payload, interaction_type,
    interaction_status, evidence_source, evidence_confidence, evidence_summary,
    metadata_safe, stage_idempotency_key
  ) values (
    p_account_id, p_run_id, p_request_id, lower(ltrim(btrim(p_username), '@')),
    nullif(btrim(p_source_profile), ''), v_event_type, 'success', p_stage,
    coalesce(p_event_at, now()),
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'action_id_hash', encode(digest(p_action_id, 'sha256'), 'hex'),
      'stage', p_stage,
      'stage_idempotency_key', p_stage_idempotency_key
    ),
    v_interaction_type, 'success', 'follow_60s_stage_receipt_v1', 'high',
    p_stage, jsonb_build_object('stage', p_stage), p_stage_idempotency_key
  )
  on conflict (account_id, run_id, stage_idempotency_key)
    where stage_idempotency_key is not null do nothing
  returning id into v_inserted;

  if v_inserted is not null and p_stage in ('mute_posts_verified','mute_stories_verified','like_verified') then
    insert into public.ig_interacted_users (
      account_id, run_id, username, source_profile, interaction_type,
      was_successful, last_interaction_at, created_at, updated_at,
      first_source_profile, last_source_profile, first_run_id, last_run_id,
      request_id, interaction_status, evidence_source, evidence_confidence,
      evidence_summary, metadata_safe, muted_posts, muted_stories,
      last_muted_at, posts_liked_count
    ) values (
      p_account_id, p_run_id, lower(ltrim(btrim(p_username), '@')),
      nullif(btrim(p_source_profile), ''), v_interaction_type, true,
      coalesce(p_event_at, now()), now(), now(), nullif(btrim(p_source_profile), ''),
      nullif(btrim(p_source_profile), ''), p_run_id, p_run_id, p_request_id,
      'success', 'follow_60s_stage_receipt_v1', 'high', p_stage,
      jsonb_build_object('last_stage', p_stage),
      p_stage = 'mute_posts_verified', p_stage = 'mute_stories_verified',
      case when p_stage like 'mute_%' then coalesce(p_event_at, now()) else null end,
      case when p_stage = 'like_verified' then v_liked_count else 0 end
    )
    on conflict (account_id, username) do update set
      run_id = excluded.run_id,
      last_run_id = excluded.last_run_id,
      request_id = excluded.request_id,
      last_source_profile = coalesce(excluded.last_source_profile, public.ig_interacted_users.last_source_profile),
      last_interaction_at = excluded.last_interaction_at,
      updated_at = now(),
      was_successful = true,
      interaction_status = 'success',
      muted_posts = public.ig_interacted_users.muted_posts or excluded.muted_posts,
      muted_stories = public.ig_interacted_users.muted_stories or excluded.muted_stories,
      last_muted_at = greatest(public.ig_interacted_users.last_muted_at, excluded.last_muted_at),
      posts_liked_count = coalesce(public.ig_interacted_users.posts_liked_count, 0) + coalesce(excluded.posts_liked_count, 0),
      metadata_safe = coalesce(public.ig_interacted_users.metadata_safe, '{}'::jsonb) || excluded.metadata_safe;
  end if;

  return jsonb_build_object('ok', true, 'inserted', v_inserted is not null, 'event_id', v_inserted, 'stage', p_stage);
end;
$$;

revoke all on function public.persist_follow_60s_stage_v1(uuid,uuid,uuid,text,text,text,text,text,timestamptz,jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_follow_60s_stage_v1(uuid,uuid,uuid,text,text,text,text,text,timestamptz,jsonb)
  to service_role;
