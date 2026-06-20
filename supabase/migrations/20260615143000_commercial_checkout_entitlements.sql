-- Simulated checkout + per-account entitlements (commercial billing foundation)

create table if not exists public.commercial_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  flow_type text not null check (flow_type in ('first_purchase', 'additional_account')),
  status text not null check (status in ('checkout_pending', 'checkout_activated_test', 'checkout_cancelled')),
  client_id uuid null references public.clients(id) on delete set null,
  auth_user_id uuid null,
  purchaser_email text not null,
  plan_key text not null check (plan_key in ('growth', 'pro', 'premium')),
  billing_interval_months integer not null check (billing_interval_months in (1, 3, 6, 12)),
  outreach_addon_key text null check (outreach_addon_key in ('outreach_standard', 'outreach_ai')),
  billable_account_count integer not null check (billable_account_count >= 1),
  term_discount_percent numeric(5,4) not null default 0,
  agency_discount_percent numeric(5,4) not null default 0,
  applied_discount_percent numeric(5,4) not null default 0,
  applied_discount_type text not null check (applied_discount_type in ('none', 'term', 'agency')),
  pack_base_monthly_cents integer not null check (pack_base_monthly_cents >= 0),
  pack_monthly_discounted_cents integer not null check (pack_monthly_discounted_cents >= 0),
  pack_period_total_cents integer not null check (pack_period_total_cents >= 0),
  outreach_base_monthly_cents integer null check (outreach_base_monthly_cents is null or outreach_base_monthly_cents >= 0),
  outreach_monthly_discounted_cents integer null,
  outreach_period_total_cents integer null,
  total_period_cents integer not null check (total_period_cents >= 0),
  catalog_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz null
);

create index if not exists commercial_checkout_sessions_client_id_idx
  on public.commercial_checkout_sessions (client_id);

create index if not exists commercial_checkout_sessions_email_idx
  on public.commercial_checkout_sessions (lower(purchaser_email));

create table if not exists public.client_account_entitlements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  checkout_session_id uuid not null references public.commercial_checkout_sessions(id) on delete restrict,
  plan_key text not null check (plan_key in ('growth', 'pro', 'premium')),
  commercial_package_code text not null check (commercial_package_code in ('growth', 'pro', 'premium')),
  billing_interval_months integer not null check (billing_interval_months in (1, 3, 6, 12)),
  outreach_addon_key text null check (outreach_addon_key in ('outreach_standard', 'outreach_ai')),
  outreach_variant text null check (outreach_variant in ('client_list', 'ai_list')),
  backend_addon_code text null,
  applied_discount_percent numeric(5,4) not null default 0,
  applied_discount_type text not null check (applied_discount_type in ('none', 'term', 'agency')),
  pack_monthly_discounted_cents integer not null check (pack_monthly_discounted_cents >= 0),
  pack_period_total_cents integer not null check (pack_period_total_cents >= 0),
  outreach_monthly_discounted_cents integer null,
  outreach_period_total_cents integer null,
  total_period_cents integer not null check (total_period_cents >= 0),
  catalog_snapshot jsonb not null default '{}'::jsonb,
  status text not null check (status in ('entitlement_reserved', 'entitlement_consumed', 'entitlement_cancelled')),
  account_id uuid null references public.ig_accounts(id) on delete set null,
  consumed_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_account_entitlements_client_status_idx
  on public.client_account_entitlements (client_id, status);

create unique index if not exists client_account_entitlements_one_reserved_per_client_idx
  on public.client_account_entitlements (client_id)
  where status = 'entitlement_reserved';

create index if not exists client_account_entitlements_account_id_idx
  on public.client_account_entitlements (account_id)
  where account_id is not null;

create table if not exists public.commercial_checkout_audit_events (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid null references public.commercial_checkout_sessions(id) on delete set null,
  entitlement_id uuid null references public.client_account_entitlements(id) on delete set null,
  event_type text not null,
  actor_email text null,
  client_id uuid null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists commercial_checkout_audit_events_session_idx
  on public.commercial_checkout_audit_events (checkout_session_id);
