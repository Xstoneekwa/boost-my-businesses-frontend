do $$
begin
  if exists (
    select 1
    from public.ig_unfollow_candidate_availability
    where status = 'already_not_following_confirmed'
  ) then
    raise exception 'rollback_blocked:already_not_following_terminal_rows_exist';
  end if;
end
$$;

drop function if exists public.record_unfollow_already_not_following_v1(
  uuid,text,uuid,text
);

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
