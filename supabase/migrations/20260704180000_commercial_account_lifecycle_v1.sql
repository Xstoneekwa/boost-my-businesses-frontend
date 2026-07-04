-- Commercial account lifecycle (pause / resume / cancel) — durable server-side state.
-- Not applied to production in this checkpoint; code/tests only.

create table if not exists public.commercial_account_lifecycle_states (
  account_id uuid primary key references public.ig_accounts(id) on delete cascade,
  entitlement_id uuid null references public.client_account_entitlements(id) on delete set null,
  stripe_subscription_id text null,
  commercial_state text not null default 'active',
  pause_expires_at timestamptz null,
  paused_at timestamptz null,
  stripe_billing_paused boolean not null default false,
  action_required_reason text null,
  last_operation_id uuid null,
  last_idempotency_key text null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_account_lifecycle_states_state_check check (
    commercial_state in (
      'active',
      'pause_requested',
      'paused',
      'resume_requested',
      'cancel_requested',
      'cancelled',
      'action_required'
    )
  )
);

create index if not exists commercial_account_lifecycle_states_pause_expiry_idx
  on public.commercial_account_lifecycle_states (pause_expires_at)
  where commercial_state = 'paused';

create table if not exists public.commercial_account_lifecycle_operations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  entitlement_id uuid null references public.client_account_entitlements(id) on delete set null,
  operation_type text not null,
  idempotency_key text not null,
  state text not null default 'pending',
  reason text null,
  actor_type text null,
  actor_id uuid null,
  source_surface text null,
  error_redacted text null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_account_lifecycle_operations_type_check check (
    operation_type in ('pause', 'resume', 'cancel')
  ),
  constraint commercial_account_lifecycle_operations_state_check check (
    state in ('pending', 'in_progress', 'completed', 'failed')
  ),
  constraint commercial_account_lifecycle_operations_idempotency_key unique (idempotency_key)
);

create index if not exists commercial_account_lifecycle_operations_account_idx
  on public.commercial_account_lifecycle_operations (account_id, created_at desc);

alter table public.commercial_stripe_subscriptions
  add column if not exists billing_paused boolean not null default false,
  add column if not exists pause_collection_behavior text null;

comment on table public.commercial_account_lifecycle_states is
  'Canonical per-account commercial lifecycle (pause/resume/cancel). Server-owned; survives restarts.';
comment on table public.commercial_account_lifecycle_operations is
  'Idempotent commercial lifecycle operation ledger for pause/resume/cancel.';
