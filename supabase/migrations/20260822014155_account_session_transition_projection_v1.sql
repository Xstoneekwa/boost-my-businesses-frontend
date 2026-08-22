-- account_session_transition_v1
-- Projection-only lifecycle derived from the authoritative ig_runs termination envelope.
-- This migration deliberately does not alter runtime scheduling, deadlines, Follow, or Unfollow.

create table if not exists public.account_session_transitions (
  id uuid primary key default gen_random_uuid(),
  schema_version text not null default 'account_session_transition_v1',
  transition_key text not null unique,
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  run_id uuid not null references public.ig_runs(id) on delete cascade,
  business_session_id text not null,
  attempt_id text not null,
  generation text not null,
  transition_context text not null check (transition_context = 'business_deadline'),
  transition_type text not null check (transition_type = 'follow_to_unfollow'),
  transition_state text not null check (transition_state in ('initiated', 'no_work', 'blocked', 'partial', 'completed')),
  first_causal_reason text not null,
  follow_stop_reason text,
  session_termination_class text,
  exact_stable_reason text,
  actionable_reason text,
  follows_completed integer,
  follows_remaining integer,
  safe_boundary boolean,
  unfollow_eligible boolean,
  unfollow_started boolean not null default false,
  unfollow_state text,
  backlog_remaining integer,
  next_step text,
  source_envelope jsonb not null,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists account_session_transitions_account_updated_idx
  on public.account_session_transitions(account_id, updated_at desc);

alter table public.account_session_transitions enable row level security;
revoke all on table public.account_session_transitions from anon, authenticated;
grant select, insert, update, delete on table public.account_session_transitions to service_role;

create or replace function public.project_account_session_transition_v1(
  p_account_id uuid,
  p_run_id uuid,
  p_performance_summary jsonb,
  p_source_updated_at timestamptz default null
) returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_summary jsonb := coalesce(p_performance_summary, '{}'::jsonb);
  v_follow jsonb := coalesce(v_summary -> 'follow_outcome', '{}'::jsonb);
  v_scope jsonb := coalesce(v_follow -> 'scope_binding', '{}'::jsonb);
  v_handoff jsonb := coalesce(v_summary -> 'follow_to_unfollow_real', '{}'::jsonb);
  v_unfollow jsonb := coalesce(v_handoff -> 'unfollow_outcome', v_summary -> 'unfollow_outcome', '{}'::jsonb);
  v_first_reason text := coalesce(nullif(v_follow ->> 'first_causal_reason', ''), nullif(v_summary ->> 'first_causal_reason', ''));
  v_follow_stop_reason text := coalesce(nullif(v_summary ->> 'follow_stop_reason', ''), nullif(v_follow ->> 'stable_reason', ''));
  v_termination_class text := nullif(v_summary ->> 'session_termination_class', '');
  v_business_session_id text := coalesce(nullif(v_scope ->> 'business_session_id', ''), nullif(v_summary ->> 'business_session_id', ''));
  v_attempt_id text := coalesce(nullif(v_scope ->> 'attempt_id', ''), nullif(v_summary ->> 'attempt_id', ''), nullif(v_summary #>> '{auto_restart_resume_plan,current_attempt_id}', ''));
  v_generation text := nullif(v_scope ->> 'generation', '');
  v_unfollow_state text := coalesce(nullif(v_unfollow ->> 'phase_status', ''), nullif(v_summary ->> 'unfollow_phase_status', ''), nullif(v_handoff ->> 'status', ''));
  v_skip_reason text := nullif(v_handoff ->> 'skip_reason', '');
  v_blocker text := coalesce(nullif(v_handoff ->> 'failure_reason', ''), nullif(v_unfollow ->> 'actionable_reason', ''), nullif(v_unfollow ->> 'failure_reason', ''));
  v_unfollow_started boolean := coalesce((v_handoff ->> 'executed')::boolean, false);
  v_state text := 'initiated';
  v_key text;
begin
  -- Recognition is intentionally exact and fail-closed. Generic incident fallbacks do not qualify.
  if v_first_reason is distinct from 'follow_to_unfollow_time_handoff'
     or v_business_session_id is null
     or v_attempt_id is null
     or v_generation is null
     or coalesce(v_scope ->> 'account_id', p_account_id::text) is distinct from p_account_id::text
     or coalesce(v_scope ->> 'run_id', p_run_id::text) is distinct from p_run_id::text then
    return null;
  end if;

  if v_blocker is not null or lower(coalesce(v_handoff ->> 'status', '')) in ('blocked', 'failed', 'error') then
    v_state := 'blocked';
  elsif v_unfollow_state in ('completed', 'quota_reached', 'candidates_exhausted') then
    v_state := 'completed';
  elsif v_unfollow_state in ('partial', 'partial_resumable', 'scheduled_safe_stop', 'window_limit_reached') then
    v_state := 'partial';
  elsif not v_unfollow_started and v_skip_reason in ('no_pending_unfollow', 'no_eligible_unfollow_candidates', 'unfollow_plan_empty', 'zero_executable_unfollow') then
    v_state := 'no_work';
  end if;

  v_key := concat_ws(':', v_business_session_id, v_attempt_id, v_generation, 'follow_to_unfollow_handoff');

  return jsonb_build_object(
    'schema_version', 'account_session_transition_v1',
    'transition_key', v_key,
    'account_id', p_account_id,
    'run_id', p_run_id,
    'business_session_id', v_business_session_id,
    'attempt_id', v_attempt_id,
    'generation', v_generation,
    'transition_context', 'business_deadline',
    'transition_type', 'follow_to_unfollow',
    'transition_state', v_state,
    'first_causal_reason', v_first_reason,
    'follow_stop_reason', v_follow_stop_reason,
    'session_termination_class', v_termination_class,
    'exact_stable_reason', coalesce(nullif(v_follow ->> 'stable_reason', ''), v_follow_stop_reason, v_first_reason),
    'actionable_reason', case when v_state = 'blocked' then v_blocker else null end,
    'follows_completed', nullif(v_follow #>> '{follow_quota_state,follows_completed_count}', '')::integer,
    'follows_remaining', nullif(v_follow ->> 'remaining_actions', '')::integer,
    'safe_boundary', nullif(v_follow ->> 'safe_boundary', '')::boolean,
    'unfollow_eligible', nullif(v_handoff ->> 'eligible', '')::boolean,
    'unfollow_started', v_unfollow_started,
    'unfollow_state', v_unfollow_state,
    'backlog_remaining', coalesce(nullif(v_unfollow ->> 'remaining_count', '')::integer, nullif(v_handoff ->> 'remaining_eligible', '')::integer),
    'next_step', coalesce(nullif(v_follow ->> 'safe_next_step', ''), nullif(v_follow ->> 'suggested_next_action', '')),
    'source_updated_at', p_source_updated_at,
    'source_envelope', jsonb_build_object(
      'first_causal_reason', v_first_reason,
      'follow_stop_reason', v_follow_stop_reason,
      'session_termination_class', v_termination_class,
      'business_session_id', v_business_session_id,
      'attempt_id', v_attempt_id,
      'generation', v_generation,
      'follow_outcome', v_follow,
      'follow_to_unfollow_real', v_handoff,
      'unfollow_phase_status', v_summary -> 'unfollow_phase_status'
    )
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    -- Malformed/non-canonical envelopes never receive inferred semantics.
    return null;
end;
$$;

revoke all on function public.project_account_session_transition_v1(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.project_account_session_transition_v1(uuid, uuid, jsonb, timestamptz) to service_role;

create or replace function public.capture_account_session_transition_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_projection jsonb;
begin
  v_projection := public.project_account_session_transition_v1(new.account_id, new.id, new.performance_summary, new.updated_at);
  if v_projection is null then
    return new;
  end if;

  insert into public.account_session_transitions (
    schema_version, transition_key, account_id, run_id, business_session_id, attempt_id, generation,
    transition_context, transition_type, transition_state, first_causal_reason, follow_stop_reason,
    session_termination_class, exact_stable_reason, actionable_reason, follows_completed,
    follows_remaining, safe_boundary, unfollow_eligible, unfollow_started, unfollow_state,
    backlog_remaining, next_step, source_envelope, source_updated_at, updated_at
  ) values (
    v_projection ->> 'schema_version', v_projection ->> 'transition_key', new.account_id, new.id,
    v_projection ->> 'business_session_id', v_projection ->> 'attempt_id', v_projection ->> 'generation',
    v_projection ->> 'transition_context', v_projection ->> 'transition_type', v_projection ->> 'transition_state',
    v_projection ->> 'first_causal_reason', v_projection ->> 'follow_stop_reason',
    v_projection ->> 'session_termination_class', v_projection ->> 'exact_stable_reason',
    v_projection ->> 'actionable_reason', (v_projection ->> 'follows_completed')::integer,
    (v_projection ->> 'follows_remaining')::integer, (v_projection ->> 'safe_boundary')::boolean,
    (v_projection ->> 'unfollow_eligible')::boolean, coalesce((v_projection ->> 'unfollow_started')::boolean, false),
    v_projection ->> 'unfollow_state', (v_projection ->> 'backlog_remaining')::integer,
    v_projection ->> 'next_step', v_projection -> 'source_envelope', new.updated_at, now()
  )
  on conflict (transition_key) do update set
    run_id = excluded.run_id,
    transition_state = excluded.transition_state,
    follow_stop_reason = excluded.follow_stop_reason,
    session_termination_class = excluded.session_termination_class,
    exact_stable_reason = excluded.exact_stable_reason,
    actionable_reason = excluded.actionable_reason,
    follows_completed = excluded.follows_completed,
    follows_remaining = excluded.follows_remaining,
    safe_boundary = excluded.safe_boundary,
    unfollow_eligible = excluded.unfollow_eligible,
    unfollow_started = excluded.unfollow_started,
    unfollow_state = excluded.unfollow_state,
    backlog_remaining = excluded.backlog_remaining,
    next_step = excluded.next_step,
    source_envelope = excluded.source_envelope,
    source_updated_at = excluded.source_updated_at,
    updated_at = now();

  return new;
end;
$$;

revoke all on function public.capture_account_session_transition_v1() from public, anon, authenticated;

drop trigger if exists capture_account_session_transition_v1 on public.ig_runs;
create trigger capture_account_session_transition_v1
after insert or update of performance_summary on public.ig_runs
for each row
when (new.performance_summary is not null)
execute function public.capture_account_session_transition_v1();

comment on table public.account_session_transitions is
  'Projection-only account_session_transition_v1 lifecycle. ig_runs.performance_summary remains authoritative.';
