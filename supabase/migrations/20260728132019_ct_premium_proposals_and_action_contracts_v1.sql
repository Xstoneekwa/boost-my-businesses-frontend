create table public.ct_targeting_criteria_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  plan text not null,
  entitlement_id uuid not null references public.client_account_entitlements(id) on delete restrict,
  entitlement_version text not null,
  eligible_target_count integer not null,
  active_targets jsonb not null,
  blacklist_fingerprint text not null,
  languages jsonb not null,
  geographies jsonb not null,
  niches jsonb not null,
  follower_range jsonb not null,
  engagement_expectations jsonb not null,
  account_analysis_data jsonb not null,
  target_performance_summary jsonb not null,
  lifecycle_summary jsonb not null,
  scoring_config_version text not null,
  search_strategy_version text not null,
  review_duration interval not null,
  batch_size integer not null,
  rejection_cooldown interval not null,
  trigger_reason text not null,
  canonical_payload jsonb not null,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint ct_targeting_criteria_snapshots_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_targeting_criteria_snapshots_plan_check check (plan = 'premium'),
  constraint ct_targeting_criteria_snapshots_counts_check check (eligible_target_count >= 0 and batch_size between 1 and 20),
  constraint ct_targeting_criteria_snapshots_intervals_check check (review_duration > interval '0' and rejection_cooldown >= interval '0'),
  constraint ct_targeting_criteria_snapshots_json_check check (
    jsonb_typeof(active_targets) = 'array' and
    jsonb_typeof(languages) = 'array' and
    jsonb_typeof(geographies) = 'array' and
    jsonb_typeof(niches) = 'array' and
    jsonb_typeof(follower_range) = 'object' and
    jsonb_typeof(engagement_expectations) = 'object' and
    jsonb_typeof(account_analysis_data) = 'object' and
    jsonb_typeof(target_performance_summary) = 'object' and
    jsonb_typeof(lifecycle_summary) = 'object' and
    jsonb_typeof(canonical_payload) = 'object'
  ),
  unique (tenant_id, account_id, fingerprint),
  unique (id, tenant_id, account_id)
);

create table public.ct_proposal_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  snapshot_id uuid not null,
  status text not null default 'preparing',
  trigger_reason text not null,
  idempotency_key text not null,
  ready_at timestamptz,
  review_expires_at timestamptz,
  claimed_at timestamptz,
  claim_token uuid,
  completed_at timestamptz,
  frozen_reason text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ct_proposal_batches_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_proposal_batches_snapshot_fkey
    foreign key (snapshot_id, tenant_id, account_id)
    references public.ct_targeting_criteria_snapshots(id, tenant_id, account_id) on delete restrict,
  constraint ct_proposal_batches_status_check check (status in (
    'preparing','ready_for_review','partially_reviewed','review_expired','auto_validation_pending',
    'activating','completed','frozen','canceled','failed'
  )),
  constraint ct_proposal_batches_review_dates_check check (
    (ready_at is null and review_expires_at is null) or
    (ready_at is not null and review_expires_at > ready_at)
  ),
  constraint ct_proposal_batches_claim_check check (
    (claim_token is null and claimed_at is null) or (claim_token is not null and claimed_at is not null)
  ),
  unique (tenant_id, account_id, idempotency_key),
  unique (id, tenant_id, account_id)
);

