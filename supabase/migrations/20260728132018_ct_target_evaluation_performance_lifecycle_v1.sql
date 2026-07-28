-- Post-cutover migration. Never replay the bootstrap baseline on an existing project.

alter table public.ig_targets
  add constraint ig_targets_account_id_id_ct_unique unique (account_id, id);

create table public.ct_target_evaluation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  target_id uuid not null references public.ig_targets(id) on delete restrict,
  normalized_username text not null,
  evaluated_at timestamptz not null,
  business_date date not null,
  outcome text not null,
  source_run_id uuid references public.ig_runs(id) on delete set null,
  source_worker text,
  attribution_reliability text not null,
  worker_version text,
  idempotency_key text not null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ct_target_evaluation_events_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_target_evaluation_events_account_target_fkey
    foreign key (account_id, target_id)
    references public.ig_targets(account_id, id) on delete restrict,
  constraint ct_target_evaluation_events_username_check
    check (normalized_username = lower(btrim(normalized_username)) and normalized_username ~ '^[a-z0-9._]{1,30}$'),
  constraint ct_target_evaluation_events_outcome_check
    check (outcome in ('eligible','follow_attempted','follow_succeeded','follow_failed','filtered','duplicate','private','not_found','rate_limited','provider_error')),
  constraint ct_target_evaluation_events_reliability_check
    check (attribution_reliability in ('verified','strong','estimated','unknown')),
  constraint ct_target_evaluation_events_idempotency_check
    check (char_length(btrim(idempotency_key)) between 8 and 200),
  constraint ct_target_evaluation_events_metadata_check
    check (jsonb_typeof(metadata_safe) = 'object'),
  unique (tenant_id, account_id, idempotency_key)
);

create table public.ct_target_evaluated_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  target_id uuid not null references public.ig_targets(id) on delete restrict,
  normalized_username text not null,
  first_event_id uuid not null references public.ct_target_evaluation_events(id) on delete restrict,
  first_evaluated_at timestamptz not null,
  first_business_date date not null,
  created_at timestamptz not null default now(),
  constraint ct_target_evaluated_profiles_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_target_evaluated_profiles_account_target_fkey
    foreign key (account_id, target_id)
    references public.ig_targets(account_id, id) on delete restrict,
  constraint ct_target_evaluated_profiles_username_check
    check (normalized_username = lower(btrim(normalized_username)) and normalized_username ~ '^[a-z0-9._]{1,30}$'),
  unique (tenant_id, account_id, target_id, normalized_username)
);

create table public.ct_target_performance_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  source_target_id uuid not null references public.ig_targets(id) on delete restrict,
  business_date date not null,
  window_kind text not null,
  follows integer not null,
  followbacks integer not null,
  fbr numeric generated always as (
    case when follows > 0 then followbacks::numeric / follows::numeric else null end
  ) stored,
  reliability text not null,
  reason text not null,
  observed_at timestamptz not null,
  source_event_key text not null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ct_target_performance_observations_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_target_performance_observations_account_target_fkey
    foreign key (account_id, source_target_id)
    references public.ig_targets(account_id, id) on delete restrict,
  constraint ct_target_performance_observations_counts_check
    check (follows >= 0 and followbacks >= 0 and followbacks <= follows),
  constraint ct_target_performance_observations_window_check
    check (window_kind in ('business_day','rolling_7d','rolling_30d','lifetime')),
  constraint ct_target_performance_observations_reliability_check
    check (reliability in ('verified','strong','estimated','unknown')),
  constraint ct_target_performance_observations_reason_check
    check (reason in ('worker_verified','interaction_events','legacy_counter','snapshot','manual_audit')),
  unique (tenant_id, account_id, source_target_id, source_event_key)
);

create table public.ct_target_performance_aggregates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  source_target_id uuid not null references public.ig_targets(id) on delete restrict,
  window_kind text not null,
  window_start_business_date date not null,
  window_end_business_date date not null,
  follows integer not null,
  followbacks integer not null,
  fbr numeric generated always as (
    case when follows > 0 then followbacks::numeric / follows::numeric else null end
  ) stored,
  reliability text not null,
  reason text not null,
  source_version text not null,
  computed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ct_target_performance_aggregates_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_target_performance_aggregates_account_target_fkey
    foreign key (account_id, source_target_id)
    references public.ig_targets(account_id, id) on delete restrict,
  constraint ct_target_performance_aggregates_dates_check
    check (window_end_business_date >= window_start_business_date),
  constraint ct_target_performance_aggregates_counts_check
    check (follows >= 0 and followbacks >= 0 and followbacks <= follows),
  constraint ct_target_performance_aggregates_window_check
    check (window_kind in ('business_day','rolling_7d','rolling_30d','lifetime')),
  constraint ct_target_performance_aggregates_reliability_check
    check (reliability in ('verified','strong','estimated','unknown')),
  unique (tenant_id, account_id, source_target_id, window_kind, window_start_business_date, window_end_business_date)
);

