-- Stripe Test foundation: price catalog, checkout attempts, webhook ledger, billing projection.
-- Additive only. Does not modify existing simulation statuses or RPC behavior.

alter table public.commercial_checkout_sessions
  drop constraint if exists commercial_checkout_sessions_status_check;

alter table public.commercial_checkout_sessions
  add constraint commercial_checkout_sessions_status_check
  check (status in (
    'checkout_pending',
    'checkout_activated_test',
    'checkout_cancelled',
    'checkout_pending_payment',
    'checkout_paid',
    'checkout_expired',
    'checkout_failed',
    'checkout_refunded'
  ));

create table if not exists public.commercial_stripe_price_catalog (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('test', 'live')),
  plan_key text not null check (plan_key in ('growth', 'pro', 'premium')),
  billing_interval_months integer not null check (billing_interval_months in (1, 3, 6, 12)),
  outreach_addon_key text not null default 'none'
    check (outreach_addon_key in ('none', 'outreach_standard', 'outreach_ai')),
  stripe_product_id text not null,
  stripe_price_id text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_stripe_price_catalog_unique_key
    unique (environment, plan_key, billing_interval_months, outreach_addon_key)
);

create index if not exists commercial_stripe_price_catalog_active_idx
  on public.commercial_stripe_price_catalog (environment, active)
  where active = true;

create table if not exists public.commercial_stripe_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  commercial_checkout_session_id uuid null
    references public.commercial_checkout_sessions(id) on delete set null,
  plan_change_quote_id uuid null
    references public.commercial_plan_change_quotes(id) on delete set null,
  idempotency_key text not null unique,
  flow_type text not null check (flow_type in ('first_purchase', 'additional_account', 'plan_change')),
  stripe_checkout_session_id text not null unique,
  stripe_customer_id text null,
  stripe_subscription_id text null,
  stripe_payment_intent_id text null,
  checkout_mode text not null check (checkout_mode in ('subscription', 'payment')),
  livemode boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'session_created', 'completed', 'expired', 'failed', 'cancelled')),
  client_id uuid null references public.clients(id) on delete set null,
  auth_user_id uuid null,
  purchaser_email text not null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists commercial_stripe_checkout_attempts_session_idx
  on public.commercial_stripe_checkout_attempts (commercial_checkout_session_id);

create index if not exists commercial_stripe_checkout_attempts_quote_idx
  on public.commercial_stripe_checkout_attempts (plan_change_quote_id)
  where plan_change_quote_id is not null;

create table if not exists public.commercial_stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  livemode boolean not null default false,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  stripe_object_id text null,
  stripe_customer_id text null,
  stripe_subscription_id text null,
  stripe_checkout_session_id text null,
  error_redacted text null,
  received_at timestamptz not null default now(),
  processed_at timestamptz null,
  metadata_safe jsonb not null default '{}'::jsonb
);

create index if not exists commercial_stripe_webhook_events_status_idx
  on public.commercial_stripe_webhook_events (status, received_at desc);

create table if not exists public.commercial_stripe_billing_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  stripe_customer_id text not null,
  livemode boolean not null default false,
  billing_email text null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commercial_stripe_billing_profiles_customer_idx
  on public.commercial_stripe_billing_profiles (stripe_customer_id, livemode);

create table if not exists public.commercial_stripe_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  stripe_subscription_id text not null,
  stripe_customer_id text not null,
  stripe_price_id text null,
  status text not null,
  livemode boolean not null default false,
  current_period_start timestamptz null,
  current_period_end timestamptz null,
  cancel_at_period_end boolean not null default false,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_stripe_subscriptions_stripe_sub_unique unique (stripe_subscription_id)
);

create index if not exists commercial_stripe_subscriptions_client_idx
  on public.commercial_stripe_subscriptions (client_id, livemode);

alter table public.commercial_stripe_price_catalog enable row level security;
alter table public.commercial_stripe_checkout_attempts enable row level security;
alter table public.commercial_stripe_webhook_events enable row level security;
alter table public.commercial_stripe_billing_profiles enable row level security;
alter table public.commercial_stripe_subscriptions enable row level security;

comment on table public.commercial_stripe_price_catalog is
  'Server-only Stripe Price ID mapping. Service role access only.';
comment on table public.commercial_stripe_checkout_attempts is
  'Stripe Checkout attempt ledger linked to internal commercial sessions.';
comment on table public.commercial_stripe_webhook_events is
  'Idempotent Stripe webhook event ledger. No raw payload storage.';
