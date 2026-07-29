-- Fail closed if rollback would discard a v2 terminal outcome or circuit row.
do $$
begin
  if exists (
    select 1
    from public.ig_unfollow_candidate_availability
    where status in ('username_not_found_confirmed', 'search_surface_unhealthy')
  ) or exists (
    select 1 from public.ig_unfollow_phase_circuit_breakers
  ) then
    raise exception 'rollback_refused:v2_unfollow_search_history_present';
  end if;
end
$$;

drop function if exists public.auto_restart_unfollow_backlog_v2(uuid[],timestamptz);
drop function if exists public.record_unfollow_phase_circuit_breaker_v1(
  uuid,uuid,text,integer,text[],integer
);
drop function if exists public.record_unfollow_candidate_availability_v2(
  uuid,text,uuid,text,text,integer
);
drop table if exists public.ig_unfollow_phase_circuit_breakers;

drop index if exists public.ig_unfollow_candidate_availability_business_date_idx;

alter table public.ig_unfollow_candidate_availability
  drop constraint if exists ig_unfollow_candidate_availability_status_check,
  drop constraint if exists ig_unfollow_candidate_availability_reason_check,
  drop constraint if exists ig_unfollow_candidate_availability_attempt_check,
  drop constraint if exists ig_unfollow_candidate_availability_terminal_check;

alter table public.ig_unfollow_candidate_availability
  alter column first_not_found_at set not null,
  alter column not_found_attempt_count drop default,
  drop column if exists first_failure_at,
  drop column if exists last_failure_at,
  drop column if exists technical_attempt_count,
  drop column if exists business_date_sast;

alter table public.ig_unfollow_candidate_availability
  add constraint ig_unfollow_candidate_availability_status_check
    check (status in ('temporary_unavailable', 'exhausted')),
  add constraint ig_unfollow_candidate_availability_reason_check check (
    reason in (
      'unfollow_candidate_not_found',
      'unfollow_candidate_account_unavailable',
      'unfollow_candidate_possible_username_change'
    )
  ),
  add constraint ig_unfollow_candidate_availability_attempt_check
    check (not_found_attempt_count between 1 and 10),
  add constraint ig_unfollow_candidate_availability_terminal_check check (
    (status = 'temporary_unavailable' and next_retry_at is not null and terminal_at is null)
    or (status = 'exhausted' and next_retry_at is null and terminal_at is not null)
  );
