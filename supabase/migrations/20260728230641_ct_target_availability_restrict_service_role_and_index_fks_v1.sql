-- Phase 8B.2 dormant Target Availability forward-fix.
-- Object-scoped only: restrict service_role to the documented table contract
-- and cover the foreign-key prefixes reported by the Supabase advisor.

revoke all privileges on table public.ct_target_availability_observations from service_role;
revoke all privileges on table public.ct_target_identity_history from service_role;
revoke all privileges on table public.ct_target_identity_current from service_role;
revoke all privileges on table public.ct_target_availability_assessments from service_role;
revoke all privileges on table public.ct_target_availability_current from service_role;

grant select, insert on table public.ct_target_availability_observations to service_role;
grant select, insert on table public.ct_target_identity_history to service_role;
grant select, insert, update on table public.ct_target_identity_current to service_role;
grant select, insert on table public.ct_target_availability_assessments to service_role;
grant select, insert, update on table public.ct_target_availability_current to service_role;

-- A composite (account_id, target_id) index covers both the single-column
-- account_id FK and the matching composite FK through its leftmost prefix.
create index ct_target_availability_assessments_account_target_idx
  on public.ct_target_availability_assessments (account_id, target_id);
create index ct_target_availability_assessments_target_id_idx
  on public.ct_target_availability_assessments (target_id);

create index ct_target_availability_current_account_target_idx
  on public.ct_target_availability_current (account_id, target_id);
create index ct_target_availability_current_target_id_idx
  on public.ct_target_availability_current (target_id);

create index ct_target_availability_observations_target_id_idx
  on public.ct_target_availability_observations (target_id);

create index ct_target_identity_current_account_target_idx
  on public.ct_target_identity_current (account_id, target_id);
create index ct_target_identity_current_target_id_idx
  on public.ct_target_identity_current (target_id);
create index ct_target_identity_current_last_history_id_idx
  on public.ct_target_identity_current (last_history_id);

create index ct_target_identity_history_account_target_idx
  on public.ct_target_identity_history (account_id, target_id);
create index ct_target_identity_history_target_id_idx
  on public.ct_target_identity_history (target_id);
create index ct_target_identity_history_observation_id_idx
  on public.ct_target_identity_history (observation_id);
