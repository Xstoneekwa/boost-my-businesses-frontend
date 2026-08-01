-- Follow 60 canary runtime binding V2: account-neutral, control-driven binder.
-- Source-only delivery. This migration does not arm a control or create a run.

drop function if exists public.bind_follow_60s_canary_runtime_v2(
  uuid, uuid, uuid, integer, text
);

create unique index if not exists follow_60s_canary_controls_control_id_uidx
  on public.follow_60s_canary_controls ((metadata_safe->>'control_id'))
  where nullif(pg_catalog.btrim(metadata_safe->>'control_id'), '') is not null;

create function public.bind_follow_60s_canary_runtime_v2(
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
  v_request public.account_run_requests%rowtype;
  v_run public.ig_runs%rowtype;
  v_metadata jsonb;
  v_baseline jsonb;
  v_active_control_count integer := 0;
  v_current_new_cycle_count integer := 0;
  v_max_new_cycles integer := 0;
  v_expected_worker_sha text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_expected_worker_sha, '')));
  v_baseline_release_sha text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_baseline_release_sha, '')));
  v_business_session_id text := pg_catalog.btrim(coalesce(p_business_session_id, ''));
  v_binding_version text := pg_catalog.btrim(coalesce(p_binding_version, ''));
  v_bound_attempt_id integer;
  v_bound_business_session_id text;
  v_armed_at timestamptz;
  v_expires_at timestamptz;
  v_baseline_captured_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_control_id is null or p_account_id is null then
    raise exception 'control_not_found' using errcode = 'P0001';
  end if;
  if v_binding_version <> 'FOLLOW_60S_CANARY_BINDING_V2' then
    raise exception 'binding_version_mismatch' using errcode = 'P0001';
  end if;
  if v_expected_worker_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'worker_sha_mismatch' using errcode = 'P0001';
  end if;
  if v_baseline_release_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'baseline_release_mismatch' using errcode = 'P0001';
  end if;
  if p_run_request_id is null then
    raise exception 'request_mismatch' using errcode = 'P0001';
  end if;
  if p_run_id is null then
    raise exception 'run_mismatch' using errcode = 'P0001';
  end if;
  if coalesce(p_attempt_id, 0) < 1 then
    raise exception 'attempt_mismatch' using errcode = 'P0001';
  end if;
  if v_business_session_id = '' then
    raise exception 'business_session_mismatch' using errcode = 'P0001';
  end if;

  -- A single global lock makes collision checks and control consumption
  -- deterministic while keeping the transaction bounded to three rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('follow60-canary-runtime-bind-v2', 0)
  );

  select * into v_run
    from public.ig_runs r
   where r.id = p_run_id
   for update;
  if not found or v_run.account_id is distinct from p_account_id then
    raise exception 'run_mismatch' using errcode = 'P0001';
  end if;

  select * into v_request
    from public.account_run_requests q
   where q.id = p_run_request_id
   for update;
  if not found
    or v_request.account_id is distinct from p_account_id
    or v_request.run_id is distinct from p_run_id then
    raise exception 'request_mismatch' using errcode = 'P0001';
  end if;

  select * into v_control
    from public.follow_60s_canary_controls c
   where c.metadata_safe->>'control_id' = p_control_id::text
   for update;
  if not found then
    raise exception 'control_not_found' using errcode = 'P0001';
  end if;
  if v_control.account_id is distinct from p_account_id then
    raise exception 'account_mismatch' using errcode = 'P0001';
  end if;
  if v_control.status <> 'armed' then
    raise exception 'control_not_armed' using errcode = 'P0001';
  end if;

  v_metadata := coalesce(v_control.metadata_safe, '{}'::jsonb);
  v_baseline := case
    when pg_catalog.jsonb_typeof(v_metadata->'baseline') = 'object'
      then v_metadata->'baseline'
    else '{}'::jsonb
  end;

  if nullif(pg_catalog.btrim(v_metadata->>'expected_worker_sha'), '') is null
    or nullif(pg_catalog.btrim(coalesce(
      v_metadata->>'baseline_release_sha', v_baseline->>'worker_sha'
    )), '') is null
    or nullif(pg_catalog.btrim(coalesce(
      v_metadata->>'baseline_account_id', v_baseline->>'account_id'
    )), '') is null
    or nullif(pg_catalog.btrim(coalesce(
      v_metadata->>'baseline_captured_at', v_baseline->>'captured_at'
    )), '') is null
    or nullif(pg_catalog.btrim(coalesce(
      v_metadata->>'baseline_timezone', v_baseline->>'timezone'
    )), '') is null
    or nullif(pg_catalog.btrim(v_metadata->>'binding_version'), '') is null
    or nullif(pg_catalog.btrim(v_metadata->>'idempotency_key'), '') is null
    or nullif(pg_catalog.btrim(v_metadata->>'created_by'), '') is null
    or nullif(pg_catalog.btrim(v_metadata->>'source'), '') is null
    or nullif(pg_catalog.btrim(v_metadata->>'armed_at'), '') is null
    or nullif(pg_catalog.btrim(v_metadata->>'expires_at'), '') is null then
    raise exception 'control_incomplete' using errcode = 'P0001';
  end if;
  if nullif(pg_catalog.btrim(v_metadata->>'completed_at'), '') is not null then
    raise exception 'control_not_armed' using errcode = 'P0001';
  end if;

  begin
    v_armed_at := (v_metadata->>'armed_at')::timestamptz;
    v_expires_at := (v_metadata->>'expires_at')::timestamptz;
    v_baseline_captured_at := coalesce(
      v_metadata->>'baseline_captured_at', v_baseline->>'captured_at'
    )::timestamptz;
  exception when others then
    raise exception 'control_incomplete' using errcode = 'P0001';
  end;
  if v_armed_at > pg_catalog.now() or v_baseline_captured_at > pg_catalog.now() then
    raise exception 'control_incomplete' using errcode = 'P0001';
  end if;

  if nullif(pg_catalog.btrim(v_metadata->>'revoked_at'), '') is not null then
    raise exception 'control_revoked' using errcode = 'P0001';
  end if;
  if v_expires_at <= pg_catalog.now() then
    raise exception 'control_expired' using errcode = 'P0001';
  end if;

  select pg_catalog.count(*)::integer into v_active_control_count
    from public.follow_60s_canary_controls c
   where c.status = 'armed';
  if v_active_control_count <> 1 then
    raise exception 'active_control_collision' using errcode = 'P0001';
  end if;

  if pg_catalog.lower(pg_catalog.btrim(coalesce(
       v_metadata->>'expected_worker_sha', ''
     ))) !~ '^[0-9a-f]{40}$'
    or pg_catalog.lower(pg_catalog.btrim(coalesce(
       v_metadata->>'expected_worker_sha', ''
     ))) <> v_expected_worker_sha then
    raise exception 'worker_sha_mismatch' using errcode = 'P0001';
  end if;
  if pg_catalog.lower(pg_catalog.btrim(coalesce(
       v_metadata->>'baseline_release_sha', v_baseline->>'worker_sha', ''
     ))) <> v_baseline_release_sha
    or coalesce(
      v_metadata->>'baseline_account_id', v_baseline->>'account_id', ''
    ) <> p_account_id::text then
    raise exception 'baseline_release_mismatch' using errcode = 'P0001';
  end if;
  if coalesce(v_metadata->>'binding_version', '') <> v_binding_version then
    raise exception 'binding_version_mismatch' using errcode = 'P0001';
  end if;

  if coalesce(v_metadata->>'baseline_package', v_baseline->>'package', '') = ''
    or coalesce(v_metadata->>'expected_package', '') = ''
    or coalesce(v_metadata->>'baseline_package', v_baseline->>'package', '')
       <> v_metadata->>'expected_package' then
    raise exception 'package_mismatch' using errcode = 'P0001';
  end if;
  if coalesce(
       (v_metadata->>'baseline_warmup_ready')::boolean,
       (v_baseline->>'warmup_ready')::boolean,
       false
     ) is not true then
    raise exception 'warmup_mismatch' using errcode = 'P0001';
  end if;
  if coalesce(v_metadata->>'expected_run_type', 'account_session')
       <> coalesce(v_request.requested_run_type, '') then
    raise exception 'request_mismatch' using errcode = 'P0001';
  end if;

  if coalesce(v_metadata->>'current_new_cycle_count', v_metadata->>'new_follow_count', '0') !~ '^[0-9]+$'
    or coalesce(v_metadata->>'max_new_cycles', v_control.evaluation_increment::text, '') !~ '^[0-9]+$' then
    raise exception 'max_cycles_reached' using errcode = 'P0001';
  end if;
  v_current_new_cycle_count := coalesce(
    nullif(v_metadata->>'current_new_cycle_count', '')::integer,
    nullif(v_metadata->>'new_follow_count', '')::integer,
    0
  );
  v_max_new_cycles := coalesce(
    nullif(v_metadata->>'max_new_cycles', '')::integer,
    v_control.evaluation_increment
  );
  if v_max_new_cycles < 1
    or v_current_new_cycle_count < 0
    or v_current_new_cycle_count >= v_max_new_cycles
    or v_control.baseline_follow_count + v_current_new_cycle_count >= v_control.target_follow_count then
    raise exception 'max_cycles_reached' using errcode = 'P0001';
  end if;

  if v_control.run_id is not null and v_control.run_id is distinct from p_run_id then
    raise exception 'run_mismatch' using errcode = 'P0001';
  end if;
  if v_control.request_id is not null and v_control.request_id is distinct from p_run_request_id then
    raise exception 'request_mismatch' using errcode = 'P0001';
  end if;

  v_bound_attempt_id := nullif(v_metadata->>'attempt_id', '')::integer;
  if v_bound_attempt_id is not null and v_bound_attempt_id is distinct from p_attempt_id then
    raise exception 'attempt_mismatch' using errcode = 'P0001';
  end if;
  v_bound_business_session_id := nullif(pg_catalog.btrim(v_metadata->>'business_session_id'), '');
  if v_bound_business_session_id is not null
    and v_bound_business_session_id is distinct from v_business_session_id then
    raise exception 'business_session_mismatch' using errcode = 'P0001';
  end if;
  if coalesce((v_metadata->>'runtime_binding_consumed')::boolean, false) then
    raise exception 'binding_already_consumed' using errcode = 'P0001';
  end if;

  update public.follow_60s_canary_controls c
     set run_id = p_run_id,
         request_id = p_run_request_id,
         metadata_safe = v_metadata || pg_catalog.jsonb_build_object(
           'runtime_binding_schema', 'FOLLOW_60S_RUNTIME_BINDING_V2',
           'binding_version', v_binding_version,
           'runtime_binding_consumed', true,
           'attempt_id', p_attempt_id,
           'business_session_id', v_business_session_id,
           'bound_at', pg_catalog.now()
         ),
         updated_at = pg_catalog.now()
   where c.account_id = p_account_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'binding_valid', true,
    'control_id', p_control_id,
    'account_id', p_account_id,
    'expected_username', coalesce(v_metadata->>'expected_username', ''),
    'expected_worker_sha', v_expected_worker_sha,
    'baseline_release_sha', v_baseline_release_sha,
    'baseline_account_id', p_account_id,
    'baseline_captured_at', coalesce(v_metadata->>'baseline_captured_at', v_baseline->>'captured_at'),
    'baseline_timezone', coalesce(v_metadata->>'baseline_timezone', v_baseline->>'timezone'),
    'baseline_package', coalesce(v_metadata->>'baseline_package', v_baseline->>'package'),
    'baseline_warmup_ready', true,
    'baseline_follow_count', v_control.baseline_follow_count,
    'max_new_cycles', v_max_new_cycles,
    'current_new_cycle_count', v_current_new_cycle_count,
    'status', v_control.status,
    'armed_at', v_metadata->>'armed_at',
    'expires_at', v_metadata->>'expires_at',
    'business_session_id', v_business_session_id,
    'expected_package', v_metadata->>'expected_package',
    'expected_run_type', coalesce(v_metadata->>'expected_run_type', 'account_session'),
    'binding_version', v_binding_version,
    'idempotency_key', v_metadata->>'idempotency_key',
    'created_by', v_metadata->>'created_by',
    'source', v_metadata->>'source',
    'revoked_at', v_metadata->>'revoked_at',
    'completed_at', v_metadata->>'completed_at',
    'active_control_count', v_active_control_count,
    'run_id', p_run_id,
    'request_id', p_run_request_id,
    'attempt_id', p_attempt_id,
    'evaluation_increment', v_control.evaluation_increment,
    'target_follow_count', v_control.target_follow_count
  );
end;
$$;

revoke all on function public.bind_follow_60s_canary_runtime_v2(
  uuid, uuid, text, text, uuid, uuid, integer, text, text
) from public, anon, authenticated;
grant execute on function public.bind_follow_60s_canary_runtime_v2(
  uuid, uuid, text, text, uuid, uuid, integer, text, text
) to service_role;
