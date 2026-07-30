\set ON_ERROR_STOP on

-- LOCAL POSTGRESQL CONTRACT TEST ONLY. Never run against production.
-- The database used by this scenario must be disposable.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    create role postgres nologin superuser;
  end if;
  alter role postgres superuser;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists public;

create table public.ig_accounts (
  id uuid primary key
);

create table public.ig_targets (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id)
);

create table public.ig_runs (
  id uuid primary key,
  account_id uuid references public.ig_accounts(id),
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  performance_summary jsonb
);

-- Deliberately no FK from run_id to ig_runs: this mirrors the production
-- lineage gap that V4 must validate explicitly.
create table public.account_run_requests (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id),
  requested_run_type text not null,
  status text not null,
  run_id uuid,
  metadata_safe jsonb not null default '{}'::jsonb
);

\ir ../migrations/20260727094636_target_followers_resume_v2_lease_privacy.sql

-- Reproduce the canonical dump drift before applying V4.
alter table public.ig_target_followers_resume_checkpoints
  alter column checkpoint_version set default 2;

\ir ../migrations/20260731003500_target_followers_resume_commit_provenance_v4.sql

do $security_contract$
declare
  v_rpc regprocedure := to_regprocedure(
    'public.commit_target_followers_resume_checkpoint_v4(uuid,uuid,text,uuid,text,bigint,integer,jsonb,text,text,jsonb,text,text,boolean,text,integer)'
  );
  v_default text;
begin
  if v_rpc is null then
    raise exception 'v4_rpc_missing';
  end if;

  if has_function_privilege('anon', v_rpc, 'execute') then
    raise exception 'anon_v4_execute_granted';
  end if;
  if has_function_privilege('authenticated', v_rpc, 'execute') then
    raise exception 'authenticated_v4_execute_granted';
  end if;
  if not has_function_privilege('service_role', v_rpc, 'execute') then
    raise exception 'service_role_v4_execute_missing';
  end if;

  if not exists (
    select 1
    from pg_proc as procedure_row
    where procedure_row.oid = v_rpc
      and procedure_row.prosecdef
      and procedure_row.proowner = (
        select role_row.oid
        from pg_roles as role_row
        where role_row.rolname = 'postgres'
      )
      and coalesce(procedure_row.proconfig, '{}'::text[])
        @> array['search_path=""']::text[]
  ) then
    raise exception 'v4_security_definer_contract_invalid';
  end if;

  if not exists (
    select 1
    from pg_class as relation_row
    join pg_namespace as namespace_row
      on namespace_row.oid = relation_row.relnamespace
    where namespace_row.nspname = 'public'
      and relation_row.relname in (
        'ig_target_followers_resume_checkpoints',
        'ig_target_followers_resume_checkpoint_events'
      )
      and relation_row.relrowsecurity
    group by namespace_row.nspname
    having count(*) = 2
  ) then
    raise exception 'checkpoint_rls_contract_invalid';
  end if;

  select column_default
  into v_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ig_target_followers_resume_checkpoints'
    and column_name = 'checkpoint_version';

  if v_default is null or v_default !~ '^3' then
    raise exception 'checkpoint_version_default_not_three: %', v_default;
  end if;
end
$security_contract$;

-- All business fixtures, the forced-failure trigger and its helper are
-- transaction-scoped and disappear at ROLLBACK.
begin;

insert into public.ig_accounts(id)
values ('10000000-0000-4000-8000-000000000001');

insert into public.ig_targets(id, account_id)
values
  (
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '10000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '10000000-0000-4000-8000-000000000022',
    '10000000-0000-4000-8000-000000000001'
  );

insert into public.ig_runs(id, account_id, status)
values
  (
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'running'
  ),
  (
    '10000000-0000-4000-8000-000000000013',
    '10000000-0000-4000-8000-000000000001',
    'running'
  ),
  (
    '10000000-0000-4000-8000-000000000023',
    '10000000-0000-4000-8000-000000000001',
    'running'
  );

