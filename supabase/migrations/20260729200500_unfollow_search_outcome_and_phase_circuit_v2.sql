-- Canonical Unfollow Search outcomes and phase-scoped circuit breaker.
-- Depends on production migration 20260728211139
-- unfollow_candidate_availability_and_backlog_v1. Timestamps remain UTC;
-- business dates use Africa/Johannesburg.

do $$
begin
  if to_regclass('public.ig_unfollow_candidate_availability') is null then
    raise exception 'required_baseline_missing:ig_unfollow_candidate_availability';
  end if;
end
$$;

alter table public.ig_unfollow_candidate_availability
  add column if not exists first_failure_at timestamptz null,
  add column if not exists last_failure_at timestamptz null,
  add column if not exists technical_attempt_count integer not null default 0,
  add column if not exists business_date_sast date null;

-- This derives a date from an existing timestamp; it does not invent or alter
-- any candidate outcome history.
update public.ig_unfollow_candidate_availability
set business_date_sast = (last_checked_at at time zone 'Africa/Johannesburg')::date
where business_date_sast is null;

alter table public.ig_unfollow_candidate_availability
  alter column business_date_sast set default
    ((now() at time zone 'Africa/Johannesburg')::date),
  alter column business_date_sast set not null,
  alter column first_not_found_at drop not null,
  alter column not_found_attempt_count set default 0;

alter table public.ig_unfollow_candidate_availability
  drop constraint if exists ig_unfollow_candidate_availability_status_check,
  drop constraint if exists ig_unfollow_candidate_availability_reason_check,
  drop constraint if exists ig_unfollow_candidate_availability_attempt_check,
  drop constraint if exists ig_unfollow_candidate_availability_terminal_check;

alter table public.ig_unfollow_candidate_availability
  add constraint ig_unfollow_candidate_availability_status_check check (
    status in (
      'temporary_unavailable',
      'exhausted',
      'username_not_found_confirmed',
      'search_surface_unhealthy'
    )
  ),
  add constraint ig_unfollow_candidate_availability_reason_check check (
    reason in (
      'unfollow_candidate_not_found',
      'unfollow_candidate_account_unavailable',
      'unfollow_candidate_possible_username_change',
      'username_not_found_confirmed',
      'search_surface_unhealthy',
      'search_results_loading_timeout',
      'search_query_field_missing',
      'search_query_field_mismatch',
      'search_hierarchy_unparseable',
      'multiple_exact_account_rows',
      'open_search_failed_after_bounded_retry',
      'type_search_failed',
      'exact_account_row_tap_failed',
      'profile_identity_unconfirmed'
    )
  ),
  add constraint ig_unfollow_candidate_availability_attempt_check check (
    not_found_attempt_count between 0 and 10
    and technical_attempt_count between 0 and 100
  ),
  add constraint ig_unfollow_candidate_availability_terminal_check check (
    (
      status in ('temporary_unavailable', 'search_surface_unhealthy')
      and next_retry_at is not null
      and terminal_at is null
    )
    or (
      status in ('exhausted', 'username_not_found_confirmed')
      and next_retry_at is null
      and terminal_at is not null
    )
  );

create index if not exists ig_unfollow_candidate_availability_business_date_idx
  on public.ig_unfollow_candidate_availability
    (account_id, business_date_sast, status, next_retry_at);

alter table public.ig_unfollow_candidate_availability enable row level security;
revoke all on table public.ig_unfollow_candidate_availability
  from public, anon, authenticated;
grant select, insert, update on table public.ig_unfollow_candidate_availability
  to service_role;

create table public.ig_unfollow_phase_circuit_breakers (
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  business_date_sast date not null,
  phase text not null default 'unfollow',
  status text not null,
  stable_reason text not null,
  technical_failure_count integer not null,
  session_count integer not null default 1,
  same_username_repeat_count integer not null default 0,
  last_usernames jsonb not null default '[]'::jsonb,
  source_run_id uuid null references public.ig_runs(id) on delete set null,
  first_opened_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  next_retry_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ig_unfollow_phase_circuit_breakers_pkey
    primary key (account_id, business_date_sast, phase),
  constraint ig_unfollow_phase_circuit_breakers_phase_check
    check (phase = 'unfollow'),
  constraint ig_unfollow_phase_circuit_breakers_status_check
    check (status = 'open'),
  constraint ig_unfollow_phase_circuit_breakers_reason_check
    check (
      stable_reason = 'unfollow_search_surface_consecutive_failure_limit_reached'
    ),
  constraint ig_unfollow_phase_circuit_breakers_count_check
    check (
      technical_failure_count between 3 and 100
      and session_count between 1 and 2
      and same_username_repeat_count between 0 and 2
    ),
  constraint ig_unfollow_phase_circuit_breakers_usernames_check
    check (jsonb_typeof(last_usernames) = 'array' and jsonb_array_length(last_usernames) <= 10)
);

