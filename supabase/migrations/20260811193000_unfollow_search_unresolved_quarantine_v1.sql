-- Bound repeated unresolved Search surfaces without inventing a terminal
-- username-not-found outcome.  The existing technical hold remains the
-- canonical status; technical_attempt_count + next_retry_at are the auditable
-- quarantine proof consumed by daily plans, resumes, and Auto Restart.

create or replace function public.enforce_unfollow_search_unresolved_quarantine_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retry_floor interval;
begin
  if new.status <> 'search_surface_unhealthy' then
    return new;
  end if;

  -- Replaying the same observation must not turn a bounded hold into a
  -- sliding quarantine.  Only a new unhealthy state or a strictly higher
  -- technical attempt earns a new floor; idempotent upserts preserve the
  -- already-audited deadline.
  if tg_op = 'UPDATE'
     and old.status = 'search_surface_unhealthy'
     and coalesce(new.technical_attempt_count, 0)
       <= coalesce(old.technical_attempt_count, 0) then
    new.next_retry_at := greatest(new.next_retry_at, old.next_retry_at);
    return new;
  end if;

  v_retry_floor := case
    when coalesce(new.technical_attempt_count, 0) >= 4 then interval '72 hours'
    when coalesce(new.technical_attempt_count, 0) = 3 then interval '24 hours'
    when coalesce(new.technical_attempt_count, 0) = 2 then interval '6 hours'
    else interval '30 minutes'
  end;

  new.next_retry_at := greatest(
    coalesce(new.next_retry_at, clock_timestamp()),
    clock_timestamp() + v_retry_floor
  );
  return new;
end
$$;

revoke all on function public.enforce_unfollow_search_unresolved_quarantine_v1()
  from public, anon, authenticated;
grant execute on function public.enforce_unfollow_search_unresolved_quarantine_v1()
  to service_role;

drop trigger if exists enforce_unfollow_search_unresolved_quarantine_v1
  on public.ig_unfollow_candidate_availability;

create trigger enforce_unfollow_search_unresolved_quarantine_v1
before insert or update of status, technical_attempt_count, next_retry_at
on public.ig_unfollow_candidate_availability
for each row
execute function public.enforce_unfollow_search_unresolved_quarantine_v1();

comment on function public.enforce_unfollow_search_unresolved_quarantine_v1() is
  'Escalates repeated search_surface_unhealthy holds to 6h/24h/72h quarantine-equivalent retry floors without creating a false terminal state.';
