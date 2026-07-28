-- Rollback for the privilege-only forward fix. This restores the Supabase
-- project default table privilege set and does not change any row.

begin;

grant all on table public.ig_unfollow_candidate_availability to service_role;

commit;
