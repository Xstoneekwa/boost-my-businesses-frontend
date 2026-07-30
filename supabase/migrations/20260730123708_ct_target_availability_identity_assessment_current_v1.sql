-- NOT DEPLOYED: local Target Availability Identity/Assessment/Current contract.
-- Additive and backward-compatible only. No backfill, trigger, RPC, runtime flag,
-- lifecycle action, target mutation, notification or client-facing grant.

alter table public.ct_target_identity_history
  add column transition_type_v3 text,
  add column evidence_count integer not null default 1,
  add column first_observed_at timestamptz,
  add column last_observed_at timestamptz,
  add column source_observation_ids uuid[] not null default '{}'::uuid[],
  add column rule_version text,
  add column engine_version text,
  add constraint ct_target_identity_history_transition_type_v3_check
    check (transition_type_v3 is null or transition_type_v3 in (
      'identity_confirmed','identity_probable','username_change_suspected',
      'username_change_confirmed','identity_conflict','identity_ambiguous',
      'stable_id_missing','stale_identity','insufficient_identity_evidence'
    )),
  add constraint ct_target_identity_history_evidence_count_v3_check
    check (evidence_count between 1 and 10000),
  add constraint ct_target_identity_history_observed_window_v3_check
    check (first_observed_at is null or last_observed_at is null or first_observed_at <= last_observed_at),
  add constraint ct_target_identity_history_source_ids_v3_check
    check (cardinality(source_observation_ids) between 0 and 10000),
  add constraint ct_target_identity_history_versions_v3_check
    check (
      (rule_version is null or char_length(btrim(rule_version)) between 1 and 100)
      and (engine_version is null or char_length(btrim(engine_version)) between 1 and 100)
    );

alter table public.ct_target_identity_current
  add column observed_username text,
  add column domain_identity_status text,
  add column evidence_count integer not null default 0,
  add column first_seen_at timestamptz,
  add column last_seen_at timestamptz,
  add column last_confirmed_at timestamptz,
  add column stale_after timestamptz,
  add column source_version text,
  add constraint ct_target_identity_current_observed_username_v3_check
    check (observed_username is null or (observed_username = lower(btrim(observed_username)) and observed_username ~ '^[a-z0-9._]{1,30}$')),
  add constraint ct_target_identity_current_domain_status_v3_check
    check (domain_identity_status is null or domain_identity_status in (
      'identity_confirmed','identity_probable','username_change_suspected',
      'username_change_confirmed','identity_conflict','identity_ambiguous',
      'stable_id_missing','stale_identity','insufficient_identity_evidence'
    )),
  add constraint ct_target_identity_current_evidence_count_v3_check
    check (evidence_count between 0 and 10000),
  add constraint ct_target_identity_current_seen_window_v3_check
    check (first_seen_at is null or last_seen_at is null or first_seen_at <= last_seen_at),
  add constraint ct_target_identity_current_confirmed_window_v3_check
    check (last_confirmed_at is null or last_seen_at is null or last_confirmed_at <= last_seen_at),
  add constraint ct_target_identity_current_source_version_v3_check
    check (source_version is null or char_length(btrim(source_version)) between 1 and 100);

alter table public.ct_target_availability_assessments
  add column assessment_status_v3 text,
  add column identity_status_v3 text,
  add column contributing_observation_ids uuid[] not null default '{}'::uuid[],
  add column ignored_observation_ids uuid[] not null default '{}'::uuid[],
  add column repeat_count integer not null default 0,
  add column rule_version text,
  add column engine_version text,
  add column engine_revision integer,
  add column policy_revision integer,
  add column first_evidence_at timestamptz,
  add column last_evidence_at timestamptz,
  add column valid_until timestamptz,
  add column explanation_safe jsonb not null default '{}'::jsonb,
  add column missing_evidence text[] not null default '{}'::text[],
  add constraint ct_target_availability_assessments_status_v3_check
    check (assessment_status_v3 is null or assessment_status_v3 in (
      'available','likely_available','temporarily_unavailable','unavailable_suspected',
      'unavailable_confirmed','identity_changed','identity_ambiguous',
      'verified_restricted_suspected','verified_restricted_confirmed','stale',
      'insufficient_evidence','conflicting_evidence'
    )),
  add constraint ct_target_availability_assessments_identity_status_v3_check
    check (identity_status_v3 is null or identity_status_v3 in (
      'identity_confirmed','identity_probable','username_change_suspected',
      'username_change_confirmed','identity_conflict','identity_ambiguous',
      'stable_id_missing','stale_identity','insufficient_identity_evidence'
    )),
  add constraint ct_target_availability_assessments_observation_ids_v3_check
    check (
      cardinality(contributing_observation_ids) between 0 and 10000
      and cardinality(ignored_observation_ids) between 0 and 10000
    ),
  add constraint ct_target_availability_assessments_repeat_count_v3_check
    check (repeat_count between 0 and 10000),
  add constraint ct_target_availability_assessments_versions_v3_check
    check (
      (rule_version is null or char_length(btrim(rule_version)) between 1 and 100)
      and (engine_version is null or char_length(btrim(engine_version)) between 1 and 100)
      and (engine_revision is null or engine_revision > 0)
      and (policy_revision is null or policy_revision > 0)
    ),
  add constraint ct_target_availability_assessments_evidence_window_v3_check
    check (first_evidence_at is null or last_evidence_at is null or first_evidence_at <= last_evidence_at),
  add constraint ct_target_availability_assessments_validity_v3_check
    check (valid_until is null or valid_until >= assessed_at),
  add constraint ct_target_availability_assessments_explanation_v3_check
    check (jsonb_typeof(explanation_safe) = 'object' and cardinality(missing_evidence) between 0 and 64);

