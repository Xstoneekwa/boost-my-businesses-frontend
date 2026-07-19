-- Persist one physically verified Follow and its source-target metric atomically.
-- The event primary key is the deterministic action id and is the idempotency gate.

create or replace function public.persist_verified_follow_success_v1(
  p_action_id uuid,
  p_account_id uuid,
  p_run_id uuid,
  p_request_id uuid,
  p_candidate_username text,
  p_source_target_id uuid default null,
  p_source_ct_username text default null,
  p_followed_at timestamptz default null,
  p_follow_state_after text default null,
  p_settings_revision_expected text default null,
  p_verification_method text default null,
  p_metadata_safe jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_username text := lower(ltrim(trim(coalesce(p_candidate_username, '')), '@'));
  v_source_username text := lower(ltrim(trim(coalesce(p_source_ct_username, '')), '@'));
  v_follow_state text := lower(trim(coalesce(p_follow_state_after, '')));
  v_verification_method text := lower(trim(coalesce(p_verification_method, '')));
  v_metadata jsonb := coalesce(p_metadata_safe, '{}'::jsonb);
  v_followed_at timestamptz := p_followed_at;
  v_expected_revision timestamptz;
  v_settings public.ig_account_unfollow_settings;
  v_request public.account_run_requests;
  v_run public.ig_runs;
  v_target public.ig_targets;
  v_event public.ig_interaction_events;
  v_interaction public.ig_interacted_users;
  v_interaction_count integer := 0;
  v_event_inserted boolean := false;
  v_eligible_unfollow_at timestamptz;
  v_counter_applied boolean := false;
  v_counter_status text := 'not_applicable';
  v_invariants jsonb := jsonb_build_array(
    'account_request_run_consistent',
    'canonical_username_confirmed',
    'settings_locked_revision_match',
    'interaction_persisted',
    'audit_persisted',
    'counter_applied_or_not_applicable'
  );
begin
  if p_action_id is null or p_account_id is null or p_run_id is null or p_request_id is null then
    raise exception 'follow_persistence_identity_required' using errcode = '22023';
  end if;
  if v_username = '' or v_username !~ '^[a-z0-9._]{1,30}$' then
    raise exception 'follow_persistence_username_invalid' using errcode = '22023';
  end if;
  if v_followed_at is null or v_followed_at > now() + interval '5 minutes' then
    raise exception 'follow_persistence_followed_at_invalid' using errcode = '22023';
  end if;
  if v_follow_state <> 'following' then
    raise exception 'follow_persistence_state_not_verified' using errcode = '22023';
  end if;
  if v_verification_method = '' or char_length(v_verification_method) > 120 then
    raise exception 'follow_persistence_verification_method_invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(v_metadata) is distinct from 'object'
     or pg_column_size(v_metadata) > 8192
     or public.jsonb_has_forbidden_safe_metadata_key(v_metadata) then
    raise exception 'follow_persistence_metadata_unsafe' using errcode = '22023';
  end if;
  begin
    v_expected_revision := nullif(trim(coalesce(p_settings_revision_expected, '')), '')::timestamptz;
  exception when others then
    raise exception 'follow_persistence_settings_revision_invalid' using errcode = '22023';
  end;
  if v_expected_revision is null then
    raise exception 'follow_persistence_settings_revision_required' using errcode = '22023';
  end if;

  select arr.* into v_request
  from public.account_run_requests as arr
  where arr.id = p_request_id
  for share;
  if v_request.id is null
     or v_request.account_id is distinct from p_account_id
     or v_request.run_id is distinct from p_run_id then
    raise exception 'follow_persistence_request_run_mismatch' using errcode = '22023';
  end if;

  select r.* into v_run
  from public.ig_runs as r
  where r.id = p_run_id
  for share;
  if v_run.id is null or v_run.account_id is distinct from p_account_id then
    raise exception 'follow_persistence_run_account_mismatch' using errcode = '22023';
  end if;

  if p_source_target_id is not null then
    select t.* into v_target
    from public.ig_targets as t
    where t.id = p_source_target_id
    for update;
    if v_target.id is null or v_target.account_id is distinct from p_account_id then
      raise exception 'follow_persistence_target_account_mismatch' using errcode = '22023';
    end if;
    if v_source_username <> '' and v_source_username not in (
      lower(ltrim(trim(coalesce(v_target.target_username, '')), '@')),
      lower(ltrim(trim(coalesce(v_target.normalized_username, '')), '@')),
      lower(ltrim(trim(coalesce(v_target.canonical_username, '')), '@'))
    ) then
      raise exception 'follow_persistence_target_username_mismatch' using errcode = '22023';
    end if;
  end if;

  insert into public.ig_interaction_events (
    id, account_id, run_id, username, source_profile,
    event_type, event_status, event_reason, event_at, payload,
    target_id, ct_id, source_target_id, source_target_username, request_id,
    interaction_type, interaction_status, evidence_source,
    evidence_confidence, evidence_summary, metadata_safe
  ) values (
    p_action_id, p_account_id, p_run_id, v_username, nullif(v_source_username, ''),
    'follow_verified_persisted_v1', 'processing', null, v_followed_at,
    jsonb_build_object('contract_version', 'follow_persistence_v1'),
    p_source_target_id, p_source_target_id, p_source_target_id, nullif(v_source_username, ''), p_request_id,
    'follow', 'processing', 'worker_follow_state_exact',
    'high', 'Exact Following state verified before transactional persistence.', v_metadata
  )
  on conflict (id) do nothing
  returning * into v_event;
  v_event_inserted := v_event.id is not null;

  if not v_event_inserted then
    select e.* into v_event
    from public.ig_interaction_events as e
    where e.id = p_action_id
    for update;
    if v_event.id is null
       or v_event.account_id is distinct from p_account_id
       or v_event.run_id is distinct from p_run_id
       or v_event.request_id is distinct from p_request_id
       or lower(v_event.username) <> v_username
       or v_event.source_target_id is distinct from p_source_target_id
       or v_event.event_type <> 'follow_verified_persisted_v1' then
      raise exception 'follow_persistence_action_id_conflict' using errcode = '23505';
    end if;
    if v_event.event_status = 'success'
       and coalesce((v_event.payload ->> 'follow_persisted')::boolean, false)
       and coalesce((v_event.payload ->> 'audit_persisted')::boolean, false)
       and coalesce((v_event.payload ->> 'counter_applied')::boolean, false)
       and coalesce((v_event.payload ->> 'settings_revision_match')::boolean, false) then
      return jsonb_build_object(
        'ok', true,
        'status', 'idempotent_replay',
        'action_id', p_action_id,
        'interaction_id', v_event.payload ->> 'interaction_id',
        'follow_persisted', true,
        'eligible_unfollow_at', v_event.payload ->> 'eligible_unfollow_at',
        'audit_persisted', true,
        'counter_applied', true,
        'settings_revision_match', true,
        'invariants_confirmed', coalesce(v_event.payload -> 'invariants_confirmed', v_invariants),
        'failure_reason', null
      );
    end if;
    raise exception 'follow_persistence_existing_action_incomplete' using errcode = '40001';
  end if;

  select s.* into v_settings
  from public.ig_account_unfollow_settings as s
  where s.account_id = p_account_id
  for update;
  if v_settings.account_id is null then
    raise exception 'follow_persistence_unfollow_settings_missing' using errcode = 'P0002';
  end if;
  if v_settings.updated_at is distinct from v_expected_revision then
    raise exception 'follow_persistence_settings_revision_mismatch' using errcode = '40001';
  end if;
  v_eligible_unfollow_at := v_followed_at + make_interval(days => v_settings.unfollow_after_days);

  select count(*) into v_interaction_count
  from public.ig_interacted_users as iu
  where iu.account_id = p_account_id and lower(iu.username) = v_username;
  if v_interaction_count > 1 then
    raise exception 'follow_persistence_casefold_ambiguous' using errcode = '23505';
  end if;

  select iu.* into v_interaction
  from public.ig_interacted_users as iu
  where iu.account_id = p_account_id and lower(iu.username) = v_username
  for update;

  if v_interaction.id is not null
     and v_interaction.unfollowed_at is null
     and coalesce(v_interaction.interaction_lifecycle_state, '') = 'active_following' then
    raise exception 'follow_persistence_active_interaction_exists' using errcode = '23505';
  end if;

  if v_interaction.id is null then
    insert into public.ig_interacted_users (
      account_id, run_id, username, source_profile, interaction_type,
      follow_status, was_successful, followed_at, last_interaction_at,
      payload, first_source_profile, last_source_profile, first_run_id, last_run_id,
      followed_by_bot, eligible_unfollow_at, interaction_lifecycle_state,
      ct_id, source_target_id, source_target_username, request_id,
      interaction_status, evidence_source, evidence_confidence,
      evidence_summary, metadata_safe
    ) values (
      p_account_id, p_run_id, v_username, nullif(v_source_username, ''), 'follow',
      'following', true, v_followed_at, v_followed_at,
      jsonb_build_object('follow_state_after', 'following', 'action_id', p_action_id),
      nullif(v_source_username, ''), nullif(v_source_username, ''), p_run_id, p_run_id,
      true, v_eligible_unfollow_at, 'active_following',
      p_source_target_id, p_source_target_id, nullif(v_source_username, ''), p_request_id,
      'success', 'worker_follow_state_exact', 'high',
      'Exact Following state verified before transactional persistence.', v_metadata
    ) returning * into v_interaction;
  else
    update public.ig_interacted_users as iu set
      run_id = p_run_id,
      username = v_username,
      source_profile = nullif(v_source_username, ''),
      interaction_type = 'follow',
      follow_status = 'following',
      was_successful = true,
      followed_at = v_followed_at,
      unfollowed_at = null,
      last_interaction_at = v_followed_at,
      updated_at = now(),
      payload = jsonb_build_object('follow_state_after', 'following', 'action_id', p_action_id),
      first_source_profile = coalesce(iu.first_source_profile, nullif(v_source_username, '')),
      last_source_profile = nullif(v_source_username, ''),
      first_run_id = coalesce(iu.first_run_id, p_run_id),
      last_run_id = p_run_id,
      followed_by_bot = true,
      eligible_unfollow_at = v_eligible_unfollow_at,
      unfollow_mode_applied = null,
      unfollow_result = null,
      unfollow_attempts = 0,
      last_unfollow_attempt_at = null,
      unfollow_skip_reason = null,
      interaction_lifecycle_state = 'active_following',
      ct_id = p_source_target_id,
      source_target_id = p_source_target_id,
      source_target_username = nullif(v_source_username, ''),
      request_id = p_request_id,
      interaction_status = 'success',
      evidence_source = 'worker_follow_state_exact',
      evidence_confidence = 'high',
      evidence_summary = 'Exact Following state verified before transactional persistence.',
      metadata_safe = v_metadata
    where iu.id = v_interaction.id
    returning * into v_interaction;
  end if;

  if p_source_target_id is not null then
    update public.ig_targets as t set
      follows_sent_count = coalesce(t.follows_sent_count, 0) + 1,
      last_successful_candidate_at = v_followed_at,
      last_action_at = v_followed_at,
      last_used_at = v_followed_at,
      metrics_updated_at = now(),
      updated_at = now()
    where t.id = p_source_target_id and t.account_id = p_account_id;
    if not found then
      raise exception 'follow_persistence_target_counter_failed' using errcode = 'P0002';
    end if;
    v_counter_status := 'applied';
  end if;
  v_counter_applied := true;

  update public.ig_interaction_events as e set
    event_status = 'success',
    interaction_status = 'success',
    event_reason = null,
    payload = jsonb_build_object(
      'contract_version', 'follow_persistence_v1',
      'interaction_id', v_interaction.id,
      'follow_persisted', true,
      'eligible_unfollow_at', v_eligible_unfollow_at,
      'audit_persisted', true,
      'counter_applied', v_counter_applied,
      'counter_status', v_counter_status,
      'settings_revision_match', true,
      'settings_revision', v_settings.updated_at,
      'verification_method', v_verification_method,
      'invariants_confirmed', v_invariants
    ),
    metadata_safe = v_metadata
  where e.id = p_action_id
  returning * into v_event;

  return jsonb_build_object(
    'ok', true,
    'status', 'created',
    'action_id', p_action_id,
    'interaction_id', v_interaction.id,
    'follow_persisted', true,
    'eligible_unfollow_at', v_eligible_unfollow_at,
    'audit_persisted', true,
    'counter_applied', true,
    'settings_revision_match', true,
    'invariants_confirmed', v_invariants,
    'failure_reason', null
  );
end;
$function$;

revoke all on function public.persist_verified_follow_success_v1(
  uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, text, text, text, jsonb
) from public;
revoke all on function public.persist_verified_follow_success_v1(
  uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, text, text, text, jsonb
) from anon;
revoke all on function public.persist_verified_follow_success_v1(
  uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, text, text, text, jsonb
) from authenticated;
grant execute on function public.persist_verified_follow_success_v1(
  uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, text, text, text, jsonb
) to service_role;

comment on function public.persist_verified_follow_success_v1(
  uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, text, text, text, jsonb
) is 'Atomically persists one exact Following verification, its J+N eligibility, source counter, and idempotent audit event.';
