\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;

create table public.ig_unfollow_candidate_availability (
  account_id uuid not null,
  normalized_username text not null,
  status text not null,
  reason text not null,
  technical_attempt_count integer not null default 0,
  source_run_id uuid,
  next_retry_at timestamptz,
  terminal_at timestamptz,
  business_date_sast date not null,
  updated_at timestamptz not null default now(),
  primary key (account_id, normalized_username)
);

\ir ../migrations/20260811193000_unfollow_search_unresolved_quarantine_v1.sql

do $$
declare
  v_account_id uuid := '10000000-0000-4000-8000-000000000001';
  v_row public.ig_unfollow_candidate_availability%rowtype;
begin
  insert into public.ig_unfollow_candidate_availability (
    account_id,
    normalized_username,
    status,
    reason,
    technical_attempt_count,
    source_run_id,
    next_retry_at,
    business_date_sast
  ) values (
    v_account_id,
    'bounded_retry_candidate',
    'search_surface_unhealthy',
    'search_results_loading_timeout',
    1,
    null,
    clock_timestamp() + interval '5 minutes',
    (clock_timestamp() at time zone 'Africa/Johannesburg')::date
  ) returning * into v_row;

  if v_row.next_retry_at < clock_timestamp() + interval '29 minutes' then
    raise exception 'first technical hold did not preserve the 30 minute floor';
  end if;

  update public.ig_unfollow_candidate_availability
  set next_retry_at = v_row.next_retry_at
  where account_id = v_account_id
    and normalized_username = 'bounded_retry_candidate'
  returning * into v_row;
  if v_row.next_retry_at > clock_timestamp() + interval '31 minutes' then
    raise exception 'idempotent same-attempt replay created a sliding hold';
  end if;

  update public.ig_unfollow_candidate_availability
  set technical_attempt_count = 2,
      next_retry_at = clock_timestamp() + interval '30 minutes'
  where account_id = v_account_id
    and normalized_username = 'bounded_retry_candidate'
  returning * into v_row;
  if v_row.next_retry_at < clock_timestamp() + interval '5 hours 59 minutes' then
    raise exception 'second technical hold did not receive the 6 hour floor';
  end if;

  update public.ig_unfollow_candidate_availability
  set technical_attempt_count = 3,
      next_retry_at = clock_timestamp() + interval '30 minutes'
  where account_id = v_account_id
    and normalized_username = 'bounded_retry_candidate'
  returning * into v_row;
  if v_row.next_retry_at < clock_timestamp() + interval '23 hours 59 minutes' then
    raise exception 'third technical hold did not enter bounded quarantine';
  end if;

  update public.ig_unfollow_candidate_availability
  set technical_attempt_count = 4,
      next_retry_at = clock_timestamp() + interval '30 minutes'
  where account_id = v_account_id
    and normalized_username = 'bounded_retry_candidate'
  returning * into v_row;
  if v_row.next_retry_at < clock_timestamp() + interval '71 hours 59 minutes' then
    raise exception 'fourth technical hold did not receive the 72 hour floor';
  end if;

  update public.ig_unfollow_candidate_availability
  set status = 'username_not_found_confirmed',
      reason = 'username_not_found_confirmed',
      next_retry_at = null,
      terminal_at = clock_timestamp()
  where account_id = v_account_id
    and normalized_username = 'bounded_retry_candidate'
  returning * into v_row;
  if v_row.next_retry_at is not null or v_row.terminal_at is null then
    raise exception 'terminal not-found state was altered by quarantine trigger';
  end if;
end
$$;

do $$
begin
  if has_function_privilege('anon', 'public.enforce_unfollow_search_unresolved_quarantine_v1()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enforce_unfollow_search_unresolved_quarantine_v1()', 'EXECUTE')
     or has_function_privilege('public', 'public.enforce_unfollow_search_unresolved_quarantine_v1()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.enforce_unfollow_search_unresolved_quarantine_v1()', 'EXECUTE') then
    raise exception 'quarantine_trigger_function_grants_invalid';
  end if;
end
$$;

select 'unfollow_search_unresolved_quarantine_v1_ok' as result;