create table public.ct_target_lifecycle_assessments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  target_id uuid not null references public.ig_targets(id) on delete restrict,
  assessment_key text not null,
  status text not null,
  utilization_ratio numeric,
  unique_profiles_evaluated integer not null,
  estimated_exploitable_audience integer,
  denominator_source text not null,
  denominator_version text not null,
  confidence text not null,
  reason_codes text[] not null default '{}',
  replacement_state text not null default 'none',
  assessed_at timestamptz not null,
  archived_at timestamptz,
  archive_reason text,
  created_at timestamptz not null default now(),
  constraint ct_target_lifecycle_assessments_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_target_lifecycle_assessments_account_target_fkey
    foreign key (account_id, target_id)
    references public.ig_targets(account_id, id) on delete restrict,
  constraint ct_target_lifecycle_assessments_status_check
    check (status in ('healthy','watch','replacement_recommended','replacement_pending','exhausted','archived','stale_data','insufficient_data')),
  constraint ct_target_lifecycle_assessments_ratio_check
    check (utilization_ratio is null or utilization_ratio >= 0),
  constraint ct_target_lifecycle_assessments_counts_check
    check (unique_profiles_evaluated >= 0 and (estimated_exploitable_audience is null or estimated_exploitable_audience > 0)),
  constraint ct_target_lifecycle_assessments_confidence_check
    check (confidence in ('high','medium','low','unknown')),
  constraint ct_target_lifecycle_assessments_replacement_check
    check (replacement_state in ('none','recommended','pending','ready','completed','canceled')),
  constraint ct_target_lifecycle_assessments_archive_check
    check ((status = 'archived') = (archived_at is not null) and (archived_at is null or archive_reason is not null)),
  unique (tenant_id, account_id, target_id, assessment_key)
);

create table public.ct_target_lifecycle_current (
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  target_id uuid not null references public.ig_targets(id) on delete restrict,
  assessment_id uuid not null unique references public.ct_target_lifecycle_assessments(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, account_id, target_id),
  constraint ct_target_lifecycle_current_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_target_lifecycle_current_account_target_fkey
    foreign key (account_id, target_id)
    references public.ig_targets(account_id, id) on delete restrict
);

create view public.ct_target_lifecycle_stock_v1
with (security_invoker = true)
as
select
  t.account_id,
  count(*) filter (
    where t.archived_at is null and t.deleted_at is null
      and coalesce(a.status, 'insufficient_data') <> 'archived'
  )::integer as stock_count,
  count(*) filter (
    where t.archived_at is null and t.deleted_at is null
      and a.status = 'replacement_pending'
  )::integer as replacement_pending_in_stock,
  count(*) filter (
    where t.archived_at is null and t.deleted_at is null
      and a.status = 'exhausted'
  )::integer as exhausted_in_stock
from public.ig_targets t
left join public.ct_target_lifecycle_current cur
  on cur.account_id = t.account_id and cur.target_id = t.id
left join public.ct_target_lifecycle_assessments a on a.id = cur.assessment_id
group by t.account_id;

create or replace function public.ct_reject_append_only_mutation_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ct_append_only_relation';
end
$$;

create trigger ct_target_evaluation_events_append_only
before update or delete on public.ct_target_evaluation_events
for each row execute function public.ct_reject_append_only_mutation_v1();

create trigger ct_target_performance_observations_append_only
before update or delete on public.ct_target_performance_observations
for each row execute function public.ct_reject_append_only_mutation_v1();

create trigger ct_target_lifecycle_assessments_append_only
before update or delete on public.ct_target_lifecycle_assessments
for each row execute function public.ct_reject_append_only_mutation_v1();

create index ct_target_evaluation_events_account_date_idx
  on public.ct_target_evaluation_events (tenant_id, account_id, business_date, evaluated_at desc);
create index ct_target_evaluation_events_target_idx
  on public.ct_target_evaluation_events (account_id, target_id, evaluated_at desc);
create index ct_target_evaluated_profiles_target_idx
  on public.ct_target_evaluated_profiles (tenant_id, account_id, target_id);
create index ct_target_performance_observations_target_date_idx
  on public.ct_target_performance_observations (tenant_id, account_id, source_target_id, business_date desc);
create index ct_target_performance_aggregates_target_idx
  on public.ct_target_performance_aggregates (tenant_id, account_id, source_target_id, window_end_business_date desc);
create index ct_target_lifecycle_assessments_target_idx
  on public.ct_target_lifecycle_assessments (tenant_id, account_id, target_id, assessed_at desc);