alter table public.ct_target_availability_current
  add column availability_status text,
  add column confidence text,
  add column identity_status text,
  add column latest_observation_at timestamptz,
  add column confirmed_at timestamptz,
  add column valid_until timestamptz,
  add column stale_after timestamptz,
  add column reason_codes text[] not null default '{}'::text[],
  add column engine_version text,
  add column policy_version text,
  add column engine_revision integer,
  add column policy_revision integer,
  add constraint ct_target_availability_current_status_v3_check
    check (availability_status is null or availability_status in (
      'available','likely_available','temporarily_unavailable','unavailable_suspected',
      'unavailable_confirmed','identity_changed','identity_ambiguous',
      'verified_restricted_suspected','verified_restricted_confirmed','stale',
      'insufficient_evidence','conflicting_evidence'
    )),
  add constraint ct_target_availability_current_confidence_v3_check
    check (confidence is null or confidence in ('unknown','low','medium','high')),
  add constraint ct_target_availability_current_identity_status_v3_check
    check (identity_status is null or identity_status in (
      'identity_confirmed','identity_probable','username_change_suspected',
      'username_change_confirmed','identity_conflict','identity_ambiguous',
      'stable_id_missing','stale_identity','insufficient_identity_evidence'
    )),
  add constraint ct_target_availability_current_reason_codes_v3_check
    check (cardinality(reason_codes) between 0 and 64),
  add constraint ct_target_availability_current_versions_v3_check
    check (
      (engine_version is null or char_length(btrim(engine_version)) between 1 and 100)
      and (policy_version is null or char_length(btrim(policy_version)) between 1 and 100)
      and (engine_revision is null or engine_revision > 0)
      and (policy_revision is null or policy_revision > 0)
    ),
  add constraint ct_target_availability_current_validity_v3_check
    check (valid_until is null or latest_observation_at is null or valid_until >= latest_observation_at),
  add constraint ct_target_availability_current_stale_v3_check
    check (stale_after is null or valid_until is null or stale_after >= valid_until),
  add constraint ct_target_availability_current_confirmed_v3_check
    check (confirmed_at is null or latest_observation_at is null or confirmed_at <= latest_observation_at);

create index ct_target_identity_history_last_observed_v3_idx
  on public.ct_target_identity_history (tenant_id, account_id, target_id, last_observed_at desc)
  where last_observed_at is not null;
create index ct_target_identity_current_stale_after_v3_idx
  on public.ct_target_identity_current (stale_after)
  where stale_after is not null;
create index ct_target_availability_assessments_valid_until_v3_idx
  on public.ct_target_availability_assessments (valid_until)
  where valid_until is not null;
create index ct_target_availability_current_stale_after_v3_idx
  on public.ct_target_availability_current (stale_after)
  where stale_after is not null;

-- Reassert the existing fail-closed boundary after additive schema evolution.
alter table public.ct_target_identity_history enable row level security;
alter table public.ct_target_identity_history force row level security;
alter table public.ct_target_identity_current enable row level security;
alter table public.ct_target_identity_current force row level security;
alter table public.ct_target_availability_assessments enable row level security;
alter table public.ct_target_availability_assessments force row level security;
alter table public.ct_target_availability_current enable row level security;
alter table public.ct_target_availability_current force row level security;

revoke all privileges on table public.ct_target_identity_history from public, anon, authenticated, service_role;
revoke all privileges on table public.ct_target_identity_current from public, anon, authenticated, service_role;
revoke all privileges on table public.ct_target_availability_assessments from public, anon, authenticated, service_role;
revoke all privileges on table public.ct_target_availability_current from public, anon, authenticated, service_role;

grant select, insert on table public.ct_target_identity_history to service_role;
grant select, insert, update on table public.ct_target_identity_current to service_role;
grant select, insert on table public.ct_target_availability_assessments to service_role;
grant select, insert, update on table public.ct_target_availability_current to service_role;

comment on column public.ct_target_identity_current.domain_identity_status is
  'Versioned Target Availability identity state. Legacy identity_status remains the compatibility projection.';
comment on column public.ct_target_availability_assessments.assessment_status_v3 is
  'Pure Target Availability assessment state; never a Lifecycle or replacement decision.';
comment on column public.ct_target_availability_current.availability_status is
  'Latest pure Availability projection only. It authorizes no business action.';