create table public.ct_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  batch_id uuid not null,
  snapshot_id uuid not null,
  replacement_of_target_id uuid,
  normalized_username text not null,
  display_username text not null,
  candidate_data jsonb not null,
  score numeric not null,
  score_breakdown jsonb not null,
  scoring_version text not null,
  eligibility_status text not null,
  exclusion_reasons text[] not null default '{}',
  status text not null default 'pending',
  decision_actor_type text,
  decision_actor_id uuid,
  decided_at timestamptz,
  activated_target_id uuid,
  activation_idempotency_key text,
  activation_error_code text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ct_proposals_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_proposals_batch_fkey
    foreign key (batch_id, tenant_id, account_id)
    references public.ct_proposal_batches(id, tenant_id, account_id) on delete restrict,
  constraint ct_proposals_snapshot_fkey
    foreign key (snapshot_id, tenant_id, account_id)
    references public.ct_targeting_criteria_snapshots(id, tenant_id, account_id) on delete restrict,
  constraint ct_proposals_replacement_target_fkey
    foreign key (account_id, replacement_of_target_id)
    references public.ig_targets(account_id, id) on delete restrict,
  constraint ct_proposals_activated_target_fkey
    foreign key (account_id, activated_target_id)
    references public.ig_targets(account_id, id) on delete restrict,
  constraint ct_proposals_username_check check (
    normalized_username = lower(btrim(normalized_username)) and normalized_username ~ '^[a-z0-9._]{1,30}$' and
    char_length(btrim(display_username)) between 1 and 64
  ),
  constraint ct_proposals_status_check check (status in (
    'pending','accepted','rejected','auto_accepted','invalidated','activation_pending','activated','activation_failed'
  )),
  constraint ct_proposals_eligibility_check check (eligibility_status in ('eligible','ineligible','revalidation_required','stale')),
  constraint ct_proposals_decision_shape_check check (
    (status = 'pending' and decided_at is null and decision_actor_type is null) or
    (status <> 'pending' and decided_at is not null)
  ),
  constraint ct_proposals_rejected_never_auto_check check (
    status <> 'rejected' or decision_actor_type <> 'system_timeout'
  ),
  constraint ct_proposals_activation_shape_check check (
    (status = 'activated' and activated_target_id is not null) or
    (status <> 'activated' and activated_target_id is null)
  ),
  unique (batch_id, normalized_username),
  unique (id, tenant_id, account_id)
);

create unique index ct_proposals_account_active_candidate_unique
  on public.ct_proposals (tenant_id, account_id, normalized_username)
  where status in ('pending','accepted','auto_accepted','activation_pending');

create unique index ig_targets_account_normalized_active_ct_unique
  on public.ig_targets (account_id, normalized_username)
  where archived_at is null and deleted_at is null and normalized_username is not null;

create table public.ct_proposal_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  batch_id uuid not null,
  proposal_id uuid,
  event_type text not null,
  actor_type text not null,
  actor_id uuid,
  idempotency_key text not null,
  payload_safe jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint ct_proposal_events_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_proposal_events_batch_fkey
    foreign key (batch_id, tenant_id, account_id)
    references public.ct_proposal_batches(id, tenant_id, account_id) on delete restrict,
  constraint ct_proposal_events_proposal_fkey
    foreign key (proposal_id, tenant_id, account_id)
    references public.ct_proposals(id, tenant_id, account_id) on delete restrict,
  constraint ct_proposal_events_type_check check (event_type in (
    'batch_created','batch_ready','proposal_created','accepted','rejected','auto_accepted','invalidated',
    'activation_started','activated','activation_failed','batch_completed','batch_frozen','batch_canceled'
  )),
  constraint ct_proposal_events_actor_check check (actor_type in ('client','service','system_timeout','commercial_transition')),
  constraint ct_proposal_events_payload_check check (jsonb_typeof(payload_safe) = 'object'),
  unique (tenant_id, account_id, idempotency_key)
);

create trigger ct_proposal_events_append_only
before update or delete on public.ct_proposal_events
for each row execute function public.ct_reject_append_only_mutation_v1();

