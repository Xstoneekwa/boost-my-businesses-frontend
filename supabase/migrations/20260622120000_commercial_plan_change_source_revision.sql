-- Plan Change follow-up: canonical PostgreSQL source_revision (single source of truth).
-- Does not modify 20260621120000_commercial_plan_change.sql retroactively.

create or replace function public.commercial_plan_change_source_revision(
  p_entitlement_updated_at timestamptz,
  p_session_updated_at timestamptz,
  p_plan_key text,
  p_active_commercial_period_value_cents integer,
  p_entitlement_id uuid,
  p_session_id uuid
)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select md5(
    coalesce(p_entitlement_updated_at::text, '') || '|' ||
    coalesce(p_session_updated_at::text, '') || '|' ||
    coalesce(p_plan_key, '') || '|' ||
    coalesce(p_active_commercial_period_value_cents::text, '') || '|' ||
    coalesce(p_entitlement_id::text, '') || '|' ||
    coalesce(p_session_id::text, '')
  );
$$;

comment on function public.commercial_plan_change_source_revision(
  timestamptz, timestamptz, text, integer, uuid, uuid
) is
  'Canonical MD5 revision for plan change quotes. Field order and timestamptz::text formatting are contract.';

create or replace function public.commercial_plan_change_source_revision_for_source(
  p_entitlement_id uuid,
  p_session_id uuid,
  p_active_commercial_period_value_cents integer
)
returns text
language sql
stable
set search_path = public
as $$
  select public.commercial_plan_change_source_revision(
    e.updated_at,
    s.updated_at,
    e.plan_key,
    p_active_commercial_period_value_cents,
    e.id,
    s.id
  )
  from public.client_account_entitlements e
  inner join public.commercial_checkout_sessions s on s.id = p_session_id
  where e.id = p_entitlement_id;
$$;

comment on function public.commercial_plan_change_source_revision_for_source(uuid, uuid, integer) is
  'Reads live entitlement/session rows and returns commercial_plan_change_source_revision. Used by quote API and activation RPC.';

