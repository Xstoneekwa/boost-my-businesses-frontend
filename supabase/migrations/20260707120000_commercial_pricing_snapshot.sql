-- TASK 17C: immutable commercial pricing snapshots on checkout and entitlements.

alter table public.commercial_checkout_sessions
  add column if not exists pricing_snapshot jsonb null;

comment on column public.commercial_checkout_sessions.pricing_snapshot is
  'Immutable CommercialPricingSnapshot captured at checkout activation. Legacy rows remain null.';

alter table public.client_account_entitlements
  add column if not exists pricing_snapshot jsonb null;

comment on column public.client_account_entitlements.pricing_snapshot is
  'Immutable CommercialPricingSnapshot copied from checkout at entitlement creation. Legacy rows remain null.';

-- Plan-change quote snapshot column + RPC copy path lives in
-- 20260707120001_commercial_pricing_snapshot_plan_change.sql
-- Apply that migration only after commercial_plan_change_quotes exists in the target database.
