-- Follow60 durable run-scoped evaluation ledger.
-- Additive/source-only: applying this migration never arms or starts a run.

create table if not exists public.follow_60s_completed_cycle_ledger (
  control_id uuid not null,
  action_id_hash text not null,
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  run_id uuid not null references public.ig_runs(id) on delete cascade,
  request_id uuid not null references public.account_run_requests(id) on delete cascade,
  attempt_id integer not null,
  business_session_id text not null,
  candidate_username text not null,
  source_profile text not null,
  worker_sha text not null,
  like_terminal_status text not null,
  like_terminal_reason text not null,
  revision bigint not null,
  created_at timestamptz not null default pg_catalog.now(),
  metadata_safe jsonb not null default '{}'::jsonb,
  primary key (control_id, action_id_hash),
  unique (control_id, revision),
  constraint follow_60s_completed_cycle_action_hash_check
    check (action_id_hash ~ '^[0-9a-f]{64}$'),
  constraint follow_60s_completed_cycle_worker_sha_check
    check (worker_sha ~ '^[0-9a-f]{40}$'),
  constraint follow_60s_completed_cycle_attempt_check check (attempt_id >= 1),
  constraint follow_60s_completed_cycle_like_terminal_check
    check (like_terminal_status in ('verified', 'safe_skip')),
  constraint follow_60s_completed_cycle_metadata_check
    check (pg_catalog.jsonb_typeof(metadata_safe) = 'object')
);

create index if not exists follow_60s_completed_cycle_run_idx
  on public.follow_60s_completed_cycle_ledger (account_id, run_id, revision);

alter table public.follow_60s_completed_cycle_ledger enable row level security;
revoke all on table public.follow_60s_completed_cycle_ledger
  from public, anon, authenticated;
grant select, insert on table public.follow_60s_completed_cycle_ledger to service_role;