-- Replace activation RPC revision check to use the canonical function (quote_stale protection unchanged).
create or replace function public.activate_commercial_plan_change(
  p_quote_id uuid,
  p_idempotency_key text,
  p_actor_email text default null,
  p_simulated_activation boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.commercial_plan_change_quotes%rowtype;
  v_existing_quote public.commercial_plan_change_quotes%rowtype;
  v_source_entitlement public.client_account_entitlements%rowtype;
  v_source_session public.commercial_checkout_sessions%rowtype;
  v_current_revision text;
  v_balance integer := 0;
  v_new_session_id uuid;
  v_new_entitlement_id uuid;
  v_credit_applied integer;
  v_now timestamptz := now();
  v_payment_status text;
  v_payment_provider text;
begin
  if coalesce(trim(p_idempotency_key), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'idempotency_required');
  end if;

  select * into v_existing_quote
  from public.commercial_plan_change_quotes
  where idempotency_key = p_idempotency_key
  limit 1;

  if found and v_existing_quote.status = 'quote_activated' then
    return jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'quote_id', v_existing_quote.id,
      'checkout_session_id', v_existing_quote.activated_checkout_session_id,
      'client_id', v_existing_quote.client_id
    );
  end if;

  select * into v_quote
  from public.commercial_plan_change_quotes
  where id = p_quote_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'quote_not_found');
  end if;

  if v_quote.idempotency_key <> p_idempotency_key then
    return jsonb_build_object('ok', false, 'code', 'idempotency_mismatch');
  end if;

  if v_quote.status <> 'quote_pending' then
    return jsonb_build_object('ok', false, 'code', 'quote_not_pending');
  end if;

  if v_quote.quote_expires_at <= v_now then
    update public.commercial_plan_change_quotes
      set status = 'quote_expired', updated_at = v_now
      where id = v_quote.id;
    return jsonb_build_object('ok', false, 'code', 'quote_expired');
  end if;

  if v_quote.amount_due_cents > 0
     and coalesce(v_quote.payment_status, 'pending') not in ('confirmed', 'simulated_confirmed')
     and coalesce(p_simulated_activation, false) = false then
    return jsonb_build_object('ok', false, 'code', 'payment_required');
  end if;

  if v_quote.amount_due_cents > 0 and coalesce(p_simulated_activation, false) = true then
    v_payment_status := 'simulated_confirmed';
    v_payment_provider := 'simulated_test';
  elsif v_quote.amount_due_cents <= 0 then
    v_payment_status := 'not_required';
    v_payment_provider := null;
  else
    v_payment_status := coalesce(v_quote.payment_status, 'confirmed');
    v_payment_provider := v_quote.payment_provider;
  end if;

  select * into v_source_entitlement
  from public.client_account_entitlements
  where id = v_quote.source_entitlement_id
  for update;

  select * into v_source_session
  from public.commercial_checkout_sessions
  where id = v_quote.source_checkout_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'source_missing');
  end if;

  v_current_revision := public.commercial_plan_change_source_revision_for_source(
    v_quote.source_entitlement_id,
    v_quote.source_checkout_session_id,
    v_quote.active_commercial_period_value_cents
  );

  if v_current_revision is null or v_current_revision <> v_quote.source_revision then
    update public.commercial_plan_change_quotes
      set status = 'quote_stale', updated_at = v_now
      where id = v_quote.id;
    return jsonb_build_object('ok', false, 'code', 'quote_stale');
  end if;

  if v_source_entitlement.status = 'entitlement_cancelled' then
    return jsonb_build_object('ok', false, 'code', 'source_inactive');
  end if;

  select coalesce(sum(
    case when direction = 'credit' then amount_cents else -amount_cents end
  ), 0)::integer into v_balance
  from public.client_credit_ledger
  where client_id = v_quote.client_id and currency = v_quote.currency;

  if v_balance <> v_quote.existing_customer_credit_cents then
    update public.commercial_plan_change_quotes
      set status = 'quote_stale', updated_at = v_now
      where id = v_quote.id;
    return jsonb_build_object('ok', false, 'code', 'credit_balance_changed');
  end if;

  insert into public.commercial_checkout_sessions (
    idempotency_key,
    flow_type,
    status,
    client_id,
    auth_user_id,
    purchaser_email,
    plan_key,
    billing_interval_months,
    outreach_addon_key,
    billable_account_count,
    term_discount_percent,
    agency_discount_percent,
    applied_discount_percent,
    applied_discount_type,
    pack_base_monthly_cents,
    pack_monthly_discounted_cents,
    pack_period_total_cents,
    outreach_base_monthly_cents,
    outreach_monthly_discounted_cents,
    outreach_period_total_cents,
    total_period_cents,
    catalog_snapshot,
    metadata,
    activated_at
  )
  select
    p_idempotency_key || ':session',
    'plan_change',
    'checkout_activated_test',
    v_quote.client_id,
    v_source_session.auth_user_id,
    v_source_session.purchaser_email,
    v_quote.target_plan_key,
    v_quote.billing_interval_months,
    v_source_session.outreach_addon_key,
    v_source_session.billable_account_count,
    v_source_session.term_discount_percent,
    v_source_session.agency_discount_percent,
    v_source_session.applied_discount_percent,
    v_source_session.applied_discount_type,
    v_source_session.pack_base_monthly_cents,
    v_source_session.pack_monthly_discounted_cents,
    v_quote.target_full_period_price_cents,
    v_source_session.outreach_base_monthly_cents,
    v_source_session.outreach_monthly_discounted_cents,
    v_source_session.outreach_period_total_cents,
    v_quote.amount_due_cents,
    v_source_session.catalog_snapshot,
    jsonb_build_object(
      'checkout_context', 'existing_workspace_plan_change',
      'plan_change_quote_id', v_quote.id,
      'source_checkout_session_id', v_quote.source_checkout_session_id,
      'source_entitlement_id', v_quote.source_entitlement_id,
      'period_end_at', v_quote.period_end_at,
      'commercial_period_value_cents', v_quote.target_full_period_price_cents,
      'full_period_price_cents', v_quote.target_full_period_price_cents,
      'target_remaining_cost_cents', v_quote.target_remaining_cost_cents,
      'current_unused_credit_cents', v_quote.current_unused_credit_cents,
      'credit_applied_cents', v_quote.credit_applied_cents,
      'amount_due_cents', v_quote.amount_due_cents,
      'remaining_credit_cents', v_quote.remaining_credit_cents,
      'cash_collected_cents', v_quote.amount_due_cents,
      'payment_provider', v_payment_provider,
      'payment_status', v_payment_status,
      'provider_transaction_id', v_quote.provider_transaction_id,
      'payment_confirmed_at', case when v_payment_status in ('confirmed', 'simulated_confirmed') then v_now else null end
    ),
    v_now
  returning id into v_new_session_id;

  update public.client_account_entitlements
    set status = 'entitlement_cancelled',
        updated_at = v_now,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'superseded_by_plan_change_quote_id', v_quote.id,
          'superseded_at', v_now
        )
  where id = v_source_entitlement.id;

  insert into public.client_account_entitlements (
    client_id,
    checkout_session_id,
    plan_key,
    commercial_package_code,
    billing_interval_months,
    outreach_addon_key,
    outreach_variant,
    backend_addon_code,
    applied_discount_percent,
    applied_discount_type,
    pack_monthly_discounted_cents,
    pack_period_total_cents,
    outreach_monthly_discounted_cents,
    outreach_period_total_cents,
    total_period_cents,
    catalog_snapshot,
    status,
    account_id,
    consumed_at,
    metadata
  )
  select
    v_quote.client_id,
    v_new_session_id,
    v_quote.target_plan_key,
    v_quote.target_plan_key,
    v_quote.billing_interval_months,
    v_source_entitlement.outreach_addon_key,
    v_source_entitlement.outreach_variant,
    v_source_entitlement.backend_addon_code,
    v_source_entitlement.applied_discount_percent,
    v_source_entitlement.applied_discount_type,
    v_source_entitlement.pack_monthly_discounted_cents,
    v_quote.target_full_period_price_cents,
    v_source_entitlement.outreach_monthly_discounted_cents,
    v_source_entitlement.outreach_period_total_cents,
    v_quote.target_full_period_price_cents,
    v_source_entitlement.catalog_snapshot,
    'entitlement_consumed',
    null,
    v_now,
    jsonb_build_object(
      'workspace_plan', true,
      'period_end_at', v_quote.period_end_at,
      'commercial_period_value_cents', v_quote.target_full_period_price_cents,
      'plan_change_quote_id', v_quote.id,
      'source_entitlement_id', v_source_entitlement.id
    )
  returning id into v_new_entitlement_id;

  v_credit_applied := v_quote.credit_applied_cents;

  if v_quote.current_unused_credit_cents > 0 then
    insert into public.client_credit_ledger (
      client_id, currency, entry_type, direction, amount_cents, balance_after_cents,
      source_quote_id, source_checkout_session_id, idempotency_key, metadata
    ) values (
      v_quote.client_id, v_quote.currency, 'proration_credit_generated', 'credit',
      v_quote.current_unused_credit_cents,
      v_balance + v_quote.current_unused_credit_cents,
      v_quote.id, v_new_session_id,
      p_idempotency_key || ':proration_credit',
      jsonb_build_object('source_entitlement_id', v_source_entitlement.id)
    );
    v_balance := v_balance + v_quote.current_unused_credit_cents;
  end if;

  if v_credit_applied > 0 then
    insert into public.client_credit_ledger (
      client_id, currency, entry_type, direction, amount_cents, balance_after_cents,
      source_quote_id, source_checkout_session_id, idempotency_key, metadata
    ) values (
      v_quote.client_id, v_quote.currency, 'plan_change_credit_applied', 'debit',
      v_credit_applied,
      greatest(0, v_balance + v_quote.current_unused_credit_cents - v_credit_applied),
      v_quote.id, v_new_session_id,
      p_idempotency_key || ':credit_applied',
      jsonb_build_object('target_plan_key', v_quote.target_plan_key)
    );
  end if;

  insert into public.commercial_checkout_audit_events (
    checkout_session_id, entitlement_id, event_type, actor_email, client_id, payload
  ) values (
    v_new_session_id, v_new_entitlement_id, 'plan_change_activated', p_actor_email, v_quote.client_id,
    jsonb_build_object(
      'quote_id', v_quote.id,
      'source_plan_key', v_quote.source_plan_key,
      'target_plan_key', v_quote.target_plan_key,
      'amount_due_cents', v_quote.amount_due_cents,
      'remaining_credit_cents', v_quote.remaining_credit_cents,
      'period_end_at', v_quote.period_end_at
    )
  );

  update public.commercial_plan_change_quotes
    set status = 'quote_activated',
        activated_at = v_now,
        activated_checkout_session_id = v_new_session_id,
        payment_status = v_payment_status,
        payment_provider = v_payment_provider,
        payment_confirmed_at = case when v_payment_status in ('confirmed', 'simulated_confirmed') then v_now else null end,
        updated_at = v_now
  where id = v_quote.id;

  return jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'quote_id', v_quote.id,
    'checkout_session_id', v_new_session_id,
    'entitlement_id', v_new_entitlement_id,
    'client_id', v_quote.client_id,
    'remaining_credit_cents', v_quote.remaining_credit_cents
  );
exception
  when unique_violation then
    select * into v_existing_quote
    from public.commercial_plan_change_quotes
    where idempotency_key = p_idempotency_key
    limit 1;
    if found and v_existing_quote.status = 'quote_activated' then
      return jsonb_build_object(
        'ok', true,
        'idempotent_replay', true,
        'quote_id', v_existing_quote.id,
        'checkout_session_id', v_existing_quote.activated_checkout_session_id,
        'client_id', v_existing_quote.client_id
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
end;
$$;

revoke all on function public.commercial_plan_change_source_revision(
  timestamptz, timestamptz, text, integer, uuid, uuid
) from anon, authenticated, public;
revoke all on function public.commercial_plan_change_source_revision_for_source(
  uuid, uuid, integer
) from anon, authenticated, public;

grant execute on function public.commercial_plan_change_source_revision(
  timestamptz, timestamptz, text, integer, uuid, uuid
) to service_role;
grant execute on function public.commercial_plan_change_source_revision_for_source(
  uuid, uuid, integer
) to service_role;
