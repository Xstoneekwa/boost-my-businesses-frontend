-- Positively proven non-Following relationship states are terminal Unfollow
-- candidate outcomes.  Absence of the Following CTA alone never calls this RPC.

alter table public.ig_unfollow_candidate_availability
  drop constraint if exists ig_unfollow_candidate_availability_status_check,
  drop constraint if exists ig_unfollow_candidate_availability_reason_check,
  drop constraint if exists ig_unfollow_candidate_availability_terminal_check;

alter table public.ig_unfollow_candidate_availability
  add constraint ig_unfollow_candidate_availability_status_check check (
    status in (
      'temporary_unavailable',
      'exhausted',
      'username_not_found_confirmed',
      'search_surface_unhealthy',
      'already_not_following_confirmed'
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
      'profile_identity_unconfirmed',
      'already_not_following_confirmed'
    )
  ),
  add constraint ig_unfollow_candidate_availability_terminal_check check (
    (
      status in ('temporary_unavailable', 'search_surface_unhealthy')
      and next_retry_at is not null
      and terminal_at is null
    )
    or (
      status in (
        'exhausted',
        'username_not_found_confirmed',
        'already_not_following_confirmed'
      )
      and next_retry_at is null
      and terminal_at is not null
    )
  );

create or replace function public.record_unfollow_already_not_following_v1(
  p_account_id uuid,
  p_normalized_username text,
  p_source_run_id uuid,
  p_relationship_state text
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
  v_relationship_state text := btrim(coalesce(p_relationship_state, ''));
  v_existing public.ig_unfollow_candidate_availability%rowtype;
  v_interaction_id uuid;
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
  if v_relationship_state not in ('follow', 'follow_back', 'requested') then
    raise exception 'unfollow_relationship_state_invalid' using errcode = '22023';
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
     and v_existing.status in (
       'exhausted',
       'username_not_found_confirmed',
       'already_not_following_confirmed'
     ) then
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
    'already_not_following_confirmed',
    'already_not_following_confirmed',
    null,
    v_now,
    0,
    null,
    null,
    0,
    p_source_run_id,
    null,
    v_now,
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
    last_checked_at = excluded.last_checked_at,
    source_run_id = excluded.source_run_id,
    next_retry_at = null,
    terminal_at = excluded.terminal_at,
    business_date_sast = excluded.business_date_sast,
    updated_at = excluded.updated_at;

  select * into v_existing
  from public.ig_unfollow_candidate_availability a
  where a.account_id = p_account_id
    and a.normalized_username = v_username;

  return jsonb_build_object(
    'ok', true,
    'terminal_preserved', false,
    'account_id', v_existing.account_id,
    'normalized_username', v_existing.normalized_username,
    'status', v_existing.status,
    'reason', v_existing.reason,
    'relationship_state', v_relationship_state,
    'next_retry_at', v_existing.next_retry_at,
    'terminal_at', v_existing.terminal_at,
    'business_date_sast', v_existing.business_date_sast
  );
end
$$;

revoke all on function public.record_unfollow_already_not_following_v1(
  uuid,text,uuid,text
) from public, anon, authenticated;
grant execute on function public.record_unfollow_already_not_following_v1(
  uuid,text,uuid,text
) to service_role;