insert into public.account_run_requests(
  id,
  account_id,
  requested_run_type,
  status,
  run_id,
  metadata_safe
) values
  (
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    'account_session',
    'running',
    '10000000-0000-4000-8000-000000000003',
    jsonb_build_object(
      'attempt_id', 2,
      'retry_index', 1,
      'resume_plan', jsonb_build_object(
        'account_id', '10000000-0000-4000-8000-000000000001',
        'attempt_id', 1,
        'retry_index', 0,
        'next_retry_index', 1
      )
    )
  ),
  (
    '10000000-0000-4000-8000-000000000014',
    '10000000-0000-4000-8000-000000000001',
    'account_session',
    'running',
    '10000000-0000-4000-8000-000000000013',
    jsonb_build_object(
      'attempt_id', 3,
      'retry_index', 2,
      'resume_plan', jsonb_build_object(
        'account_id', '10000000-0000-4000-8000-000000000001',
        'attempt_id', 1,
        'retry_index', 0,
        'next_retry_index', 2
      )
    )
  ),
  (
    '10000000-0000-4000-8000-000000000024',
    '10000000-0000-4000-8000-000000000001',
    'account_session',
    'running',
    '10000000-0000-4000-8000-000000000023',
    jsonb_build_object(
      'resume_plan', jsonb_build_object(
        'account_id', '10000000-0000-4000-8000-000000000001',
        'current_attempt_id', 2,
        'retry_index', 1,
        'next_retry_index', 1
      )
    )
  );

-- checkpoint_version is intentionally omitted to certify the corrected default.
insert into public.ig_target_followers_resume_checkpoints(
  id,
  account_id,
  target_id,
  surface,
  lease_owner_run_id,
  lease_mode,
  lease_expires_at,
  lease_heartbeat_at,
  last_run_id
) values
  (
    '10000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow',
    now() + interval '30 minutes',
    now(),
    '10000000-0000-4000-8000-000000000003'
  ),
  (
    '10000000-0000-4000-8000-000000000015',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000012',
    'followers',
    '10000000-0000-4000-8000-000000000013',
    'shadow',
    now() + interval '30 minutes',
    now(),
    '10000000-0000-4000-8000-000000000013'
  ),
  (
    '10000000-0000-4000-8000-000000000025',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000022',
    'followers',
    '10000000-0000-4000-8000-000000000023',
    'shadow',
    now() + interval '30 minutes',
    now(),
    '10000000-0000-4000-8000-000000000023'
  );

do $selected_attempt_layer$
declare
  v_result jsonb;
begin
  -- A claimed request attempt 3 must override its stale embedded attempt 1.
  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000012',
    'followers',
    '10000000-0000-4000-8000-000000000013',
    'shadow',
    1,
    1,
    jsonb_build_object(
      'source_request_id', '10000000-0000-4000-8000-000000000014',
      'source_attempt_id', 3,
      'release_sha', repeat('a', 40),
      'observed_scroll_index', 1,
      'overlap_count', 2,
      'new_unique_rows', 7,
      'viewport_fingerprint_before', repeat('1', 20),
      'viewport_fingerprint_after', repeat('2', 20)
    ),
    'a3:' || repeat('1', 32),
    'v3:' || repeat('2', 32),
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test',
    'active',
    false,
    'validated_transition',
    3600
  ) into v_result;

  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'canonical_attempt_id')::integer <> 3 then
    raise exception 'top_level_attempt_3_did_not_override_stale_plan: %', v_result;
  end if;

  -- With no top-level attempt, embedded current_attempt_id 2 is canonical.
  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000022',
    'followers',
    '10000000-0000-4000-8000-000000000023',
    'shadow',
    1,
    1,
    jsonb_build_object(
      'source_request_id', '10000000-0000-4000-8000-000000000024',
      'source_attempt_id', 2,
      'release_sha', repeat('a', 40),
      'observed_scroll_index', 1,
      'overlap_count', 2,
      'new_unique_rows', 7,
      'viewport_fingerprint_before', repeat('3', 20),
      'viewport_fingerprint_after', repeat('4', 20)
    ),
    'a3:' || repeat('3', 32),
    'v3:' || repeat('4', 32),
    jsonb_build_array('a3:' || repeat('3', 32)),
    'instagram-test',
    'active',
    false,
    'validated_transition',
    3600
  ) into v_result;

  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'canonical_attempt_id')::integer <> 2 then
    raise exception 'embedded_only_current_attempt_2_not_accepted: %', v_result;
  end if;
end
$selected_attempt_layer$;

