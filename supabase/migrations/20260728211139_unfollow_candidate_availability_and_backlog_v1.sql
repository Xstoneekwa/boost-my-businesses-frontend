-- Durable account-scoped lifecycle for exact Unfollow candidates that no
-- longer exist under their recorded Instagram username. Timestamps stay UTC;
-- eligibility and cooldown are evaluated against the supplied instant.

create table public.ig_unfollow_candidate_availability (
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  normalized_username text not null,
  interaction_id uuid null references public.ig_interacted_users(id) on delete set null,
  status text not null,
  reason text not null,
  first_not_found_at timestamptz not null,
  last_checked_at timestamptz not null,
  not_found_attempt_count integer not null,
  source_run_id uuid null references public.ig_runs(id) on delete set null,
  next_retry_at timestamptz null,
  terminal_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ig_unfollow_candidate_availability_pkey
    primary key (account_id, normalized_username),
  constraint ig_unfollow_candidate_availability_username_check check (
    normalized_username = lower(btrim(normalized_username))
    and char_length(normalized_username) between 1 and 30
    and normalized_username ~ '^[a-z0-9._]+$'
    and normalized_username !~ '^\.'
    and normalized_username !~ '\.$'
    and normalized_username !~ '\.\.'
  ),
  constraint ig_unfollow_candidate_availability_status_check
    check (status in ('temporary_unavailable', 'exhausted')),
  constraint ig_unfollow_candidate_availability_reason_check check (
    reason in (
      'unfollow_candidate_not_found',
      'unfollow_candidate_account_unavailable',
      'unfollow_candidate_possible_username_change'
    )
  ),
  constraint ig_unfollow_candidate_availability_attempt_check
    check (not_found_attempt_count between 1 and 10),
  constraint ig_unfollow_candidate_availability_terminal_check check (
    (status = 'temporary_unavailable' and next_retry_at is not null and terminal_at is null)
    or (status = 'exhausted' and next_retry_at is null and terminal_at is not null)
  )
);

create index ig_unfollow_candidate_availability_retry_idx
  on public.ig_unfollow_candidate_availability (account_id, status, next_retry_at);
create index ig_unfollow_candidate_availability_interaction_idx
  on public.ig_unfollow_candidate_availability (interaction_id)
  where interaction_id is not null;
create index ig_unfollow_candidate_availability_source_run_idx
  on public.ig_unfollow_candidate_availability (source_run_id);

alter table public.ig_unfollow_candidate_availability enable row level security;
revoke all on table public.ig_unfollow_candidate_availability from public, anon, authenticated;
grant select, insert, update on table public.ig_unfollow_candidate_availability to service_role;

create policy ig_unfollow_candidate_availability_service_role
  on public.ig_unfollow_candidate_availability
  for all to service_role
  using (true)
  with check (true);

