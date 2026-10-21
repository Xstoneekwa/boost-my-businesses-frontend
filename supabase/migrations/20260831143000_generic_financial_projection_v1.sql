-- Generic financial projection v1
-- 1. A plan-change entitlement/session always receives TARGET pricing metadata.
-- 2. The immutable local quote remains an estimate.
-- 3. Post-mutation actuals are stored separately from canonical Stripe objects.

alter table public.commercial_plan_change_quotes
  add column if not exists actual_stripe_amount_due_cents integer null
    check (actual_stripe_amount_due_cents is null or actual_stripe_amount_due_cents >= 0),
  add column if not exists actual_stripe_remaining_credit_cents integer null
    check (actual_stripe_remaining_credit_cents is null or actual_stripe_remaining_credit_cents >= 0),
  add column if not exists actual_stripe_proration_net_cents integer null,
  add column if not exists actual_stripe_plan_period_total_cents integer null
    check (actual_stripe_plan_period_total_cents is null or actual_stripe_plan_period_total_cents >= 0),
  add column if not exists actual_stripe_period_start_at timestamptz null,
  add column if not exists actual_stripe_period_end_at timestamptz null,
  add column if not exists actual_stripe_source text null
    check (actual_stripe_source is null or actual_stripe_source in (
      'pending_invoice_items', 'finalized_invoice', 'customer_balance'
    )),
  add column if not exists actual_stripe_object_ids jsonb not null default '[]'::jsonb,
  add column if not exists actual_stripe_reconciled_at timestamptz null;

comment on column public.commercial_plan_change_quotes.remaining_credit_cents is
  'Immutable pre-confirmation estimate. Never overwritten by Stripe reconciliation.';
comment on column public.commercial_plan_change_quotes.actual_stripe_remaining_credit_cents is
  'Post-mutation Stripe truth, separate from the immutable quote estimate.';

create or replace function public.normalize_plan_change_target_pricing_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_plan_key text;
  v_interval integer;
  v_currency text;
  v_discount_kind text;
  v_quote_id uuid;
  v_payment_provider text;
begin
  if tg_table_name = 'commercial_checkout_sessions' then
    if new.flow_type <> 'plan_change' then
      return new;
    end if;
    v_snapshot := new.catalog_snapshot;
  else
    if coalesce((new.metadata ->> 'per_account_plan')::boolean, false) = false
       and coalesce(new.catalog_snapshot ->> 'pricingContext', '') <> 'plan_change' then
      return new;
    end if;
    v_snapshot := new.catalog_snapshot;
  end if;

  if v_snapshot is null or jsonb_typeof(v_snapshot) <> 'object' then
    raise exception using errcode = '23514', message = 'target_pricing_snapshot_required';
  end if;

  v_plan_key := lower(coalesce(v_snapshot ->> 'planKey', ''));
  v_interval := nullif(v_snapshot ->> 'billingIntervalMonths', '')::integer;
  v_currency := upper(coalesce(v_snapshot ->> 'currency', ''));
  v_discount_kind := coalesce(v_snapshot ->> 'appliedDiscountKind', 'none');

  if v_plan_key not in ('growth', 'pro', 'premium')
     or v_plan_key <> lower(coalesce(new.plan_key, ''))
     or v_interval not in (1, 3, 6, 12)
     or v_interval <> new.billing_interval_months
     or v_currency <> 'EUR' then
    raise exception using errcode = '23514', message = 'target_pricing_snapshot_identity_mismatch';
  end if;

  if tg_table_name = 'commercial_checkout_sessions' then
    new.term_discount_percent := coalesce((v_snapshot ->> 'durationDiscountPercent')::numeric, 0);
    new.agency_discount_percent := coalesce((v_snapshot ->> 'volumeDiscountPercent')::numeric, 0);
    new.applied_discount_percent := coalesce((v_snapshot ->> 'appliedDiscountPercent')::numeric, 0);
    new.applied_discount_type := case v_discount_kind
      when 'duration' then 'term'
      when 'agency_volume' then 'agency'
      else 'none'
    end;
    new.pack_base_monthly_cents := (v_snapshot ->> 'packBaseMonthlyCents')::integer;
    new.pack_monthly_discounted_cents := (v_snapshot ->> 'packFinalMonthlyCents')::integer;
    new.pack_period_total_cents := (v_snapshot ->> 'packPeriodTotalCents')::integer;
    new.outreach_base_monthly_cents := coalesce((v_snapshot ->> 'outreachBaseMonthlyCents')::integer, 0);
    new.outreach_monthly_discounted_cents := coalesce((v_snapshot ->> 'outreachFinalMonthlyCents')::integer, 0);
    new.outreach_period_total_cents := coalesce((v_snapshot ->> 'outreachPeriodTotalCents')::integer, 0);
    new.total_period_cents := (v_snapshot ->> 'totalPeriodCents')::integer;
    v_quote_id := nullif(new.metadata ->> 'plan_change_quote_id', '')::uuid;
    if v_quote_id is not null then
      select payment_provider into v_payment_provider
      from public.commercial_plan_change_quotes
      where id = v_quote_id;
      if v_payment_provider = 'stripe' then
        new.status := 'checkout_paid';
        new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
          'payment_provider', 'stripe',
          'checkout_mode', 'stripe'
        );
      end if;
    end if;
  else
    new.applied_discount_percent := coalesce((v_snapshot ->> 'appliedDiscountPercent')::numeric, 0);
    new.applied_discount_type := case v_discount_kind
      when 'duration' then 'term'
      when 'agency_volume' then 'agency'
      else 'none'
    end;
    new.pack_monthly_discounted_cents := (v_snapshot ->> 'packFinalMonthlyCents')::integer;
    new.pack_period_total_cents := (v_snapshot ->> 'packPeriodTotalCents')::integer;
    new.outreach_monthly_discounted_cents := coalesce((v_snapshot ->> 'outreachFinalMonthlyCents')::integer, 0);
    new.outreach_period_total_cents := coalesce((v_snapshot ->> 'outreachPeriodTotalCents')::integer, 0);
    new.total_period_cents := (v_snapshot ->> 'totalPeriodCents')::integer;
  end if;

  if new.pack_monthly_discounted_cents < 0
     or new.pack_period_total_cents < 0
     or new.total_period_cents < 0 then
    raise exception using errcode = '23514', message = 'target_pricing_snapshot_amount_invalid';
  end if;
  return new;