create table public.ct_target_replacement_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  proposal_id uuid not null,
  replaced_target_id uuid not null,
  replacement_target_id uuid,
  state text not null default 'candidate',
  ready_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ct_target_replacement_links_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_target_replacement_links_proposal_fkey
    foreign key (proposal_id, tenant_id, account_id)
    references public.ct_proposals(id, tenant_id, account_id) on delete restrict,
  constraint ct_target_replacement_links_old_target_fkey
    foreign key (account_id, replaced_target_id)
    references public.ig_targets(account_id, id) on delete restrict,
  constraint ct_target_replacement_links_new_target_fkey
    foreign key (account_id, replacement_target_id)
    references public.ig_targets(account_id, id) on delete restrict,
  constraint ct_target_replacement_links_state_check check (state in ('candidate','accepted','ready','completed','canceled')),
  constraint ct_target_replacement_links_shape_check check (
    (state in ('candidate','accepted') and replacement_target_id is null) or
    (state in ('ready','completed') and replacement_target_id is not null)
  ),
  unique (proposal_id),
  unique (account_id, replaced_target_id, replacement_target_id)
);

alter table public.client_account_notifications
  add column action_required boolean not null default false,
  add column action_completed_at timestamptz,
  add column action_outcome text,
  add column action_ref_type text,
  add column action_ref_id uuid;

alter table public.client_account_notifications
  drop constraint client_account_notifications_category_check,
  add constraint client_account_notifications_category_check check (category in (
    'needs_more_target_accounts','needs_assistance','account_paused','account_canceled',
    'target_replacement_required_growth','target_replacement_required_pro','target_exhausted_targets_needed',
    'premium_ct_preparation_started','premium_ct_batch_ready','premium_ct_review_required','premium_ct_activation_result'
  )),
  add constraint client_account_notifications_action_shape_check check (
    (not action_required and action_ref_type is null and action_ref_id is null) or
    (action_required and action_ref_type is not null and action_ref_id is not null)
  ),
  add constraint client_account_notifications_action_completion_check check (
    (action_completed_at is null and action_outcome is null) or
    (action_completed_at is not null and action_outcome is not null)
  );

create index client_account_notifications_action_pending_idx
  on public.client_account_notifications (client_id, account_id, created_at desc)
  where action_required and action_completed_at is null;

create table public.ct_email_contract_references (
  contract_key text primary key,
  audience_plan text not null,
  action_ref_type text not null,
  payload_schema_version text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  constraint ct_email_contract_references_key_check check (contract_key in (
    'premium_ct_preparation_started','premium_ct_batch_ready','premium_ct_review_reminder',
    'premium_ct_auto_activation_result','premium_ct_batch_requires_review',
    'target_replacement_required_growth','target_replacement_required_pro','target_exhausted_targets_needed'
  )),
  constraint ct_email_contract_references_plan_check check (audience_plan in ('growth','pro','premium','cross_plan')),
  constraint ct_email_contract_references_action_check check (action_ref_type in ('proposal_batch','proposal','target','account'))
);

insert into public.ct_email_contract_references
  (contract_key, audience_plan, action_ref_type, payload_schema_version, enabled)
values
  ('premium_ct_preparation_started','premium','proposal_batch','v1',false),
  ('premium_ct_batch_ready','premium','proposal_batch','v1',false),
  ('premium_ct_review_reminder','premium','proposal_batch','v1',false),
  ('premium_ct_auto_activation_result','premium','proposal_batch','v1',false),
  ('premium_ct_batch_requires_review','premium','proposal_batch','v1',false),
  ('target_replacement_required_growth','growth','target','v1',false),
  ('target_replacement_required_pro','pro','target','v1',false),
  ('target_exhausted_targets_needed','cross_plan','account','v1',false);

create index ct_proposal_batches_review_claim_idx
  on public.ct_proposal_batches (review_expires_at, created_at)
  where status in ('ready_for_review','partially_reviewed');
create index ct_proposals_batch_status_idx
  on public.ct_proposals (batch_id, status, created_at);
create index ct_proposal_events_batch_time_idx
  on public.ct_proposal_events (batch_id, occurred_at, id);
create index ct_target_replacement_links_account_state_idx
  on public.ct_target_replacement_links (tenant_id, account_id, state, created_at);
