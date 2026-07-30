-- PREPARED ONLY — NOT APPLIED TO PRODUCTION.
-- TARGET_FOLLOWERS_PROGRESSIVE_RESUME_V2 commit provenance V4.
-- Additive only: V3 and every historical checkpoint/event remain intact.

begin;

do $migration_guard$
begin
  if to_regclass('public.ig_target_followers_resume_checkpoints') is null
     or to_regclass('public.ig_target_followers_resume_checkpoint_events') is null
     or to_regclass('public.account_run_requests') is null
     or to_regclass('public.ig_runs') is null
     or to_regclass('public.ig_targets') is null then
    raise exception 'target_followers_resume_v4_required_schema_missing';
  end if;

  if to_regprocedure(
    'public.commit_target_followers_resume_checkpoint_v3(uuid,uuid,text,uuid,text,bigint,integer,text,text,jsonb,text,text,boolean,text,integer)'
  ) is null then
    raise exception 'target_followers_resume_v3_baseline_missing';
  end if;

  if exists (
    select 1
    from public.ig_target_followers_resume_checkpoints
    where checkpoint_version <> 3
  ) then
    raise exception 'target_followers_resume_checkpoint_version_drift';
  end if;
end
$migration_guard$;

-- The canonical dump retained DEFAULT 2 while the validated constraint
-- requires version 3. This changes only future inserts and invents no history.
alter table public.ig_target_followers_resume_checkpoints
  alter column checkpoint_version set default 3;