end;
$$;

drop trigger if exists commercial_checkout_sessions_target_pricing_snapshot on public.commercial_checkout_sessions;
create trigger commercial_checkout_sessions_target_pricing_snapshot
before insert or update of plan_key, billing_interval_months, catalog_snapshot
on public.commercial_checkout_sessions
for each row execute function public.normalize_plan_change_target_pricing_snapshot();

drop trigger if exists client_account_entitlements_target_pricing_snapshot on public.client_account_entitlements;
create trigger client_account_entitlements_target_pricing_snapshot
before insert or update of plan_key, billing_interval_months, catalog_snapshot
on public.client_account_entitlements
for each row execute function public.normalize_plan_change_target_pricing_snapshot();

create or replace function public.reconcile_plan_change_stripe_financial_actual_v1(
  p_quote_id uuid,
  p_stripe_subscription_id text,
  p_actual_source text,
  p_actual_amount_due_cents integer,
  p_actual_remaining_credit_cents integer,
  p_actual_proration_net_cents integer,
  p_actual_plan_period_total_cents integer,
  p_actual_period_start_at timestamptz,
  p_actual_period_end_at timestamptz,
  p_source_object_ids jsonb,
  p_reconciled_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.commercial_plan_change_quotes%rowtype;
  v_entitlement_id uuid;
  v_snapshot jsonb;
begin
  if p_actual_source not in ('pending_invoice_items', 'finalized_invoice', 'customer_balance')
     or p_actual_amount_due_cents < 0
     or p_actual_remaining_credit_cents < 0
     or p_actual_plan_period_total_cents < 0
     or p_actual_period_end_at <= p_actual_period_start_at
     or jsonb_typeof(coalesce(p_source_object_ids, '[]'::jsonb)) <> 'array'
     or coalesce(trim(p_stripe_subscription_id), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'stripe_financial_actual_invalid');
  end if;

  select * into v_quote
  from public.commercial_plan_change_quotes
  where id = p_quote_id
  for update;

  if not found or v_quote.status <> 'quote_activated' then
    return jsonb_build_object('ok', false, 'code', 'activated_quote_required');
  end if;
  if coalesce(v_quote.provider_transaction_id, p_stripe_subscription_id) <> p_stripe_subscription_id then
    return jsonb_build_object('ok', false, 'code', 'stripe_subscription_mismatch');
  end if;

  v_snapshot := v_quote.pricing_snapshot;
  if v_snapshot is null
     or lower(coalesce(v_snapshot ->> 'planKey', '')) <> lower(v_quote.target_plan_key)
     or (v_snapshot ->> 'billingIntervalMonths')::integer <> v_quote.billing_interval_months
     or upper(coalesce(v_snapshot ->> 'currency', '')) <> v_quote.currency then
    return jsonb_build_object('ok', false, 'code', 'target_pricing_snapshot_invalid');
  end if;

  update public.commercial_plan_change_quotes
  set actual_stripe_amount_due_cents = p_actual_amount_due_cents,
      actual_stripe_remaining_credit_cents = p_actual_remaining_credit_cents,
      actual_stripe_proration_net_cents = p_actual_proration_net_cents,
      actual_stripe_plan_period_total_cents = p_actual_plan_period_total_cents,
      actual_stripe_period_start_at = p_actual_period_start_at,
      actual_stripe_period_end_at = p_actual_period_end_at,
      actual_stripe_source = p_actual_source,
      actual_stripe_object_ids = coalesce(p_source_object_ids, '[]'::jsonb),
      actual_stripe_reconciled_at = p_reconciled_at,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'quote_is_estimate', true,
        'quoted_amount_due_cents', amount_due_cents,
        'quoted_remaining_credit_cents', remaining_credit_cents,
        'quote_created_at', created_at,
        'actual_stripe_amount_due_cents', p_actual_amount_due_cents,
        'actual_stripe_remaining_credit_cents', p_actual_remaining_credit_cents,
        'actual_stripe_plan_period_total_cents', p_actual_plan_period_total_cents,
        'actual_stripe_period_start_at', p_actual_period_start_at,
        'actual_stripe_period_end_at', p_actual_period_end_at,
        'actual_stripe_source', p_actual_source,
        'actual_stripe_reconciled_at', p_reconciled_at,
        'stripe_subscription_id', p_stripe_subscription_id
      ),
      updated_at = greatest(updated_at, p_reconciled_at)
  where id = p_quote_id;

  update public.commercial_checkout_sessions
  set status = 'checkout_paid',
      catalog_snapshot = v_snapshot,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'quote_is_estimate', true,
        'quoted_amount_due_cents', v_quote.amount_due_cents,
        'quoted_remaining_credit_cents', v_quote.remaining_credit_cents,
        'actual_stripe_amount_due_cents', p_actual_amount_due_cents,
        'actual_stripe_remaining_credit_cents', p_actual_remaining_credit_cents,
        'actual_stripe_plan_period_total_cents', p_actual_plan_period_total_cents,
        'actual_stripe_period_start_at', p_actual_period_start_at,
        'actual_stripe_period_end_at', p_actual_period_end_at,
        'actual_stripe_source', p_actual_source,
        'actual_stripe_reconciled_at', p_reconciled_at,
        'stripe_subscription_id', p_stripe_subscription_id,
        'payment_provider', 'stripe',
        'checkout_mode', 'stripe'
      ),
      updated_at = greatest(updated_at, p_reconciled_at)
  where id = v_quote.activated_checkout_session_id;

  update public.client_account_entitlements
  set catalog_snapshot = v_snapshot,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'quote_is_estimate', true,
        'quoted_amount_due_cents', v_quote.amount_due_cents,
        'quoted_remaining_credit_cents', v_quote.remaining_credit_cents,
        'actual_stripe_amount_due_cents', p_actual_amount_due_cents,
        'actual_stripe_remaining_credit_cents', p_actual_remaining_credit_cents,
        'actual_stripe_plan_period_total_cents', p_actual_plan_period_total_cents,
        'actual_stripe_period_start_at', p_actual_period_start_at,
        'actual_stripe_period_end_at', p_actual_period_end_at,
        'period_end_at', p_actual_period_end_at,
        'actual_stripe_source', p_actual_source,
        'actual_stripe_reconciled_at', p_reconciled_at,
        'stripe_subscription_id', p_stripe_subscription_id
      ),
      updated_at = greatest(updated_at, p_reconciled_at)
  where checkout_session_id = v_quote.activated_checkout_session_id
    and account_id = v_quote.account_id
    and status = 'entitlement_consumed'
  returning id into v_entitlement_id;

  if v_entitlement_id is null then
    return jsonb_build_object('ok', false, 'code', 'replacement_entitlement_missing');
  end if;

  update public.commercial_stripe_subscriptions
  set client_account_entitlement_id = v_entitlement_id,
      commercial_checkout_session_id = v_quote.activated_checkout_session_id,
      plan_change_quote_id = p_quote_id,
      updated_at = greatest(updated_at, p_reconciled_at),
      metadata_safe = coalesce(metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'plan_change_state', 'financial_actual_reconciled',
        'actual_stripe_source', p_actual_source,
        'actual_stripe_reconciled_at', p_reconciled_at
      )
  where stripe_subscription_id = p_stripe_subscription_id
    and client_id = v_quote.client_id
    and account_id = v_quote.account_id
    and livemode = false;

  return jsonb_build_object(
    'ok', true,
    'quote_id', p_quote_id,
    'entitlement_id', v_entitlement_id,
    'quoted_remaining_credit_cents', v_quote.remaining_credit_cents,
    'actual_stripe_remaining_credit_cents', p_actual_remaining_credit_cents,
    'idempotent', true
  );
end;
$$;

revoke all on function public.reconcile_plan_change_stripe_financial_actual_v1(
  uuid, text, text, integer, integer, integer, integer, timestamptz, timestamptz, jsonb, timestamptz
) from public;
grant execute on function public.reconcile_plan_change_stripe_financial_actual_v1(
  uuid, text, text, integer, integer, integer, integer, timestamptz, timestamptz, jsonb, timestamptz
) to service_role;

comment on function public.reconcile_plan_change_stripe_financial_actual_v1(
  uuid, text, text, integer, integer, integer, integer, timestamptz, timestamptz, jsonb, timestamptz
) is 'Idempotently stores Stripe post-mutation financial truth without rewriting the historical quote.';