create index ig_unfollow_phase_circuit_breakers_retry_idx
  on public.ig_unfollow_phase_circuit_breakers
    (account_id, business_date_sast, next_retry_at);
create index ig_unfollow_phase_circuit_breakers_source_run_idx
  on public.ig_unfollow_phase_circuit_breakers (source_run_id)
  where source_run_id is not null;

alter table public.ig_unfollow_phase_circuit_breakers enable row level security;
revoke all on table public.ig_unfollow_phase_circuit_breakers
  from public, anon, authenticated;
grant select, insert, update on table public.ig_unfollow_phase_circuit_breakers
  to service_role;

create policy ig_unfollow_phase_circuit_breakers_service_role
  on public.ig_unfollow_phase_circuit_breakers
  for all to service_role
  using (true)
  with check (true);

create or replace function public.record_unfollow_candidate_availability_v2(
  p_account_id uuid,
  p_normalized_username text,
  p_source_run_id uuid,
  p_classification text,
  p_reason text,
  p_technical_cooldown_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_business_date date := (v_now at time zone 'Africa/Johannesburg')::date;
  v_username text := lower(btrim(coalesce(p_normalized_username, '')));
  v_classification text := btrim(coalesce(p_classification, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_cooldown_minutes integer := greatest(
    5,
    least(coalesce(p_technical_cooldown_minutes, 30), 1440)
  );
  v_existing public.ig_unfollow_candidate_availability%rowtype;
  v_interaction_id uuid;
  v_allowed_technical_reasons text[] := array[
    'search_surface_unhealthy',
    'search_results_loading_timeout',
    'search_query_field_missing',
    'search_query_field_mismatch',
    'search_hierarchy_unparseable',
    'multiple_exact_account_rows',
    'open_search_failed_after_bounded_retry',
    'type_search_failed',
    'exact_account_row_tap_failed',
    'profile_identity_unconfirmed'
  ];
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_account_id is null or p_source_run_id is null then
    raise exception 'unfollow_candidate_availability_identity_required' using errcode = '22023';
  end if;
  if v_username !~ '^[a-z0-9._]{1,30}$'
     or v_username ~ '^\.' or v_username ~ '\.$' or v_username ~ '\.\.' then
    raise exception 'unfollow_candidate_username_invalid' using errcode = '22023';
  end if;
  if v_classification not in (
    'username_not_found_confirmed',
    'search_surface_unhealthy'
  ) then
    raise exception 'unfollow_candidate_classification_invalid' using errcode = '22023';
  end if;
  if v_classification = 'username_not_found_confirmed' then
    v_reason := 'username_not_found_confirmed';
  elsif not (v_reason = any(v_allowed_technical_reasons)) then
    v_reason := 'search_surface_unhealthy';
  end if;
  if not exists (
    select 1 from public.ig_runs r
    where r.id = p_source_run_id and r.account_id = p_account_id
  ) then
    raise exception 'unfollow_candidate_source_run_invalid' using errcode = '22023';
  end if;

  select u.id into v_interaction_id
  from public.ig_interacted_users u
  where u.account_id = p_account_id
    and lower(btrim(u.username)) = v_username
  order by u.followed_at desc nulls last, u.created_at desc, u.id desc
  limit 1;

  select * into v_existing
  from public.ig_unfollow_candidate_availability a
  where a.account_id = p_account_id
    and a.normalized_username = v_username
  for update;

  if v_existing.account_id is not null
     and v_existing.status in ('exhausted', 'username_not_found_confirmed') then
    return jsonb_build_object(
      'ok', true,
      'terminal_preserved', true,
      'account_id', v_existing.account_id,
      'normalized_username', v_existing.normalized_username,
      'status', v_existing.status,
      'reason', v_existing.reason,
      'next_retry_at', v_existing.next_retry_at,
      'terminal_at', v_existing.terminal_at,
      'business_date_sast', v_existing.business_date_sast
    );
  end if;
  if v_existing.account_id is not null
     and v_existing.source_run_id = p_source_run_id
     and v_existing.status = v_classification then
    return jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'account_id', v_existing.account_id,
      'normalized_username', v_existing.normalized_username,
      'status', v_existing.status,
      'reason', v_existing.reason,
      'not_found_attempt_count', v_existing.not_found_attempt_count,
      'technical_attempt_count', v_existing.technical_attempt_count,
      'next_retry_at', v_existing.next_retry_at,
      'terminal_at', v_existing.terminal_at,
      'business_date_sast', v_existing.business_date_sast
    );
  end if;

  insert into public.ig_unfollow_candidate_availability (
    account_id,
    normalized_username,
    interaction_id,
    status,
    reason,
    first_not_found_at,
    last_checked_at,
    not_found_attempt_count,
    first_failure_at,
    last_failure_at,
    technical_attempt_count,
    source_run_id,
    next_retry_at,
    terminal_at,
    business_date_sast,
    created_at,
    updated_at
  ) values (
    p_account_id,
    v_username,
    v_interaction_id,
    v_classification,
    v_reason,
    case when v_classification = 'username_not_found_confirmed' then v_now else null end,
    v_now,
    case when v_classification = 'username_not_found_confirmed' then 1 else 0 end,
    case when v_classification = 'search_surface_unhealthy' then v_now else null end,
    case when v_classification = 'search_surface_unhealthy' then v_now else null end,
    case when v_classification = 'search_surface_unhealthy' then 1 else 0 end,
    p_source_run_id,
    case
      when v_classification = 'search_surface_unhealthy'
      then v_now + make_interval(mins => v_cooldown_minutes)
      else null
    end,
    case when v_classification = 'username_not_found_confirmed' then v_now else null end,
    v_business_date,
    v_now,
    v_now
  )
  on conflict (account_id, normalized_username) do update set
    interaction_id = coalesce(
      excluded.interaction_id,
      public.ig_unfollow_candidate_availability.interaction_id
    ),
    status = excluded.status,
    reason = excluded.reason,
    first_not_found_at = case
      when excluded.status = 'username_not_found_confirmed'
      then coalesce(
        public.ig_unfollow_candidate_availability.first_not_found_at,
        excluded.first_not_found_at
      )
      else public.ig_unfollow_candidate_availability.first_not_found_at
    end,
    last_checked_at = excluded.last_checked_at,
    not_found_attempt_count = case
      when excluded.status = 'username_not_found_confirmed'
      then least(public.ig_unfollow_candidate_availability.not_found_attempt_count + 1, 10)
      else public.ig_unfollow_candidate_availability.not_found_attempt_count
    end,
    first_failure_at = case
      when excluded.status = 'search_surface_unhealthy'
      then coalesce(
        public.ig_unfollow_candidate_availability.first_failure_at,
        excluded.first_failure_at
      )
      else public.ig_unfollow_candidate_availability.first_failure_at
    end,
    last_failure_at = case
      when excluded.status = 'search_surface_unhealthy'
      then excluded.last_failure_at
      else public.ig_unfollow_candidate_availability.last_failure_at
    end,
    technical_attempt_count = case
      when excluded.status = 'search_surface_unhealthy'
      then least(public.ig_unfollow_candidate_availability.technical_attempt_count + 1, 100)
      else public.ig_unfollow_candidate_availability.technical_attempt_count
    end,
    source_run_id = excluded.source_run_id,
    next_retry_at = excluded.next_retry_at,
    terminal_at = excluded.terminal_at,
    business_date_sast = excluded.business_date_sast,
    updated_at = excluded.updated_at;

  select * into v_existing
  from public.ig_unfollow_candidate_availability a
  where a.account_id = p_account_id
    and a.normalized_username = v_username;

  return jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'account_id', v_existing.account_id,
    'normalized_username', v_existing.normalized_username,
    'status', v_existing.status,
    'reason', v_existing.reason,
    'not_found_attempt_count', v_existing.not_found_attempt_count,
    'technical_attempt_count', v_existing.technical_attempt_count,
    'next_retry_at', v_existing.next_retry_at,
    'terminal_at', v_existing.terminal_at,
    'business_date_sast', v_existing.business_date_sast
  );
end
$$;

revoke all on function public.record_unfollow_candidate_availability_v2(
  uuid,text,uuid,text,text,integer
) from public, anon, authenticated;
grant execute on function public.record_unfollow_candidate_availability_v2(
  uuid,text,uuid,text,text,integer
) to service_role;

create function public.record_unfollow_phase_circuit_breaker_v1(
  p_account_id uuid,
  p_source_run_id uuid,
  p_stable_reason text,
  p_technical_failure_count integer,
  p_usernames text[],
  p_cooldown_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_business_date date := (v_now at time zone 'Africa/Johannesburg')::date;
  v_cooldown_minutes integer := greatest(5, least(coalesce(p_cooldown_minutes, 30), 1440));
  v_usernames jsonb;
  v_existing public.ig_unfollow_phase_circuit_breakers%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_account_id is null or p_source_run_id is null then
    raise exception 'unfollow_phase_circuit_identity_required' using errcode = '22023';
  end if;
  if p_stable_reason <> 'unfollow_search_surface_consecutive_failure_limit_reached'
     or coalesce(p_technical_failure_count, 0) < 3 then
    raise exception 'unfollow_phase_circuit_contract_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.ig_runs r
    where r.id = p_source_run_id and r.account_id = p_account_id
  ) then
    raise exception 'unfollow_phase_circuit_source_run_invalid' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(value order by value), '[]'::jsonb) into v_usernames
  from (
    select distinct lower(btrim(value)) as value
    from unnest(coalesce(p_usernames, '{}'::text[])) as value
    where lower(btrim(value)) ~ '^[a-z0-9._]{1,30}$'
    order by value
    limit 10
  ) bounded;

  select * into v_existing
  from public.ig_unfollow_phase_circuit_breakers c
  where c.account_id = p_account_id
    and c.business_date_sast = v_business_date
    and c.phase = 'unfollow'
  for update;

  if v_existing.account_id is not null and v_existing.source_run_id = p_source_run_id then
    return jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'status', v_existing.status,
      'stable_reason', v_existing.stable_reason,
      'session_count', v_existing.session_count,
      'same_username_repeat_count', v_existing.same_username_repeat_count,
      'next_retry_at', v_existing.next_retry_at,
      'business_date_sast', v_existing.business_date_sast
    );
  end if;

  insert into public.ig_unfollow_phase_circuit_breakers (
    account_id,
    business_date_sast,
    phase,
    status,
    stable_reason,
    technical_failure_count,
    session_count,
    same_username_repeat_count,
    last_usernames,
    source_run_id,
    first_opened_at,
    last_opened_at,
    next_retry_at,
    created_at,
    updated_at
  ) values (
    p_account_id,
    v_business_date,
    'unfollow',
    'open',
    p_stable_reason,
    least(p_technical_failure_count, 100),
    1,
    0,
    v_usernames,
    p_source_run_id,
    v_now,
    v_now,
    v_now + make_interval(mins => v_cooldown_minutes),
    v_now,
    v_now
  )
  on conflict (account_id, business_date_sast, phase) do update set
    stable_reason = excluded.stable_reason,
    technical_failure_count = greatest(
      public.ig_unfollow_phase_circuit_breakers.technical_failure_count,
      excluded.technical_failure_count
    ),
    session_count = least(
      public.ig_unfollow_phase_circuit_breakers.session_count + 1,
      2
    ),
    same_username_repeat_count = case
      when public.ig_unfollow_phase_circuit_breakers.last_usernames = excluded.last_usernames
      then least(
        public.ig_unfollow_phase_circuit_breakers.same_username_repeat_count + 1,
        2
      )
      else 0
    end,
    last_usernames = excluded.last_usernames,
    source_run_id = excluded.source_run_id,
    last_opened_at = excluded.last_opened_at,
    next_retry_at = case
      when public.ig_unfollow_phase_circuit_breakers.session_count >= 1
      then (
        (public.ig_unfollow_phase_circuit_breakers.business_date_sast + 1)::timestamp
        at time zone 'Africa/Johannesburg'
      )
      else excluded.next_retry_at
    end,
    updated_at = excluded.updated_at;

  select * into v_existing
  from public.ig_unfollow_phase_circuit_breakers c
  where c.account_id = p_account_id
    and c.business_date_sast = v_business_date
    and c.phase = 'unfollow';

  return jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'status', v_existing.status,
    'stable_reason', v_existing.stable_reason,
    'session_count', v_existing.session_count,
    'same_username_repeat_count', v_existing.same_username_repeat_count,
    'max_sessions_per_business_date', 2,
    'next_retry_at', v_existing.next_retry_at,
    'business_date_sast', v_existing.business_date_sast
  );