create or replace function public.ack_follow_60s_completed_cycle_v1(
  p_control_id uuid,
  p_account_id uuid,
  p_run_id uuid,
  p_request_id uuid,
  p_action_id text,
  p_action_id_hash text,
  p_attempt_id integer,
  p_business_session_id text,
  p_candidate_username text,
  p_source_profile text,
  p_worker_sha text,
  p_like_terminal_status text,
  p_like_terminal_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control public.follow_60s_canary_controls%rowtype;
  v_meta jsonb;
  v_expected_hash text;
  v_candidate text := pg_catalog.lower(pg_catalog.ltrim(pg_catalog.btrim(coalesce(p_candidate_username, '')), '@'));
  v_source text := pg_catalog.lower(pg_catalog.ltrim(pg_catalog.btrim(coalesce(p_source_profile, '')), '@'));
  v_cycle_was_new boolean := false;
  v_revision bigint := 0;
  v_count integer := 0;
  v_max_cycles integer := 0;
  v_barrier_target integer := 0;
  v_barrier_reached boolean := false;
  v_stage_prefix text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  v_expected_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(coalesce(p_action_id, ''), 'UTF8'), 'sha256'),
    'hex'
  );
  if p_control_id is null or p_account_id is null or p_run_id is null
    or p_request_id is null or nullif(pg_catalog.btrim(p_action_id), '') is null
    or p_action_id_hash !~ '^[0-9a-f]{64}$'
    or p_action_id_hash <> v_expected_hash
    or coalesce(p_attempt_id, 0) < 1
    or nullif(pg_catalog.btrim(p_business_session_id), '') is null
    or nullif(v_candidate, '') is null or nullif(v_source, '') is null
    or lower(coalesce(p_worker_sha, '')) !~ '^[0-9a-f]{40}$'
    or p_like_terminal_status not in ('verified', 'safe_skip')
    or nullif(pg_catalog.btrim(p_like_terminal_reason), '') is null then
    raise exception 'follow60_cycle_ledger_binding_invalid' using errcode = '22023';
  end if;

  select * into v_control
    from public.follow_60s_canary_controls c
   where c.account_id = p_account_id
     and c.metadata_safe->>'control_id' = p_control_id::text
   for update;
  if not found then
    raise exception 'follow60_cycle_ledger_control_mismatch' using errcode = '55000';
  end if;
  v_meta := coalesce(v_control.metadata_safe, '{}'::jsonb);

  -- Idempotent replay remains legal after the barrier has been installed.
  if exists (
    select 1 from public.follow_60s_completed_cycle_ledger l
     where l.control_id = p_control_id and l.action_id_hash = p_action_id_hash
  ) then
    select l.revision into v_revision
      from public.follow_60s_completed_cycle_ledger l
     where l.control_id = p_control_id and l.action_id_hash = p_action_id_hash;
  elsif v_control.status <> 'running' then
    raise exception 'follow60_cycle_ledger_control_not_running' using errcode = '55000';
  end if;

  if v_control.run_id is distinct from p_run_id
    or v_control.request_id is distinct from p_request_id
    or coalesce((v_meta->>'attempt_id')::integer, 0) <> p_attempt_id
    or coalesce(v_meta->>'business_session_id', '') <> p_business_session_id
    or lower(coalesce(v_meta->>'expected_worker_sha', '')) <> lower(p_worker_sha)
    or lower(coalesce(v_meta->>'baseline_release_sha', '')) <> lower(p_worker_sha)
    or coalesce((v_meta->>'runtime_binding_consumed')::boolean, false) is not true
    or v_meta->>'baseline_account_id' <> p_account_id::text then
    raise exception 'follow60_cycle_ledger_runtime_binding_mismatch' using errcode = '55000';
  end if;

  perform 1 from public.ig_runs r
   where r.id = p_run_id and r.account_id = p_account_id for update;
  if not found then
    raise exception 'follow60_cycle_ledger_run_mismatch' using errcode = '23503';
  end if;
  perform 1 from public.account_run_requests q
   where q.id = p_request_id and q.account_id = p_account_id and q.run_id = p_run_id
   for update;
  if not found then
    raise exception 'follow60_cycle_ledger_request_mismatch' using errcode = '23503';
  end if;

  perform 1 from public.ig_interacted_users u
   where u.account_id = p_account_id and u.run_id = p_run_id
     and u.request_id = p_request_id
     and pg_catalog.lower(pg_catalog.ltrim(u.username, '@')) = v_candidate
     and u.interaction_type = 'follow' and u.was_successful is true
     and u.payload->>'action_id' = p_action_id;
  if not found then
    raise exception 'follow60_cycle_ledger_follow_missing' using errcode = '23503';
  end if;

  v_stage_prefix := 'follow60:v2:' || p_action_id_hash || ':';
  perform 1 from public.ig_interaction_events e
   where e.account_id = p_account_id and e.run_id = p_run_id
     and e.request_id = p_request_id and e.stage_idempotency_key = v_stage_prefix || 'mute_posts_verified'
     and e.event_status = 'success';
  if not found then raise exception 'follow60_cycle_ledger_mute_posts_missing' using errcode = '23503'; end if;
  perform 1 from public.ig_interaction_events e
   where e.account_id = p_account_id and e.run_id = p_run_id
     and e.request_id = p_request_id and e.stage_idempotency_key = v_stage_prefix || 'mute_stories_verified'
     and e.event_status = 'success';
  if not found then raise exception 'follow60_cycle_ledger_mute_stories_missing' using errcode = '23503'; end if;
  perform 1 from public.ig_interaction_events e
   where e.account_id = p_account_id and e.run_id = p_run_id
     and e.request_id = p_request_id and e.stage_idempotency_key = v_stage_prefix || 'return_ct_exact'
     and e.event_status = 'success';
  if not found then raise exception 'follow60_cycle_ledger_return_ct_missing' using errcode = '23503'; end if;
  if p_like_terminal_status = 'verified' then
    perform 1 from public.ig_interaction_events e
     where e.account_id = p_account_id and e.run_id = p_run_id
       and e.request_id = p_request_id and e.stage_idempotency_key = v_stage_prefix || 'like_verified'
       and e.event_status = 'success';
    if not found then raise exception 'follow60_cycle_ledger_like_missing' using errcode = '23503'; end if;
  end if;

  v_max_cycles := v_control.evaluation_increment;
  v_barrier_target := v_control.baseline_follow_count + v_max_cycles;
  if v_revision = 0 then
    select coalesce(max(l.revision), 0) + 1 into v_revision
      from public.follow_60s_completed_cycle_ledger l
     where l.control_id = p_control_id;
    insert into public.follow_60s_completed_cycle_ledger (
      control_id, action_id_hash, account_id, run_id, request_id, attempt_id,
      business_session_id, candidate_username, source_profile, worker_sha,
      like_terminal_status, like_terminal_reason, revision, metadata_safe
    ) values (
      p_control_id, p_action_id_hash, p_account_id, p_run_id, p_request_id, p_attempt_id,
      p_business_session_id, v_candidate, v_source, lower(p_worker_sha),
      p_like_terminal_status, p_like_terminal_reason, v_revision,
      pg_catalog.jsonb_build_object(
        'schema', 'FOLLOW60_RUN_SCOPED_CYCLE_LEDGER_V1',
        'control_id', p_control_id, 'action_id_hash', p_action_id_hash,
        'candidate_username', v_candidate, 'source_profile', v_source
      )
    ) on conflict (control_id, action_id_hash) do nothing;
    v_cycle_was_new := found;
  end if;

  select count(*)::integer into v_count
    from public.follow_60s_completed_cycle_ledger l
   where l.control_id = p_control_id and l.run_id = p_run_id
     and l.account_id = p_account_id;
  v_barrier_reached := v_count >= v_max_cycles;

  update public.follow_60s_canary_controls c set
    status = case when v_barrier_reached then 'waiting_operator_evaluation' else c.status end,
    barrier_reached_at = case when v_barrier_reached then coalesce(c.barrier_reached_at, pg_catalog.now()) else c.barrier_reached_at end,
    hold_armed_at = case when v_barrier_reached then coalesce(c.hold_armed_at, pg_catalog.now()) else c.hold_armed_at end,
    metadata_safe = coalesce(c.metadata_safe, '{}'::jsonb) || pg_catalog.jsonb_build_object(
      'cycle_ledger_schema', 'FOLLOW60_RUN_SCOPED_CYCLE_LEDGER_V1',
      'cycle_ledger_revision', v_revision,
      'current_new_cycle_count', v_count,
      'barrier_target', v_barrier_target,
      'barrier_reached', v_barrier_reached,
      'terminal_reason', case when v_barrier_reached then 'evaluation_barrier_reached' else c.metadata_safe->>'terminal_reason' end
    ),
    updated_at = pg_catalog.now()
   where c.account_id = p_account_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'schema', 'FOLLOW60_RUN_SCOPED_CYCLE_LEDGER_V1',
    'cycle_was_new', v_cycle_was_new,
    'new_cycle_count', v_count,
    'max_cycles', v_max_cycles,
    'barrier_target', v_barrier_target,
    'barrier_reached', v_barrier_reached,
    'next_candidate_permitted', not v_barrier_reached,
    'terminal_status', case when v_barrier_reached then 'completed_waiting_operator_evaluation' else '' end,
    'revision', v_revision,
    'control_id', p_control_id,
    'run_id', p_run_id,
    'request_id', p_request_id
  );
end;
$$;

revoke all on function public.ack_follow_60s_completed_cycle_v1(
  uuid,uuid,uuid,uuid,text,text,integer,text,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.ack_follow_60s_completed_cycle_v1(
  uuid,uuid,uuid,uuid,text,text,integer,text,text,text,text,text,text
) to service_role;