do $provenance_and_cas$
declare
  v_context jsonb := jsonb_build_object(
    'source_request_id', '10000000-0000-4000-8000-000000000004',
    'source_attempt_id', 2,
    'release_sha', repeat('a', 40),
    'observed_scroll_index', 1,
    'overlap_count', 2,
    'new_unique_rows', 7,
    'viewport_fingerprint_before', repeat('b', 20),
    'viewport_fingerprint_after', repeat('c', 20)
  );
  v_result jsonb;
  v_event_count integer;
begin
  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow', 1, 1, v_context,
    'a3:' || repeat('1', 32), 'v3:' || repeat('2', 32),
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test', null, false, 'validated_transition', 3600
  ) into v_result;

  if v_result ->> 'reason' <> 'invalid_commit_input' then
    raise exception 'null_status_not_rejected_stably: %', v_result;
  end if;

  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow', 1, 1, v_context,
    'a3:' || repeat('1', 32), 'v3:' || repeat('2', 32),
    jsonb_build_array(null),
    'instagram-test', 'active', false, 'validated_transition', 3600
  ) into v_result;

  if v_result ->> 'reason' <> 'invalid_commit_input' then
    raise exception 'null_anchor_hash_not_rejected: %', v_result;
  end if;

  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow', 1, 1, v_context,
    null, 'v3:' || repeat('2', 32),
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test', 'active', false, 'validated_transition', 3600
  ) into v_result;
  if v_result ->> 'reason' <> 'invalid_commit_input' then
    raise exception 'missing_safe_anchor_not_rejected: %', v_result;
  end if;

  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow', 1, 1, v_context,
    'a3:' || repeat('1', 32), null,
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test', 'active', false, 'validated_transition', 3600
  ) into v_result;
  if v_result ->> 'reason' <> 'invalid_commit_input' then
    raise exception 'missing_anchor_fingerprint_not_rejected: %', v_result;
  end if;

  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow', 1, 1, v_context,
    'a3:' || repeat('1', 32), 'v3:' || repeat('2', 32),
    '[]'::jsonb,
    'instagram-test', 'active', false, 'validated_transition', 3600
  ) into v_result;
  if v_result ->> 'reason' <> 'invalid_commit_input' then
    raise exception 'empty_anchor_window_not_rejected: %', v_result;
  end if;

  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow', 1, 1, v_context,
    'a3:' || repeat('9', 32), 'v3:' || repeat('2', 32),
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test', 'active', false, 'validated_transition', 3600
  ) into v_result;
  if v_result ->> 'reason' <> 'invalid_commit_input' then
    raise exception 'safe_anchor_tail_mismatch_not_rejected: %', v_result;
  end if;

  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow', 1, 2, v_context,
    'a3:' || repeat('1', 32), 'v3:' || repeat('2', 32),
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test', 'active', false, 'validated_transition', 3600
  ) into v_result;

  if v_result ->> 'reason' <> 'unproven_depth_jump_rejected' then
    raise exception 'depth_jump_not_rejected: %', v_result;
  end if;

  update public.account_run_requests
  set status = 'completed'
  where id = '10000000-0000-4000-8000-000000000004';

  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow', 1, 1, v_context,
    'a3:' || repeat('1', 32), 'v3:' || repeat('2', 32),
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test', 'active', false, 'validated_transition', 3600
  ) into v_result;

  if v_result ->> 'reason' <> 'source_request_not_running' then
    raise exception 'terminal_request_not_rejected: %', v_result;
  end if;
  update public.account_run_requests
  set status = 'running'
  where id = '10000000-0000-4000-8000-000000000004';

  update public.ig_runs
  set status = 'completed'
  where id = '10000000-0000-4000-8000-000000000003';

  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow', 1, 1, v_context,
    'a3:' || repeat('1', 32), 'v3:' || repeat('2', 32),
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test', 'active', false, 'validated_transition', 3600
  ) into v_result;

  if v_result ->> 'reason' <> 'source_run_not_running' then
    raise exception 'terminal_run_not_rejected: %', v_result;
  end if;
  update public.ig_runs
  set status = 'running'
  where id = '10000000-0000-4000-8000-000000000003';

  update public.ig_target_followers_resume_checkpoints
  set lease_expires_at = now() - interval '1 second'
  where id = '10000000-0000-4000-8000-000000000005';

  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow', 1, 1, v_context,
    'a3:' || repeat('1', 32), 'v3:' || repeat('2', 32),
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test', 'active', false, 'validated_transition', 3600
  ) into v_result;

  if v_result ->> 'reason' <> 'lease_expired' then
    raise exception 'expired_lease_not_rejected: %', v_result;
  end if;
  update public.ig_target_followers_resume_checkpoints
  set lease_expires_at = now() + interval '30 minutes'
  where id = '10000000-0000-4000-8000-000000000005';

  -- Whitespace is an explicit invalid top-level field, never an invitation to
  -- fall back to a stale embedded attempt.
  update public.account_run_requests
  set metadata_safe = jsonb_set(metadata_safe, '{attempt_id}', '"   "'::jsonb)
  where id = '10000000-0000-4000-8000-000000000004';

  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow', 1, 1, v_context,
    'a3:' || repeat('1', 32), 'v3:' || repeat('2', 32),
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test', 'active', false, 'validated_transition', 3600
  ) into v_result;

  if v_result ->> 'reason' <> 'source_attempt_invalid' then
    raise exception 'whitespace_top_attempt_fell_back_to_embedded: %', v_result;
  end if;
  update public.account_run_requests
  set metadata_safe = jsonb_set(metadata_safe, '{attempt_id}', '2'::jsonb)
  where id = '10000000-0000-4000-8000-000000000004';

  -- Divergent duplicate fields inside the selected top-level layer fail closed.
  update public.account_run_requests
  set metadata_safe = jsonb_set(metadata_safe, '{current_attempt_id}', '3'::jsonb)
  where id = '10000000-0000-4000-8000-000000000004';

  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow',
    1,
    1,
    v_context,
    'a3:' || repeat('1', 32),
    'v3:' || repeat('2', 32),
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test',
    'active',
    false,
    'validated_transition',
    3600
  ) into v_result;

  if v_result ->> 'reason' <> 'source_attempt_divergence' then
    raise exception 'top_level_attempt_divergence_not_rejected: %', v_result;
  end if;

  update public.account_run_requests
  set metadata_safe = metadata_safe - 'current_attempt_id'
  where id = '10000000-0000-4000-8000-000000000004';

  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow',
    1,
    1,
    jsonb_set(v_context, '{source_attempt_id}', '3'::jsonb),
    'a3:' || repeat('1', 32),
    'v3:' || repeat('2', 32),
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test',
    'active',
    false,
    'validated_transition',
    3600
  ) into v_result;

  if v_result ->> 'reason' <> 'source_attempt_mismatch' then
    raise exception 'source_attempt_mismatch_not_rejected: %', v_result;
  end if;
  if (select optimistic_version from public.ig_target_followers_resume_checkpoints
      where id = '10000000-0000-4000-8000-000000000005') <> 1 then
    raise exception 'rejected_provenance_changed_version';
  end if;
  if exists (
    select 1 from public.ig_target_followers_resume_checkpoint_events
    where checkpoint_id = '10000000-0000-4000-8000-000000000005'
  ) then
    raise exception 'rejected_provenance_created_event';
  end if;

  -- Provenance cannot create a committed event without positive safe depth.
  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow',
    1,
    0,
    v_context,
    'a3:' || repeat('1', 32),
    'v3:' || repeat('2', 32),
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test',
    'active',
    false,
    'validated_transition',
    3600
  ) into v_result;

  if v_result ->> 'reason' <> 'no_safe_progress_rejected' then
    raise exception 'zero_depth_commit_not_rejected: %', v_result;
  end if;

  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow',
    1,
    1,
    v_context,
    'a3:' || repeat('1', 32),
    'v3:' || repeat('2', 32),
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test',
    'active',
    false,
    'validated_transition',
    3600
  ) into v_result;

  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or coalesce((v_result ->> 'provenance_persisted')::boolean, false) is not true
     or v_result ->> 'commit_event_id' is null
     or (v_result ->> 'canonical_attempt_id')::integer <> 2 then
    raise exception 'valid_v4_commit_failed: %', v_result;
  end if;

  if (select shadow_last_safe_depth from public.ig_target_followers_resume_checkpoints
      where id = '10000000-0000-4000-8000-000000000005') <> 1
     or (select optimistic_version from public.ig_target_followers_resume_checkpoints
         where id = '10000000-0000-4000-8000-000000000005') <> 2 then
    raise exception 'valid_v4_checkpoint_state_invalid';
  end if;

  select count(*) into v_event_count
  from public.ig_target_followers_resume_checkpoint_events as event_row
  where event_row.id = (v_result ->> 'commit_event_id')::uuid
    and event_row.checkpoint_id = '10000000-0000-4000-8000-000000000005'
    and event_row.run_id = '10000000-0000-4000-8000-000000000003'
    and event_row.event_type = 'committed'
    and event_row.new_depth = 1
    and event_row.metadata ->> 'source_request_id'
      = '10000000-0000-4000-8000-000000000004'
    and (event_row.metadata ->> 'source_attempt_id')::integer = 2
    and event_row.metadata ->> 'release_sha' = repeat('a', 40)
    and event_row.metadata ->> 'viewport_fingerprint_before' = repeat('b', 20)
    and event_row.metadata ->> 'viewport_fingerprint_after' = repeat('c', 20);

  if v_event_count <> 1 then
    raise exception 'atomic_provenance_event_missing';
  end if;

  -- Idempotent CAS rejection: no second event can be created.
  select public.commit_target_followers_resume_checkpoint_v4(
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'followers',
    '10000000-0000-4000-8000-000000000003',
    'shadow',
    1,
    1,
    v_context,
    'a3:' || repeat('1', 32),
    'v3:' || repeat('2', 32),
    jsonb_build_array('a3:' || repeat('1', 32)),
    'instagram-test',
    'active',
    false,
    'validated_transition',
    3600
  ) into v_result;

  if v_result ->> 'reason' <> 'optimistic_version_conflict' then
    raise exception 'duplicate_cas_not_rejected: %', v_result;
  end if;
  if (select count(*) from public.ig_target_followers_resume_checkpoint_events
      where checkpoint_id = '10000000-0000-4000-8000-000000000005'
        and event_type = 'committed') <> 1 then
    raise exception 'duplicate_cas_created_event';
  end if;
