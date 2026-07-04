-- Stripe Test checkout/webhook foundation V1 support.
-- Local migration only in this checkpoint. Do not apply to production before the release checklist.

alter table public.commercial_checkout_sessions
  alter column plan_key drop not null,
  alter column pack_base_monthly_cents drop not null,
  alter column pack_monthly_discounted_cents drop not null,
  alter column pack_period_total_cents drop not null;

alter table public.client_account_entitlements
  alter column plan_key drop not null,
  alter column commercial_package_code drop not null,
  alter column pack_monthly_discounted_cents drop not null,
  alter column pack_period_total_cents drop not null;

alter table public.commercial_checkout_sessions
  drop constraint if exists commercial_checkout_sessions_commercial_mode_shape_check;

alter table public.commercial_checkout_sessions
  add constraint commercial_checkout_sessions_commercial_mode_shape_check
  check (
    commercial_mode is null
    or (
      commercial_mode = 'full_cycle'
      and plan_key in ('growth', 'pro', 'premium')
    )
    or (
      commercial_mode = 'outreach_only'
      and plan_key is null
      and outreach_addon_key in ('outreach_standard', 'outreach_ai')
      and coalesce(pack_base_monthly_cents, 0) = 0
      and coalesce(pack_monthly_discounted_cents, 0) = 0
      and coalesce(pack_period_total_cents, 0) = 0
    )
  );

alter table public.client_account_entitlements
  drop constraint if exists client_account_entitlements_commercial_mode_shape_check;

alter table public.client_account_entitlements
  add constraint client_account_entitlements_commercial_mode_shape_check
  check (
    (metadata->>'commercial_mode') is null
    or (
      metadata->>'commercial_mode' = 'full_cycle'
      and plan_key in ('growth', 'pro', 'premium')
      and commercial_package_code in ('growth', 'pro', 'premium')
    )
    or (
      metadata->>'commercial_mode' = 'outreach_only'
      and plan_key is null
      and commercial_package_code is null
      and outreach_addon_key in ('outreach_standard', 'outreach_ai')
      and coalesce(pack_monthly_discounted_cents, 0) = 0
      and coalesce(pack_period_total_cents, 0) = 0
    )
  );

comment on constraint commercial_checkout_sessions_commercial_mode_shape_check
  on public.commercial_checkout_sessions is
  'Allows Stripe Test outreach_only sessions without a package while preserving full_cycle package requirements.';

comment on constraint client_account_entitlements_commercial_mode_shape_check
  on public.client_account_entitlements is
  'Allows outreach_only entitlements scoped to a single entitlement without client-wide outreach exclusivity.';
