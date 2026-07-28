-- Phase 8B.1 dormant Target Availability foundations.
-- Additive only: no data backfill, no runtime activation and no mutation of ig_targets.

create table public.ct_target_availability_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  target_id uuid not null references public.ig_targets(id) on delete restrict,
  observed_at timestamptz not null,
  source text not null,
  source_run_id uuid references public.ig_runs(id) on delete set null,
  source_worker text,
  worker_version text,
  source_device_key text,
  instagram_version text,
  searched_username text not null,
  observed_username text,
  observed_stable_platform_user_id text,
  lookup_result text not null,
  profile_found boolean,
  verified_badge boolean,
  followers_surface text not null,
  accessible_profiles_count integer,
  terminal_end_detected boolean not null default false,
  repeated_first_profiles_detected boolean not null default false,
  retry_count integer not null default 0,
  retry_budget_exhausted boolean not null default false,
  navigation_timeout boolean not null default false,
  recovery_outcome text not null default 'not_attempted',
  ui_evidence_quality text not null default 'unknown',
  network_state text not null default 'unknown',
  session_state text not null default 'unknown',
  reason_codes text[] not null default '{}',
  idempotency_key text not null,
  evidence_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ct_target_availability_observations_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_target_availability_observations_account_target_fkey
    foreign key (account_id, target_id)
    references public.ig_targets(account_id, id) on delete restrict,
  constraint ct_target_availability_observations_source_check
    check (source in ('worker','provider','operator','synthetic')),
  constraint ct_target_availability_observations_searched_username_check
    check (searched_username = lower(btrim(searched_username)) and searched_username ~ '^[a-z0-9._]{1,30}$'),
  constraint ct_target_availability_observations_observed_username_check
    check (observed_username is null or (observed_username = lower(btrim(observed_username)) and observed_username ~ '^[a-z0-9._]{1,30}$')),
  constraint ct_target_availability_observations_stable_id_check
    check (observed_stable_platform_user_id is null or char_length(btrim(observed_stable_platform_user_id)) between 1 and 200),
  constraint ct_target_availability_observations_lookup_check
    check (lookup_result in ('found','not_found','unavailable','failed','unknown')),
  constraint ct_target_availability_observations_followers_surface_check
    check (followers_surface in ('normal','restricted','terminally_limited','unknown')),
  constraint ct_target_availability_observations_accessible_count_check
    check (accessible_profiles_count is null or accessible_profiles_count >= 0),
  constraint ct_target_availability_observations_retry_count_check
    check (retry_count between 0 and 100),
  constraint ct_target_availability_observations_recovery_check
    check (recovery_outcome in ('not_attempted','succeeded','failed','ambiguous')),
  constraint ct_target_availability_observations_ui_quality_check
    check (ui_evidence_quality in ('unknown','low','medium','high')),
  constraint ct_target_availability_observations_network_check
    check (network_state in ('unknown','healthy','degraded','unavailable')),
  constraint ct_target_availability_observations_session_check
    check (session_state in ('unknown','healthy','restricted','logged_out')),
  constraint ct_target_availability_observations_reason_codes_check
    check (cardinality(reason_codes) between 1 and 24),
  constraint ct_target_availability_observations_idempotency_check
    check (char_length(btrim(idempotency_key)) between 8 and 200),
  constraint ct_target_availability_observations_evidence_check
    check (jsonb_typeof(evidence_safe) = 'object'),
  unique (tenant_id, account_id, idempotency_key)
);

create table public.ct_target_identity_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  target_id uuid not null references public.ig_targets(id) on delete restrict,
  observation_id uuid references public.ct_target_availability_observations(id) on delete restrict,
  previous_username text not null,
  observed_username text,
  stable_platform_user_id text,
  resolution text not null,
  confidence text not null,
  reason_codes text[] not null default '{}',
  idempotency_key text not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ct_target_identity_history_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_target_identity_history_account_target_fkey
    foreign key (account_id, target_id)
    references public.ig_targets(account_id, id) on delete restrict,
  constraint ct_target_identity_history_previous_username_check
    check (previous_username = lower(btrim(previous_username)) and previous_username ~ '^[a-z0-9._]{1,30}$'),
  constraint ct_target_identity_history_observed_username_check
    check (observed_username is null or (observed_username = lower(btrim(observed_username)) and observed_username ~ '^[a-z0-9._]{1,30}$')),
  constraint ct_target_identity_history_stable_id_check
    check (stable_platform_user_id is null or char_length(btrim(stable_platform_user_id)) between 1 and 200),
  constraint ct_target_identity_history_resolution_check
    check (resolution in ('unchanged','matched_rename','conflict','previous_username_reassigned','unresolved')),
  constraint ct_target_identity_history_confidence_check
    check (confidence in ('high','medium','low','unknown')),
  constraint ct_target_identity_history_reason_codes_check
    check (cardinality(reason_codes) between 1 and 16),
  constraint ct_target_identity_history_idempotency_check
    check (char_length(btrim(idempotency_key)) between 8 and 200),
  unique (tenant_id, account_id, idempotency_key)
);

