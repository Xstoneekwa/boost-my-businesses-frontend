-- Stripe-backed credit source consistency v1.
--
-- The legacy per-account activation RPC remains unchanged for simulated flows.
-- This Stripe-only wrapper binds a verified webhook/subscription/Price tuple,
-- aligns the legacy ledger to the immutable pre-mutation Stripe credit snapshot,
-- invokes the existing activation atomically, and then converges the ledger and
-- client projection to the post-mutation Stripe financial actual.

create or replace function public.activate_stripe_commercial_plan_change_per_account_v1(
  p_quote_id uuid,
  p_idempotency_key text,
  p_stripe_event_id text,
  p_stripe_subscription_id text,
  p_current_stripe_price_id text,
  p_quoted_stripe_credit_cents integer,
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
  v_event public.commercial_stripe_webhook_events%rowtype;
  v_subscription public.commercial_stripe_subscriptions%rowtype;
  v_activation jsonb;
  v_financial jsonb;
  v_current_revision text;
  v_original_expires_at timestamptz;
  v_balance integer;
  v_delta integer;
  v_now timestamptz := now();
begin
  if coalesce(trim(p_idempotency_key), '') = ''
     or coalesce(trim(p_stripe_event_id), '') = ''
     or coalesce(trim(p_stripe_subscription_id), '') = ''
     or coalesce(trim(p_current_stripe_price_id), '') = ''
     or p_quoted_stripe_credit_cents < 0
     or p_actual_source not in ('pending_invoice_items', 'finalized_invoice', 'customer_balance')
     or p_actual_amount_due_cents < 0
     or p_actual_remaining_credit_cents < 0
     or p_actual_plan_period_total_cents <= 0
     or p_actual_period_end_at <= p_actual_period_start_at
     or jsonb_typeof(coalesce(p_source_object_ids, '[]'::jsonb)) <> 'array'
     or p_reconciled_at is null then
    return jsonb_build_object('ok', false, 'code', 'stripe_activation_evidence_invalid');
  end if;

  select * into v_quote
  from public.commercial_plan_change_quotes
  where id = p_quote_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'quote_not_found');
  end if;
  if v_quote.change_scope <> 'per_account'
     or v_quote.account_id is null
     or v_quote.idempotency_key <> p_idempotency_key then
    return jsonb_build_object('ok', false, 'code', 'quote_binding_mismatch');
  end if;
  if v_quote.existing_customer_credit_cents <> p_quoted_stripe_credit_cents then
    return jsonb_build_object('ok', false, 'code', 'canonical_stripe_credit_changed');
  end if;
  if coalesce(v_quote.metadata ->> 'canonical_target_stripe_price_id', '') <> p_current_stripe_price_id then
    return jsonb_build_object('ok', false, 'code', 'stripe_price_plan_lineage_mismatch');
  end if;

  select * into v_event
  from public.commercial_stripe_webhook_events
  where stripe_event_id = p_stripe_event_id
  for update;

  if not found
     or v_event.event_type not in ('customer.subscription.created', 'customer.subscription.updated')
     or v_event.livemode
     or v_event.stripe_subscription_id is distinct from p_stripe_subscription_id
     or v_event.status not in ('received', 'processing', 'retryable', 'processed') then
    return jsonb_build_object('ok', false, 'code', 'stripe_webhook_lineage_invalid');
  end if;

  select * into v_subscription
  from public.commercial_stripe_subscriptions
  where stripe_subscription_id = p_stripe_subscription_id
  for update;

  if not found
     or v_subscription.livemode
     or v_subscription.client_id is distinct from v_quote.client_id
     or v_subscription.account_id is distinct from v_quote.account_id
     or v_subscription.plan_change_quote_id is distinct from v_quote.id
     or v_subscription.stripe_price_id is distinct from p_current_stripe_price_id
     or v_subscription.status not in ('active', 'trialing') then
    return jsonb_build_object('ok', false, 'code', 'stripe_subscription_binding_invalid');
  end if;

  if v_quote.status = 'quote_activated' then
    if v_quote.provider_transaction_id is distinct from p_stripe_subscription_id
       or v_quote.actual_stripe_remaining_credit_cents is distinct from p_actual_remaining_credit_cents
       or v_quote.actual_stripe_source is distinct from p_actual_source then
      return jsonb_build_object('ok', false, 'code', 'activated_quote_stripe_actual_mismatch');
    end if;
    return jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'quote_id', v_quote.id,
      'checkout_session_id', v_quote.activated_checkout_session_id,
      'client_id', v_quote.client_id,
      'account_id', v_quote.account_id
    );
  end if;

  v_current_revision := public.commercial_plan_change_source_revision_for_account_source(
    v_quote.source_entitlement_id,
    v_quote.source_checkout_session_id,
    v_quote.account_id,
    v_quote.active_commercial_period_value_cents
  );
  if v_current_revision is null or v_current_revision <> v_quote.source_revision then
    return jsonb_build_object('ok', false, 'code', 'quote_stale');
  end if;

  if v_quote.status not in ('quote_pending', 'quote_stale') then
    return jsonb_build_object('ok', false, 'code', 'quote_not_recoverable');
  end if;

  -- The Stripe mutation is already proved by the canonical subscription event.
  -- Preserve the original expiry as historical evidence while allowing this
  -- same confirmed quote to complete local reconciliation.
  v_original_expires_at := v_quote.quote_expires_at;
  update public.commercial_plan_change_quotes
  set status = 'quote_pending',
      quote_expires_at = greatest(quote_expires_at, v_now + interval '5 minutes'),
      payment_provider = 'stripe',
      payment_status = 'confirmed',
      provider_transaction_id = p_stripe_subscription_id,
      payment_confirmed_at = coalesce(payment_confirmed_at, v_now),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'stripe_activation_event_id', p_stripe_event_id,
        'stripe_activation_subscription_id', p_stripe_subscription_id,
        'stripe_activation_price_id', p_current_stripe_price_id,
        'canonical_pre_mutation_stripe_credit_cents', p_quoted_stripe_credit_cents,
        'canonical_post_mutation_stripe_credit_cents', p_actual_remaining_credit_cents,
        'canonical_post_mutation_stripe_credit_source', p_actual_source
      ),
      updated_at = v_now
  where id = v_quote.id;

  -- The unchanged legacy activation performs an exact equality check. Align the
  -- local cache to Stripe's pre-mutation truth, never with a tolerance.
  v_balance := public.account_scoped_credit_balance_cents(
    v_quote.client_id,
    v_quote.account_id,
    v_quote.currency
  );
  v_delta := p_quoted_stripe_credit_cents - v_balance;
  if v_delta <> 0 then
    insert into public.client_credit_ledger (
      client_id, account_id, source_entitlement_id, currency, entry_type,
      direction, amount_cents, balance_after_cents, source_quote_id,
      source_checkout_session_id, idempotency_key, metadata
    ) values (
      v_quote.client_id,
      v_quote.account_id,
      v_quote.source_entitlement_id,
      v_quote.currency,
      'manual_adjustment',
      case when v_delta > 0 then 'credit' else 'debit' end,
      abs(v_delta),
      p_quoted_stripe_credit_cents,
      v_quote.id,
      v_quote.source_checkout_session_id,
      p_idempotency_key || ':stripe_credit_source_alignment',
      jsonb_build_object(
        'reason', 'canonical_stripe_pre_mutation_credit_alignment',
        'stripe_event_id', p_stripe_event_id,
        'stripe_subscription_id', p_stripe_subscription_id,
        'local_balance_before_cents', v_balance,
        'canonical_stripe_credit_cents', p_quoted_stripe_credit_cents,
        'cent_tolerance', 0
      )
    ) on conflict (idempotency_key) do nothing;
  end if;

  v_activation := public.activate_commercial_plan_change_per_account(
    p_quote_id,
    p_idempotency_key,
    null,
    false
  );
  if coalesce((v_activation ->> 'ok')::boolean, false) = false then
    raise exception using
      errcode = 'P0001',
      message = 'stripe_plan_change_atomic_activation_failed',
      detail = coalesce(v_activation ->> 'code', 'unknown');
  end if;

  update public.commercial_plan_change_quotes
  set quote_expires_at = v_original_expires_at,
      payment_provider = 'stripe',
      payment_status = 'confirmed',
      provider_transaction_id = p_stripe_subscription_id,
      payment_confirmed_at = coalesce(payment_confirmed_at, v_now),
      updated_at = greatest(updated_at, p_reconciled_at)
  where id = p_quote_id;

  -- The quote remains immutable estimate evidence. Store actual Stripe truth in
  -- the separate actual_* projection before returning local activation success.
  v_financial := public.reconcile_plan_change_stripe_financial_actual_v1(
    p_quote_id,
    p_stripe_subscription_id,
    p_actual_source,
    p_actual_amount_due_cents,
    p_actual_remaining_credit_cents,
    p_actual_proration_net_cents,
    p_actual_plan_period_total_cents,
    p_actual_period_start_at,
    p_actual_period_end_at,
    p_source_object_ids,
    p_reconciled_at
  );
  if coalesce((v_financial ->> 'ok')::boolean, false) = false then
    raise exception using
      errcode = 'P0001',
      message = 'stripe_plan_change_atomic_financial_reconciliation_failed',
      detail = coalesce(v_financial ->> 'code', 'unknown');
  end if;

  -- Stripe is authoritative for the current account credit. Correct any exact
  -- cent difference left by local proration arithmetic in the same transaction.
  v_balance := public.account_scoped_credit_balance_cents(
    v_quote.client_id,
    v_quote.account_id,
    v_quote.currency
  );
  v_delta := p_actual_remaining_credit_cents - v_balance;
  if v_delta <> 0 then
    insert into public.client_credit_ledger (
      client_id, account_id, source_entitlement_id, currency, entry_type,
      direction, amount_cents, balance_after_cents, source_quote_id,
      source_checkout_session_id, idempotency_key, metadata
    ) values (
      v_quote.client_id,
      v_quote.account_id,
      (v_activation ->> 'entitlement_id')::uuid,
      v_quote.currency,
      'manual_adjustment',
      case when v_delta > 0 then 'credit' else 'debit' end,
      abs(v_delta),
      p_actual_remaining_credit_cents,
      v_quote.id,
      (v_activation ->> 'checkout_session_id')::uuid,
      p_idempotency_key || ':stripe_post_mutation_actual_reconciliation',
      jsonb_build_object(
        'reason', 'canonical_stripe_post_mutation_credit_reconciliation',
        'stripe_event_id', p_stripe_event_id,
        'stripe_subscription_id', p_stripe_subscription_id,
        'actual_stripe_source', p_actual_source,
        'actual_stripe_object_ids', p_source_object_ids,
        'local_balance_before_cents', v_balance,
        'canonical_stripe_credit_cents', p_actual_remaining_credit_cents,
        'cent_tolerance', 0
      )
    ) on conflict (idempotency_key) do nothing;
  end if;

  v_balance := public.account_scoped_credit_balance_cents(
    v_quote.client_id,
    v_quote.account_id,
    v_quote.currency
  );
  if v_balance <> p_actual_remaining_credit_cents then
    raise exception using
      errcode = 'P0001',
      message = 'stripe_credit_ledger_convergence_failed';
  end if;

  return v_activation || jsonb_build_object(
    'stripe_financial_actual_reconciled', true,
    'actual_stripe_remaining_credit_cents', p_actual_remaining_credit_cents
  );
end;
$$;

revoke all on function public.activate_stripe_commercial_plan_change_per_account_v1(
  uuid, text, text, text, text, integer, text, integer, integer, integer,
  integer, timestamptz, timestamptz, jsonb, timestamptz
) from public, anon, authenticated;

grant execute on function public.activate_stripe_commercial_plan_change_per_account_v1(
  uuid, text, text, text, text, integer, text, integer, integer, integer,
  integer, timestamptz, timestamptz, jsonb, timestamptz
) to service_role;

comment on function public.activate_stripe_commercial_plan_change_per_account_v1(
  uuid, text, text, text, text, integer, text, integer, integer, integer,
  integer, timestamptz, timestamptz, jsonb, timestamptz
) is 'Atomically activates a Stripe-backed per-account plan change from verified webhook evidence and reconciles exact Stripe credit; simulated activation remains on the legacy RPC.';
