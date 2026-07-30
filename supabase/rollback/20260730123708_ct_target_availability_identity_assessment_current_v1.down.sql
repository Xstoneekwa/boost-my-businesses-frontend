-- DOCUMENTARY ROLLBACK ONLY — NOT DEPLOYED AND NOT AUTHORIZED FOR EXECUTION.

drop index if exists public.ct_target_availability_current_stale_after_v3_idx;
drop index if exists public.ct_target_availability_assessments_valid_until_v3_idx;
drop index if exists public.ct_target_identity_current_stale_after_v3_idx;
drop index if exists public.ct_target_identity_history_last_observed_v3_idx;

alter table public.ct_target_availability_current
  drop column if exists policy_revision,
  drop column if exists engine_revision,
  drop column if exists policy_version,
  drop column if exists engine_version,
  drop column if exists reason_codes,
  drop column if exists stale_after,
  drop column if exists valid_until,
  drop column if exists confirmed_at,
  drop column if exists latest_observation_at,
  drop column if exists identity_status,
  drop column if exists confidence,
  drop column if exists availability_status;

alter table public.ct_target_availability_assessments
  drop column if exists missing_evidence,
  drop column if exists explanation_safe,
  drop column if exists valid_until,
  drop column if exists last_evidence_at,
  drop column if exists first_evidence_at,
  drop column if exists policy_revision,
  drop column if exists engine_revision,
  drop column if exists engine_version,
  drop column if exists rule_version,
  drop column if exists repeat_count,
  drop column if exists ignored_observation_ids,
  drop column if exists contributing_observation_ids,
  drop column if exists identity_status_v3,
  drop column if exists assessment_status_v3;

alter table public.ct_target_identity_current
  drop column if exists source_version,
  drop column if exists stale_after,
  drop column if exists last_confirmed_at,
  drop column if exists last_seen_at,
  drop column if exists first_seen_at,
  drop column if exists evidence_count,
  drop column if exists domain_identity_status,
  drop column if exists observed_username;

alter table public.ct_target_identity_history
  drop column if exists engine_version,
  drop column if exists rule_version,
  drop column if exists source_observation_ids,
  drop column if exists last_observed_at,
  drop column if exists first_observed_at,
  drop column if exists evidence_count,
  drop column if exists transition_type_v3;