end
$$;

revoke all on function public.record_unfollow_phase_circuit_breaker_v1(
  uuid,uuid,text,integer,text[],integer
) from public, anon, authenticated;
grant execute on function public.record_unfollow_phase_circuit_breaker_v1(
  uuid,uuid,text,integer,text[],integer
) to service_role;

create function public.auto_restart_unfollow_backlog_v2(
  p_account_ids uuid[],
  p_as_of timestamptz default now()
)
returns table (
  account_id uuid,
  eligible_total bigint,
  backlog_actionable_remaining bigint,
  backlog_terminal_unavailable bigint,
  backlog_technical_hold bigint,
  next_candidate_retry_at timestamptz,
  phase_circuit_open boolean,
  phase_circuit_reason text,
  phase_circuit_next_retry_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with configured_accounts as (
    select s.account_id, s.unfollow_after_days, s.unfollow_mode
    from public.ig_account_unfollow_settings s
    where s.account_id = any(coalesce(p_account_ids, '{}'::uuid[]))
      and s.unfollow_enabled is true
      and s.unfollow_mode in ('unfollow', 'unfollow-non-followers')
  ), eligible_usernames as (
    select distinct
      u.account_id,
      lower(btrim(u.username)) as normalized_username
    from public.ig_interacted_users u
    join configured_accounts s on s.account_id = u.account_id
    where u.followed_by_bot is true
      and u.followed_at is not null
      and lower(coalesce(u.follow_status, '')) = 'following'
      and u.unfollowed_at is null
      and coalesce(u.unfollow_result, '') <> 'success'
      and (
        lower(coalesce(u.interaction_lifecycle_state, '')) = 'active_following'
        or lower(coalesce(u.interaction_lifecycle_state, '')) in ('', 'failed', 'skipped')
      )
      and coalesce(
        u.eligible_unfollow_at,
        u.followed_at + make_interval(days => greatest(0, s.unfollow_after_days))
      ) <= p_as_of
      and (s.unfollow_mode <> 'unfollow-non-followers' or u.is_following_back is false)
      and lower(btrim(coalesce(u.username, ''))) ~ '^[a-z0-9._]{1,30}$'
      and lower(btrim(u.username)) !~ '^\.'
      and lower(btrim(u.username)) !~ '\.$'
      and lower(btrim(u.username)) !~ '\.\.'
      and not exists (
        select 1
        from public.account_protection_list_entries p
        where p.account_id = u.account_id
          and p.list_kind = 'unfollow_whitelist'
          and p.active is true
          and p.normalized_username = lower(btrim(u.username))
      )
  ), classified as (
    select
      e.account_id,
      e.normalized_username,
      case
        when a.status in ('exhausted', 'username_not_found_confirmed') then 'terminal'
        when a.status in ('temporary_unavailable', 'search_surface_unhealthy')
          and a.next_retry_at > p_as_of then 'technical_hold'
        else 'actionable'
      end as availability_class,
      a.next_retry_at
    from eligible_usernames e
    left join public.ig_unfollow_candidate_availability a
      on a.account_id = e.account_id
      and a.normalized_username = e.normalized_username
  ), backlog as (
    select
      c.account_id,
      count(e.normalized_username)::bigint as eligible_total,
      count(*) filter (where e.availability_class = 'actionable')::bigint
        as backlog_actionable_remaining,
      count(*) filter (where e.availability_class = 'terminal')::bigint
        as backlog_terminal_unavailable,
      count(*) filter (where e.availability_class = 'technical_hold')::bigint
        as backlog_technical_hold,
      min(e.next_retry_at) filter (where e.availability_class = 'technical_hold')
        as next_candidate_retry_at
    from configured_accounts c
    left join classified e on e.account_id = c.account_id
    group by c.account_id
  ), circuit as (
    select distinct on (b.account_id)
      b.account_id,
      (b.status = 'open' and b.next_retry_at > p_as_of) as phase_circuit_open,
      b.stable_reason as phase_circuit_reason,
      b.next_retry_at as phase_circuit_next_retry_at
    from public.ig_unfollow_phase_circuit_breakers b
    where b.business_date_sast = (p_as_of at time zone 'Africa/Johannesburg')::date
      and b.phase = 'unfollow'
    order by b.account_id, b.last_opened_at desc
  )
  select
    b.account_id,
    b.eligible_total,
    b.backlog_actionable_remaining,
    b.backlog_terminal_unavailable,
    b.backlog_technical_hold,
    b.next_candidate_retry_at,
    coalesce(c.phase_circuit_open, false),
    c.phase_circuit_reason,
    c.phase_circuit_next_retry_at
  from backlog b
  left join circuit c on c.account_id = b.account_id
$$;

revoke all on function public.auto_restart_unfollow_backlog_v2(uuid[],timestamptz)
  from public, anon, authenticated;
grant execute on function public.auto_restart_unfollow_backlog_v2(uuid[],timestamptz)
  to service_role;

comment on table public.ig_unfollow_phase_circuit_breakers is
  'Account/day Unfollow-only technical circuit breaker; never disables Follow.';
comment on function public.auto_restart_unfollow_backlog_v2(uuid[],timestamptz) is
  'Returns actionable, terminal, technical-hold and phase-circuit Unfollow backlog for Auto Restart.';