create function public.record_unfollow_candidate_not_found_v1(
  p_account_id uuid,
  p_normalized_username text,
  p_source_run_id uuid,
  p_reason text default 'unfollow_candidate_not_found',
  p_cooldown_hours integer default 24,
  p_max_attempts integer default 2
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_username text := lower(btrim(coalesce(p_normalized_username, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_cooldown_hours integer := greatest(1, least(coalesce(p_cooldown_hours, 24), 168));
  v_max_attempts integer := greatest(1, least(coalesce(p_max_attempts, 2), 10));
  v_existing public.ig_unfollow_candidate_availability%rowtype;
  v_interaction_id uuid;
  v_attempt_count integer;
  v_status text;
  v_next_retry_at timestamptz;
  v_terminal_at timestamptz;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_account_id is null or p_source_run_id is null then
    raise exception 'unfollow_candidate_not_found_identity_required' using errcode = '22023';
  end if;
  if v_username !~ '^[a-z0-9._]{1,30}$'
     or v_username ~ '^\.' or v_username ~ '\.$' or v_username ~ '\.\.' then
    raise exception 'unfollow_candidate_username_invalid' using errcode = '22023';
  end if;
  if v_reason not in (
    'unfollow_candidate_not_found',
    'unfollow_candidate_account_unavailable',
    'unfollow_candidate_possible_username_change'
  ) then
    raise exception 'unfollow_candidate_reason_invalid' using errcode = '22023';
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

  if v_existing.account_id is not null and v_existing.source_run_id = p_source_run_id then
    return jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'account_id', v_existing.account_id,
      'normalized_username', v_existing.normalized_username,
      'status', v_existing.status,
      'reason', v_existing.reason,
      'not_found_attempt_count', v_existing.not_found_attempt_count,
      'next_retry_at', v_existing.next_retry_at,
      'terminal_at', v_existing.terminal_at
    );
  end if;

  v_attempt_count := coalesce(v_existing.not_found_attempt_count, 0) + 1;
  v_status := case when v_attempt_count >= v_max_attempts then 'exhausted' else 'temporary_unavailable' end;
  v_next_retry_at := case
    when v_status = 'temporary_unavailable' then v_now + make_interval(hours => v_cooldown_hours)
    else null
  end;
  v_terminal_at := case when v_status = 'exhausted' then v_now else null end;

  insert into public.ig_unfollow_candidate_availability (
    account_id, normalized_username, interaction_id, status, reason,
    first_not_found_at, last_checked_at, not_found_attempt_count,
    source_run_id, next_retry_at, terminal_at, created_at, updated_at
  ) values (
    p_account_id, v_username, v_interaction_id, v_status, v_reason,
    v_now, v_now, v_attempt_count,
    p_source_run_id, v_next_retry_at, v_terminal_at, v_now, v_now
  )
  on conflict (account_id, normalized_username) do update set
    interaction_id = coalesce(excluded.interaction_id, public.ig_unfollow_candidate_availability.interaction_id),
    status = excluded.status,
    reason = excluded.reason,
    last_checked_at = excluded.last_checked_at,
    not_found_attempt_count = excluded.not_found_attempt_count,
    source_run_id = excluded.source_run_id,
    next_retry_at = excluded.next_retry_at,
    terminal_at = excluded.terminal_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'account_id', p_account_id,
    'normalized_username', v_username,
    'status', v_status,
    'reason', v_reason,
    'not_found_attempt_count', v_attempt_count,
    'next_retry_at', v_next_retry_at,
    'terminal_at', v_terminal_at
  );
end
$$;

revoke all on function public.record_unfollow_candidate_not_found_v1(uuid,text,uuid,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.record_unfollow_candidate_not_found_v1(uuid,text,uuid,text,integer,integer)
  to service_role;

create function public.auto_restart_unfollow_backlog_v1(
  p_account_ids uuid[],
  p_as_of timestamptz default now()
)
returns table (
  account_id uuid,
  eligible_total bigint,
  backlog_actionable_remaining bigint,
  backlog_unavailable_remaining bigint
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
    select e.account_id, e.normalized_username,
      case
        when a.status = 'exhausted' then false
        when a.status = 'temporary_unavailable'
          and (a.next_retry_at is null or a.next_retry_at > p_as_of) then false
        else true
      end as actionable
    from eligible_usernames e
    left join public.ig_unfollow_candidate_availability a
      on a.account_id = e.account_id
      and a.normalized_username = e.normalized_username
  )
  select c.account_id,
    count(*)::bigint as eligible_total,
    count(*) filter (where c.actionable)::bigint as backlog_actionable_remaining,
    count(*) filter (where not c.actionable)::bigint as backlog_unavailable_remaining
  from classified c
  group by c.account_id
$$;

revoke all on function public.auto_restart_unfollow_backlog_v1(uuid[],timestamptz)
  from public, anon, authenticated;
grant execute on function public.auto_restart_unfollow_backlog_v1(uuid[],timestamptz)
  to service_role;

comment on table public.ig_unfollow_candidate_availability is
  'Account-scoped exact-username Unfollow not-found lifecycle with bounded cooldown and exhaustion.';
comment on function public.auto_restart_unfollow_backlog_v1(uuid[],timestamptz) is
  'Returns actionable versus unavailable strict Unfollow backlog for Auto Restart without per-candidate calls.';