end
$provenance_and_cas$;

create function public.__ct_resume_v4_test_reject_event()
returns trigger
language plpgsql
as $test_trigger$
begin
  if new.event_type = 'committed'
     and new.reason = 'test_forced_event_failure' then
    raise exception 'ct_resume_v4_forced_event_failure';
  end if;
  return new;
end
$test_trigger$;

create trigger __ct_resume_v4_force_event_failure
before insert on public.ig_target_followers_resume_checkpoint_events
for each row
execute function public.__ct_resume_v4_test_reject_event();

do $atomic_failure$
declare
  v_failed_as_expected boolean := false;
begin
  begin
    perform public.commit_target_followers_resume_checkpoint_v4(
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      'followers',
      '10000000-0000-4000-8000-000000000003',
      'shadow',
      2,
      2,
      jsonb_build_object(
        'source_request_id', '10000000-0000-4000-8000-000000000004',
        'source_attempt_id', 2,
        'release_sha', repeat('a', 40),
        'observed_scroll_index', 2,
        'overlap_count', 2,
        'new_unique_rows', 7,
        'viewport_fingerprint_before', repeat('c', 20),
        'viewport_fingerprint_after', repeat('d', 20)
      ),
      'a3:' || repeat('3', 32),
      'v3:' || repeat('4', 32),
      jsonb_build_array('a3:' || repeat('3', 32)),
      'instagram-test',
      'active',
      false,
      'test_forced_event_failure',
      3600
    );
  exception
    when others then
      if position('ct_resume_v4_forced_event_failure' in sqlerrm) = 0 then
        raise;
      end if;
      v_failed_as_expected := true;
  end;

  if not v_failed_as_expected then
    raise exception 'forced_event_failure_not_observed';
  end if;
  if (select optimistic_version from public.ig_target_followers_resume_checkpoints
      where id = '10000000-0000-4000-8000-000000000005') <> 2
     or (select shadow_last_safe_depth from public.ig_target_followers_resume_checkpoints
         where id = '10000000-0000-4000-8000-000000000005') <> 1 then
    raise exception 'event_failure_did_not_rollback_checkpoint';
  end if;
  if (select count(*) from public.ig_target_followers_resume_checkpoint_events
      where checkpoint_id = '10000000-0000-4000-8000-000000000005'
        and event_type = 'committed') <> 1 then
    raise exception 'event_failure_left_partial_event';
  end if;
end
$atomic_failure$;

rollback;

select 'target_followers_resume_commit_provenance_v4_ok' as result;
