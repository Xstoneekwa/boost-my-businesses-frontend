-- Supabase's project-level default privileges grant broad table access to
-- service_role. Keep only the DML required by the Worker lifecycle contract.

revoke all on table public.ig_unfollow_candidate_availability from service_role;
grant select, insert, update on table public.ig_unfollow_candidate_availability to service_role;
