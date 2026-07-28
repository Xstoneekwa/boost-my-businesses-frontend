-- Emergency rollback for unfollow_candidate_availability_and_backlog_v1.
-- Safe for the immediate deployment window while the table is empty.
-- After natural Worker writes begin, export the table before executing this
-- rollback because dropping it would intentionally remove its audit history.

begin;

revoke all on function public.auto_restart_unfollow_backlog_v1(uuid[], timestamptz)
  from public, anon, authenticated, service_role;
drop function if exists public.auto_restart_unfollow_backlog_v1(uuid[], timestamptz);

revoke all on function public.record_unfollow_candidate_not_found_v1(uuid, text, uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
drop function if exists public.record_unfollow_candidate_not_found_v1(uuid, text, uuid, text, integer, integer);

revoke all on table public.ig_unfollow_candidate_availability
  from public, anon, authenticated, service_role;
drop table if exists public.ig_unfollow_candidate_availability;

commit;