create or replace function public.commit_target_followers_resume_checkpoint_v4(
  p_account_id uuid,
  p_target_id uuid,
  p_surface text,
  p_run_id uuid,
  p_mode text,
  p_expected_version bigint,
  p_last_safe_depth integer,
  p_commit_context jsonb,
  p_last_safe_anchor text default null,
  p_anchor_fingerprint text default null,
  p_last_visible_anchor_hashes jsonb default '[]'::jsonb,
  p_last_instagram_version text default null,
  p_status text default 'active',
  p_end_reached boolean default false,
  p_reason text default 'validated_transition',
  p_lease_seconds integer default 3600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.ig_target_followers_resume_checkpoints%rowtype;
  v_request public.account_run_requests%rowtype;
  v_run public.ig_runs%rowtype;

  v_request_metadata jsonb;
  v_resume_plan jsonb := '{}'::jsonb;
  v_raw jsonb;
  v_scalar_text text;

  v_source_request_id uuid;
  v_source_attempt_id bigint;
  v_observed_scroll_index integer;
  v_overlap_count bigint;
  v_new_unique_rows bigint;

  v_attempt_field_count integer := 0;
  v_canonical_attempt_id bigint;
  v_attempt_candidate bigint;
  v_retry_contract_present boolean := false;
  v_top_level_attempt_present boolean := false;
  v_retry_index_candidate bigint;

  v_previous_depth integer;
  v_new_version bigint;
  v_new_lease_generation bigint;
  v_reclaimed boolean := false;
  v_expiry timestamptz;

  v_event_metadata jsonb;
  v_commit_event_id uuid;
  v_committed_at timestamptz;
begin
  if p_account_id is null
     or p_target_id is null
     or p_run_id is null
     or p_expected_version is null
     or p_last_safe_depth is null
     or p_surface is distinct from 'followers'
     or p_mode is null
     or p_mode not in ('shadow', 'enforce')
     or p_last_safe_depth not between 0 and 80
     or p_status is null
     or p_status not in ('active', 'exhausted')
     or p_end_reached is null
     or coalesce(p_reason, '') !~ '^[a-z0-9_:-]{1,120}$'
     or p_lease_seconds is null
     or p_lease_seconds not between 300 and 7200
     or coalesce(p_last_safe_anchor, '') !~ '^a3:[0-9a-f]{32}$'
     or coalesce(p_anchor_fingerprint, '') !~ '^v3:[0-9a-f]{32}$'
     or coalesce(length(p_last_instagram_version), 0) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_commit_input');
  end if;

  if jsonb_typeof(p_last_visible_anchor_hashes) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_commit_input');
  end if;

  if jsonb_array_length(p_last_visible_anchor_hashes) not between 1 and 12
     or exists (
       select 1
       from jsonb_array_elements(p_last_visible_anchor_hashes) as a(value)
       where jsonb_typeof(a.value) is distinct from 'string'
          or (a.value #>> '{}') !~ '^a3:[0-9a-f]{32}$'
     )
     or p_last_safe_anchor is distinct from (
       p_last_visible_anchor_hashes ->> (jsonb_array_length(p_last_visible_anchor_hashes) - 1)
     ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_commit_input');
  end if;

  if jsonb_typeof(p_commit_context) is distinct from 'object'
     or pg_column_size(p_commit_context) > 2048 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_commit_context');
  end if;

  if (
    select count(*)
    from jsonb_object_keys(p_commit_context)
  ) <> 8
  or exists (
    select 1
    from jsonb_object_keys(p_commit_context) as k(key)
    where not (
      k.key = any (
        array[
          'source_request_id',
          'source_attempt_id',
          'release_sha',
          'observed_scroll_index',
          'overlap_count',
          'new_unique_rows',
          'viewport_fingerprint_before',
          'viewport_fingerprint_after'
        ]::text[]
      )
    )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_commit_context_keys');
  end if;

  if jsonb_typeof(p_commit_context -> 'source_request_id') is distinct from 'string'
     or coalesce(p_commit_context ->> 'source_request_id', '')
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(p_commit_context -> 'release_sha') is distinct from 'string'
     or coalesce(p_commit_context ->> 'release_sha', '') !~ '^[0-9a-f]{40}$'
     or jsonb_typeof(p_commit_context -> 'viewport_fingerprint_before') is distinct from 'string'
     or coalesce(p_commit_context ->> 'viewport_fingerprint_before', '') !~ '^[0-9a-f]{20}$'
     or jsonb_typeof(p_commit_context -> 'viewport_fingerprint_after') is distinct from 'string'
     or coalesce(p_commit_context ->> 'viewport_fingerprint_after', '') !~ '^[0-9a-f]{20}$'
     or p_commit_context ->> 'viewport_fingerprint_before'
       = p_commit_context ->> 'viewport_fingerprint_after' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_commit_context');
  end if;

  -- These values are emitted as JSON numbers by the Worker contract.
  if jsonb_typeof(p_commit_context -> 'source_attempt_id') is distinct from 'number'
     or coalesce(p_commit_context ->> 'source_attempt_id', '') !~ '^[1-9][0-9]{0,9}$'
     or jsonb_typeof(p_commit_context -> 'observed_scroll_index') is distinct from 'number'
     or coalesce(p_commit_context ->> 'observed_scroll_index', '') !~ '^[1-9][0-9]{0,9}$'
     or jsonb_typeof(p_commit_context -> 'overlap_count') is distinct from 'number'
     or coalesce(p_commit_context ->> 'overlap_count', '') !~ '^[1-9][0-9]{0,9}$'
     or jsonb_typeof(p_commit_context -> 'new_unique_rows') is distinct from 'number'
     or coalesce(p_commit_context ->> 'new_unique_rows', '') !~ '^[1-9][0-9]{0,9}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_commit_context');
  end if;

  v_source_request_id := (p_commit_context ->> 'source_request_id')::uuid;
  v_source_attempt_id := (p_commit_context ->> 'source_attempt_id')::bigint;

  if v_source_attempt_id > 2147483647
     or (p_commit_context ->> 'observed_scroll_index')::bigint > 80
     or (p_commit_context ->> 'overlap_count')::bigint > 2147483647
     or (p_commit_context ->> 'new_unique_rows')::bigint > 2147483647 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_commit_context');
  end if;

  v_observed_scroll_index := (p_commit_context ->> 'observed_scroll_index')::integer;
  v_overlap_count := (p_commit_context ->> 'overlap_count')::bigint;
  v_new_unique_rows := (p_commit_context ->> 'new_unique_rows')::bigint;

  -- account_run_requests is authoritative for request/run/attempt lineage.
  select *
  into v_request
  from public.account_run_requests as request_row
  where request_row.id = v_source_request_id
  for share;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'source_request_missing');
  end if;
  if v_request.account_id is distinct from p_account_id then
    return jsonb_build_object('ok', false, 'reason', 'source_request_account_mismatch');
  end if;
  if v_request.run_id is distinct from p_run_id then
    return jsonb_build_object('ok', false, 'reason', 'source_request_run_mismatch');
  end if;
  if v_request.requested_run_type <> 'account_session' then
    return jsonb_build_object('ok', false, 'reason', 'source_request_type_mismatch');
  end if;
  if v_request.status is distinct from 'running' then
    return jsonb_build_object('ok', false, 'reason', 'source_request_not_running');
  end if;

  -- run_id has no FK from account_run_requests and ig_runs.account_id is
  -- nullable in the canonical schema, so both are checked explicitly.
  select *
  into v_run
  from public.ig_runs as run_row
  where run_row.id = p_run_id
  for share;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'source_run_missing');
  end if;
  if v_run.account_id is distinct from p_account_id then
    return jsonb_build_object('ok', false, 'reason', 'source_run_account_mismatch');
  end if;
  if v_run.status is distinct from 'running' then
    return jsonb_build_object('ok', false, 'reason', 'source_run_not_running');
  end if;

  if not exists (
    select 1
    from public.ig_targets as target_row
    where target_row.id = p_target_id
      and target_row.account_id = p_account_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'target_account_mismatch');
  end if;

  v_request_metadata := coalesce(v_request.metadata_safe, '{}'::jsonb);
  if jsonb_typeof(v_request_metadata) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'reason', 'source_request_metadata_invalid');
  end if;

  if v_request_metadata ? 'resume_plan'
     and jsonb_typeof(v_request_metadata -> 'resume_plan') not in ('object', 'null') then
    return jsonb_build_object('ok', false, 'reason', 'source_request_resume_plan_invalid');
  end if;
  if jsonb_typeof(v_request_metadata -> 'resume_plan') = 'object' then
    v_resume_plan := v_request_metadata -> 'resume_plan';
  end if;
  if v_resume_plan ? 'account_id'
     and coalesce(v_resume_plan ->> 'account_id', '') <> p_account_id::text then
    return jsonb_build_object('ok', false, 'reason', 'source_request_resume_plan_account_mismatch');
  end if;

  v_retry_contract_present :=
       v_request_metadata ? 'attempt_id'
    or v_request_metadata ? 'current_attempt_id'
    or jsonb_typeof(v_request_metadata -> 'resume_plan') = 'object'
    or v_request_metadata ? 'resume_plan_version'
    or v_request_metadata ? 'retry_index'
    or v_request_metadata ? 'next_retry_index'
    or v_request_metadata ? 'previous_run_id'
    or v_request_metadata ? 'prior_run_id';

  -- Match the Worker/Backend selector exactly: an explicit top-level request
  -- attempt is authoritative. The embedded resume plan is consulted only when
  -- both top-level attempt fields are absent/empty. A stale embedded projection
  -- must never veto a newer claimed-request attempt.
  v_top_level_attempt_present :=
       (
         v_request_metadata ? 'attempt_id'
         and jsonb_typeof(v_request_metadata -> 'attempt_id') <> 'null'
         and coalesce(v_request_metadata ->> 'attempt_id', '') <> ''
       )
    or (
         v_request_metadata ? 'current_attempt_id'
         and jsonb_typeof(v_request_metadata -> 'current_attempt_id') <> 'null'
         and coalesce(v_request_metadata ->> 'current_attempt_id', '') <> ''
       );

  -- Duplicate attempt fields are validated only inside the selected layer.
  for v_raw in
    select attempts.raw_value
    from (
      values
        ('top', v_request_metadata -> 'attempt_id'),
        ('top', v_request_metadata -> 'current_attempt_id'),
        ('embedded', v_resume_plan -> 'attempt_id'),
        ('embedded', v_resume_plan -> 'current_attempt_id')
    ) as attempts(layer, raw_value)
    where attempts.raw_value is not null
      and jsonb_typeof(attempts.raw_value) <> 'null'
      and coalesce(attempts.raw_value #>> '{}', '') <> ''
      and (
        (v_top_level_attempt_present and attempts.layer = 'top')
        or (not v_top_level_attempt_present and attempts.layer = 'embedded')
      )
  loop
    v_attempt_field_count := v_attempt_field_count + 1;
    if jsonb_typeof(v_raw) not in ('number', 'string') then
      return jsonb_build_object('ok', false, 'reason', 'source_attempt_invalid');
    end if;
    v_scalar_text := btrim(v_raw #>> '{}');
    if v_scalar_text !~ '^[1-9][0-9]{0,9}$' then
      return jsonb_build_object('ok', false, 'reason', 'source_attempt_invalid');
    end if;
    v_attempt_candidate := v_scalar_text::bigint;
    if v_attempt_candidate > 2147483647 then
      return jsonb_build_object('ok', false, 'reason', 'source_attempt_invalid');
    end if;
    if v_canonical_attempt_id is null then
      v_canonical_attempt_id := v_attempt_candidate;
    elsif v_canonical_attempt_id <> v_attempt_candidate then
      return jsonb_build_object('ok', false, 'reason', 'source_attempt_divergence');
    end if;
  end loop;

  if v_attempt_field_count = 0 then
    if v_retry_contract_present then
      return jsonb_build_object('ok', false, 'reason', 'source_attempt_missing_for_retry');
    end if;
    v_canonical_attempt_id := 1;
  end if;

  if v_source_attempt_id <> v_canonical_attempt_id then
    return jsonb_build_object(
      'ok', false,
      'reason', 'source_attempt_mismatch',
      'canonical_attempt_id', v_canonical_attempt_id
    );
  end if;

  -- retry_index belongs to the same selected layer as attempt_id. The
  -- next_retry_index projection is deliberately not authoritative for the
  -- current claimed request and can legitimately describe a future retry.
  for v_raw in
    select retries.raw_value
    from (
      values
        ('top', v_request_metadata -> 'retry_index'),
        ('embedded', v_resume_plan -> 'retry_index')
    ) as retries(layer, raw_value)
    where retries.raw_value is not null
      and jsonb_typeof(retries.raw_value) <> 'null'
      and coalesce(retries.raw_value #>> '{}', '') <> ''
      and (
        (v_top_level_attempt_present and retries.layer = 'top')
        or (not v_top_level_attempt_present and retries.layer = 'embedded')
      )
  loop
    if jsonb_typeof(v_raw) not in ('number', 'string') then
      return jsonb_build_object('ok', false, 'reason', 'source_retry_index_invalid');
    end if;
    v_scalar_text := btrim(v_raw #>> '{}');
    if v_scalar_text !~ '^(0|[1-9][0-9]{0,9})$' then
      return jsonb_build_object('ok', false, 'reason', 'source_retry_index_invalid');
    end if;
    v_retry_index_candidate := v_scalar_text::bigint;
    if v_retry_index_candidate > 2147483646
       or v_retry_index_candidate <> v_canonical_attempt_id - 1 then
      return jsonb_build_object(
        'ok', false,
        'reason', 'source_retry_index_mismatch',
        'canonical_attempt_id', v_canonical_attempt_id
      );
    end if;
  end loop;

  -- V3 CAS, lease and monotonic-depth invariants are preserved.
  select *
  into v_row
  from public.ig_target_followers_resume_checkpoints as checkpoint_row
  where checkpoint_row.account_id = p_account_id
    and checkpoint_row.target_id = p_target_id
    and checkpoint_row.surface = p_surface
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'checkpoint_missing');
  end if;
  if v_row.checkpoint_version <> 3 then
    return jsonb_build_object('ok', false, 'reason', 'checkpoint_version_mismatch');
  end if;
  if v_row.status not in ('active', 'exhausted') then
    return jsonb_build_object(
      'ok', false,
      'reason', 'checkpoint_not_committable',
      'optimistic_version', v_row.optimistic_version
    );
  end if;
  if v_row.optimistic_version <> p_expected_version then
    return jsonb_build_object(
      'ok', false,
      'reason', 'optimistic_version_conflict',
      'optimistic_version', v_row.optimistic_version
    );
  end if;
  if v_row.lease_owner_run_id is distinct from p_run_id
     or v_row.lease_mode is distinct from p_mode then
    return jsonb_build_object(
      'ok', false,
      'reason', 'lease_owner_mismatch',
      'optimistic_version', v_row.optimistic_version
    );
  end if;
  if v_row.lease_expires_at is null or v_row.lease_expires_at <= now() then
    return jsonb_build_object(
      'ok', false,
      'reason', 'lease_expired',
      'optimistic_version', v_row.optimistic_version
    );
  end if;

  v_previous_depth := case
    when p_mode = 'enforce' then v_row.last_safe_depth
    else v_row.shadow_last_safe_depth
  end;

  if p_last_safe_depth <= v_previous_depth then
    return jsonb_build_object(
      'ok', false,
      'reason', case
        when p_last_safe_depth < v_previous_depth then 'depth_regression_rejected'
        else 'no_safe_progress_rejected'
      end,
      'previous_depth', v_previous_depth
    );
  end if;
  if p_last_safe_depth > v_previous_depth + 1 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'unproven_depth_jump_rejected',
      'previous_depth', v_previous_depth
    );
  end if;

  v_expiry := now() + make_interval(secs => p_lease_seconds);
  v_new_lease_generation := v_row.lease_generation + case when v_reclaimed then 1 else 0 end;
  v_event_metadata := p_commit_context || jsonb_build_object(
    'provenance_schema', 'target_followers_resume_commit_v1',
    'committed_via', 'commit_target_followers_resume_checkpoint_v4',
    'source_run_id', p_run_id,
    'source_request_status', v_request.status,
    'source_run_status', v_run.status,
    'checkpoint_version', v_row.checkpoint_version,
    'lease_generation', v_new_lease_generation,
    'status', p_status,
    'end_reached', p_end_reached,
    'anchor_count', jsonb_array_length(p_last_visible_anchor_hashes),
    'last_safe_anchor', p_last_safe_anchor,
    'anchor_fingerprint', p_anchor_fingerprint,
    'last_visible_anchor_hashes', p_last_visible_anchor_hashes,
    'lease_reclaimed', v_reclaimed
  );

  if jsonb_typeof(v_event_metadata) is distinct from 'object'
     or pg_column_size(v_event_metadata) > 4096 then
    return jsonb_build_object('ok', false, 'reason', 'commit_event_metadata_too_large');
  end if;

  update public.ig_target_followers_resume_checkpoints as checkpoint_row
  set
    last_safe_depth = case when p_mode = 'enforce' then p_last_safe_depth else checkpoint_row.last_safe_depth end,
    last_safe_anchor = case when p_mode = 'enforce' then p_last_safe_anchor else checkpoint_row.last_safe_anchor end,
    anchor_fingerprint = case when p_mode = 'enforce' then p_anchor_fingerprint else checkpoint_row.anchor_fingerprint end,
    last_visible_anchor_hashes = case when p_mode = 'enforce' then p_last_visible_anchor_hashes else checkpoint_row.last_visible_anchor_hashes end,
    shadow_last_safe_depth = case when p_mode = 'shadow' then p_last_safe_depth else checkpoint_row.shadow_last_safe_depth end,
    shadow_last_safe_anchor = case when p_mode = 'shadow' then p_last_safe_anchor else checkpoint_row.shadow_last_safe_anchor end,
    shadow_anchor_fingerprint = case when p_mode = 'shadow' then p_anchor_fingerprint else checkpoint_row.shadow_anchor_fingerprint end,
    shadow_visible_anchor_hashes = case when p_mode = 'shadow' then p_last_visible_anchor_hashes else checkpoint_row.shadow_visible_anchor_hashes end,
    last_run_id = p_run_id,
    last_reached_at = now(),
    last_verified_at = now(),
    last_instagram_version = p_last_instagram_version,
    status = p_status,
    end_reached = p_end_reached,
    invalidation_reason = null,
    lease_expires_at = v_expiry,
    lease_heartbeat_at = now(),
    lease_generation = v_new_lease_generation,
    optimistic_version = checkpoint_row.optimistic_version + 1,
    updated_at = now()
  where checkpoint_row.id = v_row.id
  returning checkpoint_row.optimistic_version, checkpoint_row.lease_generation
  into v_new_version, v_new_lease_generation;

  -- Deliberately uncaught: any event failure rolls back the checkpoint UPDATE.
  insert into public.ig_target_followers_resume_checkpoint_events(
    checkpoint_id, account_id, target_id, run_id, event_type, mode,
    previous_optimistic_version, new_optimistic_version,
    previous_depth, new_depth, reason, metadata
  ) values (
    v_row.id, p_account_id, p_target_id, p_run_id, 'committed', p_mode,
    v_row.optimistic_version, v_new_version,
    v_previous_depth, p_last_safe_depth, p_reason, v_event_metadata
  )
  returning id, created_at into v_commit_event_id, v_committed_at;

  return jsonb_build_object(
    'ok', true,
    'reason', 'committed',
    'optimistic_version', v_new_version,
    'depth', p_last_safe_depth,
    'checkpoint_version', v_row.checkpoint_version,
    'lease_generation', v_new_lease_generation,
    'lease_expires_at', v_expiry,
    'lease_reclaimed', v_reclaimed,
    'canonical_attempt_id', v_canonical_attempt_id,
    'provenance_persisted', true,
    'commit_event_id', v_commit_event_id,
    'committed_at', v_committed_at
  );
end
$function$;

alter function public.commit_target_followers_resume_checkpoint_v4(
  uuid,uuid,text,uuid,text,bigint,integer,jsonb,
  text,text,jsonb,text,text,boolean,text,integer
) owner to postgres;

revoke all on function public.commit_target_followers_resume_checkpoint_v4(
  uuid,uuid,text,uuid,text,bigint,integer,jsonb,
  text,text,jsonb,text,text,boolean,text,integer
) from public, anon, authenticated, service_role;

grant execute on function public.commit_target_followers_resume_checkpoint_v4(
  uuid,uuid,text,uuid,text,bigint,integer,jsonb,
  text,text,jsonb,text,text,boolean,text,integer
) to service_role;

comment on function public.commit_target_followers_resume_checkpoint_v4(
  uuid,uuid,text,uuid,text,bigint,integer,jsonb,
  text,text,jsonb,text,text,boolean,text,integer
) is
'Atomically commits CT Resume V2 checkpoint progress and immutable request/run/release provenance. service_role only.';

notify pgrst, 'reload schema';

commit;