create table public.ct_target_identity_current (
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  target_id uuid not null references public.ig_targets(id) on delete restrict,
  current_username text not null,
  stable_platform_user_id text,
  identity_status text not null,
  confidence text not null,
  last_history_id uuid references public.ct_target_identity_history(id) on delete restrict,
  last_observed_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, account_id, target_id),
  constraint ct_target_identity_current_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_target_identity_current_account_target_fkey
    foreign key (account_id, target_id)
    references public.ig_targets(account_id, id) on delete restrict,
  constraint ct_target_identity_current_username_check
    check (current_username = lower(btrim(current_username)) and current_username ~ '^[a-z0-9._]{1,30}$'),
  constraint ct_target_identity_current_stable_id_check
    check (stable_platform_user_id is null or char_length(btrim(stable_platform_user_id)) between 1 and 200),
  constraint ct_target_identity_current_status_check
    check (identity_status in ('unchanged','matched_rename','conflict','previous_username_reassigned','unresolved')),
  constraint ct_target_identity_current_confidence_check
    check (confidence in ('high','medium','low','unknown'))
);

create table public.ct_target_availability_assessments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  target_id uuid not null references public.ig_targets(id) on delete restrict,
  assessment_key text not null,
  normalized_username text not null,
  stable_platform_user_id text,
  status text not null,
  confidence text not null,
  identity_resolution text not null,
  reason_codes text[] not null default '{}',
  evidence_count integer not null,
  distinct_run_count integer not null,
  distinct_device_count integer not null,
  latest_observed_at timestamptz,
  recheck_required boolean not null,
  next_recheck_at timestamptz,
  quarantine_recommended boolean not null,
  quarantine_until timestamptz,
  terminal_proof boolean not null,
  assessed_at timestamptz not null,
  model_version text not null,
  created_at timestamptz not null default now(),
  constraint ct_target_availability_assessments_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_target_availability_assessments_account_target_fkey
    foreign key (account_id, target_id)
    references public.ig_targets(account_id, id) on delete restrict,
  constraint ct_target_availability_assessments_username_check
    check (normalized_username = lower(btrim(normalized_username)) and normalized_username ~ '^[a-z0-9._]{1,30}$'),
  constraint ct_target_availability_assessments_stable_id_check
    check (stable_platform_user_id is null or char_length(btrim(stable_platform_user_id)) between 1 and 200),
  constraint ct_target_availability_assessments_status_check
    check (status in ('available','username_changed','verified_restricted','temporarily_unavailable','permanently_unavailable','lookup_failed','followers_surface_restricted','suspended_or_disabled','deleted_or_not_found','identity_conflict','stale_evidence','insufficient_evidence','availability_unknown')),
  constraint ct_target_availability_assessments_confidence_check
    check (confidence in ('high','medium','low','unknown')),
  constraint ct_target_availability_assessments_identity_check
    check (identity_resolution in ('unchanged','matched_rename','conflict','unresolved')),
  constraint ct_target_availability_assessments_reason_codes_check
    check (cardinality(reason_codes) between 1 and 24),
  constraint ct_target_availability_assessments_counts_check
    check (evidence_count >= 0 and distinct_run_count >= 0 and distinct_device_count >= 0),
  constraint ct_target_availability_assessments_recheck_check
    check ((not recheck_required and next_recheck_at is null) or recheck_required),
  constraint ct_target_availability_assessments_quarantine_check
    check ((not quarantine_recommended and quarantine_until is null) or quarantine_recommended),
  constraint ct_target_availability_assessments_model_check
    check (char_length(btrim(model_version)) between 1 and 100),
  constraint ct_target_availability_assessments_key_check
    check (char_length(btrim(assessment_key)) between 8 and 200),
  unique (tenant_id, account_id, target_id, assessment_key)
);

