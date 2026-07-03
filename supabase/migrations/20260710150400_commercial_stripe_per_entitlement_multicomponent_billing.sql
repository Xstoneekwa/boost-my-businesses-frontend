-- Stripe per-entitlement, multi-component billing foundation.
-- Additive only. Do not apply directly to production without the matching release plan.

alter table public.commercial_checkout_sessions
  add column if not exists commercial_mode text null
    check (commercial_mode is null or commercial_mode in ('full_cycle', 'outreach_only')),
  add column if not exists stripe_pricing_mode text null
    check (stripe_pricing_mode is null or stripe_pricing_mode in ('public_catalog', 'immutable_snapshot')),
  add column if not exists pricing_snapshot_fingerprint text null;

alter table public.commercial_stripe_checkout_attempts
  add column if not exists client_account_entitlement_id uuid null
    references public.client_account_entitlements(id) on delete set null,
  add column if not exists account_id uuid null
    references public.ig_accounts(id) on delete set null,
  add column if not exists commercial_mode text null
    check (commercial_mode is null or commercial_mode in ('full_cycle', 'outreach_only')),
  add column if not exists pricing_snapshot_fingerprint text null,
  add column if not exists reconciliation_reason text null;

alter table public.commercial_stripe_subscriptions
  add column if not exists client_account_entitlement_id uuid null
    references public.client_account_entitlements(id) on delete set null,
  add column if not exists account_id uuid null
    references public.ig_accounts(id) on delete set null,
  add column if not exists commercial_checkout_session_id uuid null
    references public.commercial_checkout_sessions(id) on delete set null,
  add column if not exists plan_change_quote_id uuid null
    references public.commercial_plan_change_quotes(id) on delete set null,
  add column if not exists commercial_mode text null
    check (commercial_mode is null or commercial_mode in ('full_cycle', 'outreach_only')),
  add column if not exists pricing_mode text null
    check (pricing_mode is null or pricing_mode in ('public_catalog', 'immutable_snapshot')),
  add column if not exists pricing_snapshot_fingerprint text null,
  add column if not exists projection_package_item jsonb null,
  add column if not exists projection_outreach_item jsonb null,
  add column if not exists rebound_from_subscription_id uuid null
    references public.commercial_stripe_subscriptions(id) on delete set null,
  add column if not exists rebound_reason text null,
  add column if not exists rebound_at timestamptz null;

create unique index if not exists commercial_stripe_subscriptions_one_active_per_entitlement_idx
  on public.commercial_stripe_subscriptions (client_account_entitlement_id, livemode)
  where client_account_entitlement_id is not null
    and status in ('trialing', 'active', 'past_due', 'unpaid', 'paused');

create index if not exists commercial_stripe_subscriptions_entitlement_idx
  on public.commercial_stripe_subscriptions (client_account_entitlement_id, account_id);

create table if not exists public.commercial_stripe_component_price_catalog (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('test', 'live')),
  product_key text not null check (product_key in (
    'boost_ai_growth',
    'boost_ai_pro',
    'boost_ai_premium',
    'instagram_outreach_standard',
    'instagram_outreach_ai'
  )),
  component_kind text not null check (component_kind in ('package', 'outreach')),
  package_key text null check (package_key is null or package_key in ('growth', 'pro', 'premium')),
  outreach_key text null check (outreach_key is null or outreach_key in ('outreach_standard', 'outreach_ai')),
  billing_interval_months integer not null check (billing_interval_months in (1, 3, 6, 12)),
  stripe_product_id text not null,
  stripe_price_id text not null,
  expected_amount_cents integer not null check (expected_amount_cents > 0),
  currency text not null default 'eur' check (currency = 'eur'),
  active boolean not null default true,
  catalog_version text not null,
  fingerprint text null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_stripe_component_price_catalog_kind_keys_check
    check (
      (component_kind = 'package' and package_key is not null and outreach_key is null)
      or
      (component_kind = 'outreach' and outreach_key is not null and package_key is null)
    ),
  constraint commercial_stripe_component_price_catalog_product_key_component_mapping_check
    check (
      (product_key = 'boost_ai_growth' and component_kind = 'package' and package_key = 'growth')
      or (product_key = 'boost_ai_pro' and component_kind = 'package' and package_key = 'pro')
      or (product_key = 'boost_ai_premium' and component_kind = 'package' and package_key = 'premium')
      or (product_key = 'instagram_outreach_standard' and component_kind = 'outreach' and outreach_key = 'outreach_standard')
      or (product_key = 'instagram_outreach_ai' and component_kind = 'outreach' and outreach_key = 'outreach_ai')
    ),
  constraint commercial_stripe_component_price_catalog_unique_key
    unique (
      environment,
      product_key,
      component_kind,
      billing_interval_months,
      expected_amount_cents,
      currency
    )
);

create index if not exists commercial_stripe_component_price_catalog_active_idx
  on public.commercial_stripe_component_price_catalog (environment, product_key, active)
  where active = true;

create table if not exists public.commercial_stripe_subscription_items (
  id uuid primary key default gen_random_uuid(),
  stripe_subscription_projection_id uuid not null
    references public.commercial_stripe_subscriptions(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  client_account_entitlement_id uuid not null
    references public.client_account_entitlements(id) on delete cascade,
  account_id uuid null references public.ig_accounts(id) on delete set null,
  component_kind text not null check (component_kind in ('package', 'outreach')),
  package_key text null check (package_key is null or package_key in ('growth', 'pro', 'premium')),
  outreach_key text null check (outreach_key is null or outreach_key in ('outreach_standard', 'outreach_ai')),
  commercial_mode text not null check (commercial_mode in ('full_cycle', 'outreach_only')),
  stripe_subscription_item_id text null,
  stripe_product_id text not null,
  stripe_price_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'eur' check (currency = 'eur'),
  billing_interval_months integer not null check (billing_interval_months in (1, 3, 6, 12)),
  pricing_mode text not null check (pricing_mode in ('public_catalog', 'immutable_snapshot')),
  pricing_snapshot_fingerprint text not null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_stripe_subscription_items_kind_keys_check
    check (
      (component_kind = 'package' and package_key is not null and outreach_key is null)
      or
      (component_kind = 'outreach' and outreach_key is not null and package_key is null)
    ),
  constraint commercial_stripe_subscription_items_mode_check
    check (
      (commercial_mode = 'full_cycle')
      or
      (commercial_mode = 'outreach_only' and component_kind = 'outreach')
    )
);

create unique index if not exists commercial_stripe_subscription_items_one_kind_idx
  on public.commercial_stripe_subscription_items (stripe_subscription_projection_id, component_kind);

create index if not exists commercial_stripe_subscription_items_entitlement_idx
  on public.commercial_stripe_subscription_items (client_account_entitlement_id, account_id);

alter table public.commercial_stripe_component_price_catalog enable row level security;
alter table public.commercial_stripe_subscription_items enable row level security;

revoke all on table public.commercial_stripe_component_price_catalog from anon, authenticated;
revoke all on table public.commercial_stripe_subscription_items from anon, authenticated;
grant all on table public.commercial_stripe_component_price_catalog to service_role;
grant all on table public.commercial_stripe_subscription_items to service_role;

comment on table public.commercial_stripe_component_price_catalog is
  'Server-only Product/Price mapping for per-component Stripe billing. Public catalog and immutable snapshot resolution never use the legacy combined mapping.';
comment on table public.commercial_stripe_subscription_items is
  'Server-only projection of package/outreach Stripe subscription items scoped to one client_account_entitlement.';
