-- Temporary production test checkout authorizations (admin-created, single email, expiring).

create table if not exists public.commercial_prod_test_checkout_authorizations (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  email_hint text not null,
  authorized_flows text[] not null default array['first_purchase', 'new_account']::text[],
  max_accounts integer not null default 2 check (max_accounts >= 1 and max_accounts <= 10),
  plan_key text null check (plan_key is null or plan_key in ('growth', 'pro', 'premium')),
  billing_interval_months integer null check (
    billing_interval_months is null or billing_interval_months in (1, 3, 6, 12)
  ),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'expired', 'consumed', 'revoked')),
  client_id uuid null references public.clients(id) on delete set null,
  entitlements_created_count integer not null default 0 check (entitlements_created_count >= 0),
  first_checkout_used_at timestamptz null,
  add_account_used_at timestamptz null,
  created_by_auth_user_id uuid not null,
  admin_confirmation_acknowledged boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_prod_test_checkout_authorizations_flows_check
    check (
      authorized_flows <@ array['first_purchase', 'new_account']::text[]
      and cardinality(authorized_flows) >= 1
    )
);

create unique index if not exists commercial_prod_test_checkout_authorizations_active_email_hash_idx
  on public.commercial_prod_test_checkout_authorizations (email_hash)
  where status = 'active';

create index if not exists commercial_prod_test_checkout_authorizations_client_id_idx
  on public.commercial_prod_test_checkout_authorizations (client_id)
  where client_id is not null;

create index if not exists commercial_prod_test_checkout_authorizations_expires_at_idx
  on public.commercial_prod_test_checkout_authorizations (expires_at);

alter table public.commercial_prod_test_checkout_authorizations enable row level security;

comment on table public.commercial_prod_test_checkout_authorizations is
  'Admin-created temporary authorizations for real-email simulated checkout on production only. Service-role access only.';