create table public.ct_target_availability_current (
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  target_id uuid not null references public.ig_targets(id) on delete restrict,
  assessment_id uuid not null unique references public.ct_target_availability_assessments(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, account_id, target_id),
  constraint ct_target_availability_current_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_target_availability_current_account_target_fkey
    foreign key (account_id, target_id)
    references public.ig_targets(account_id, id) on delete restrict
);

create trigger ct_target_availability_observations_append_only
before update or delete on public.ct_target_availability_observations
for each row execute function public.ct_reject_append_only_mutation_v1();

create trigger ct_target_identity_history_append_only
before update or delete on public.ct_target_identity_history
for each row execute function public.ct_reject_append_only_mutation_v1();

create trigger ct_target_availability_assessments_append_only
before update or delete on public.ct_target_availability_assessments
for each row execute function public.ct_reject_append_only_mutation_v1();

create index ct_target_availability_observations_target_time_idx
  on public.ct_target_availability_observations (tenant_id, account_id, target_id, observed_at desc);
create index ct_target_availability_observations_recheck_inputs_idx
  on public.ct_target_availability_observations (account_id, target_id, lookup_result, observed_at desc);
create index ct_target_availability_observations_run_idx
  on public.ct_target_availability_observations (source_run_id)
  where source_run_id is not null;
create index ct_target_identity_history_target_time_idx
  on public.ct_target_identity_history (tenant_id, account_id, target_id, observed_at desc);
create index ct_target_identity_history_stable_id_idx
  on public.ct_target_identity_history (stable_platform_user_id)
  where stable_platform_user_id is not null;
create index ct_target_identity_current_stable_id_idx
  on public.ct_target_identity_current (account_id, stable_platform_user_id)
  where stable_platform_user_id is not null;
create index ct_target_availability_assessments_target_time_idx
  on public.ct_target_availability_assessments (tenant_id, account_id, target_id, assessed_at desc);
create index ct_target_availability_assessments_recheck_idx
  on public.ct_target_availability_assessments (next_recheck_at)
  where recheck_required and next_recheck_at is not null;
create index ct_target_availability_assessments_quarantine_idx
  on public.ct_target_availability_assessments (quarantine_until)
  where quarantine_recommended and quarantine_until is not null;

comment on table public.ct_target_availability_observations is
  'Append-only, redacted Target Availability evidence. Dormant in Phase 8B.1; service-role only.';
comment on table public.ct_target_identity_history is
  'Append-only Target identity observations and rename/conflict assessments. Never renames ig_targets.';
comment on table public.ct_target_identity_current is
  'Service-role-only current Target identity projection. Dormant and not exposed to client projections.';
comment on table public.ct_target_availability_assessments is
  'Append-only pure Availability assessments. Contains no archive, replacement, email or notification command.';
comment on table public.ct_target_availability_current is
  'Current pointer to a Target Availability assessment. No lifecycle action is implied.';

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'ct_target_availability_observations',
    'ct_target_identity_history',
    'ct_target_identity_current',
    'ct_target_availability_assessments',
    'ct_target_availability_current'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
  end loop;
end
$$;

create policy ct_target_availability_observations_service_role_all
  on public.ct_target_availability_observations to service_role using (true) with check (true);
create policy ct_target_identity_history_service_role_all
  on public.ct_target_identity_history to service_role using (true) with check (true);
create policy ct_target_identity_current_service_role_all
  on public.ct_target_identity_current to service_role using (true) with check (true);
create policy ct_target_availability_assessments_service_role_all
  on public.ct_target_availability_assessments to service_role using (true) with check (true);
create policy ct_target_availability_current_service_role_all
  on public.ct_target_availability_current to service_role using (true) with check (true);

grant select, insert on public.ct_target_availability_observations to service_role;
grant select, insert on public.ct_target_identity_history to service_role;
grant select, insert, update on public.ct_target_identity_current to service_role;
grant select, insert on public.ct_target_availability_assessments to service_role;
grant select, insert, update on public.ct_target_availability_current to service_role;
