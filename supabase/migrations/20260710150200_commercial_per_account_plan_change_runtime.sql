-- Per-account commercial plan change + runtime policy revision (additive, non-destructive).
-- Legacy workspace-wide quotes and activate_commercial_plan_change remain unchanged.

alter table public.commercial_plan_change_quotes
  add column if not exists account_id uuid null references public.ig_accounts(id) on delete restrict,
  add column if not exists target_outreach_addon_key text null
    check (target_outreach_addon_key is null or target_outreach_addon_key in ('outreach_standard', 'outreach_ai')),
  add column if not exists change_scope text not null default 'workspace'
    check (change_scope in ('workspace', 'per_account')),
  add column if not exists pricing_snapshot jsonb null;

create index if not exists commercial_plan_change_quotes_account_status_idx
  on public.commercial_plan_change_quotes (client_id, account_id, status)
  where account_id is not null;

alter table public.client_credit_ledger
  add column if not exists account_id uuid null references public.ig_accounts(id) on delete set null,
  add column if not exists source_entitlement_id uuid null references public.client_account_entitlements(id) on delete set null;

create index if not exists client_credit_ledger_account_currency_idx
  on public.client_credit_ledger (client_id, account_id, currency, created_at desc)
  where account_id is not null;

comment on column public.client_credit_ledger.account_id is
  'NULL = legacy unscoped client credit. Per-account plan-change flows must only consume rows with matching account_id.';

create table if not exists public.account_commercial_policy_revisions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  package_code text not null,
  entitlement_id uuid null references public.client_account_entitlements(id) on delete set null,
  plan_change_quote_id uuid null references public.commercial_plan_change_quotes(id) on delete set null,
  revision_token text not null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_commercial_policy_revisions_account_created_idx
  on public.account_commercial_policy_revisions (account_id, created_at desc);

alter table public.account_commercial_policy_revisions enable row level security;

create or replace function public.account_scoped_credit_balance_cents(
  p_client_id uuid,
  p_account_id uuid,
  p_currency text default 'EUR'
)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(sum(
    case when direction = 'credit' then amount_cents else -amount_cents end
  ), 0)::integer
  from public.client_credit_ledger
  where client_id = p_client_id
    and currency = p_currency
    and account_id = p_account_id;
$$;

comment on function public.account_scoped_credit_balance_cents(uuid, uuid, text) is
  'Sum ledger credits scoped to one account. Legacy rows with account_id NULL are excluded (fail-closed for per-account flows).';

create or replace function public.commercial_plan_change_source_revision_for_account_source(
  p_entitlement_id uuid,
  p_session_id uuid,
  p_account_id uuid,
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
  ) || ':' || coalesce(p_account_id::text, '');
$$;

comment on function public.commercial_plan_change_source_revision_for_account_source(uuid, uuid, uuid, integer) is
  'Per-account plan change revision: canonical workspace revision suffixed with account_id.';

create or replace function public.bump_account_commercial_policy_revision(
  p_account_id uuid,
  p_client_id uuid,
  p_package_code text,
  p_entitlement_id uuid default null,
  p_plan_change_quote_id uuid default null,
  p_metadata_safe jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  v_token := md5(
    coalesce(p_account_id::text, '') || '|' ||
    coalesce(p_package_code, '') || '|' ||
    coalesce(p_entitlement_id::text, '') || '|' ||
    coalesce(p_plan_change_quote_id::text, '') || '|' ||
    coalesce(extract(epoch from now())::text, '')
  );

  insert into public.account_commercial_policy_revisions (
    account_id, client_id, package_code, entitlement_id, plan_change_quote_id, revision_token, metadata_safe
  ) values (
    p_account_id, p_client_id, p_package_code, p_entitlement_id, p_plan_change_quote_id, v_token, coalesce(p_metadata_safe, '{}'::jsonb)
  );

  return v_token;
end;
$$;

create or replace function public.apply_account_commercial_package_plan_change(
  p_account_id uuid,
  p_package_code text,
  p_quote_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_existing_code text;
begin
  select id, package_code into v_existing_id, v_existing_code
  from public.account_commercial_packages
  where account_id = p_account_id
    and status = 'active'
    and ends_at is null
  order by starts_at desc
  limit 1
  for update;

  if v_existing_code = p_package_code then
    return;
  end if;

  if v_existing_id is not null then
    update public.account_commercial_packages
      set ends_at = now(), updated_at = now()
      where id = v_existing_id;
  end if;

  insert into public.account_commercial_packages (
    account_id, package_code, status, source, metadata_safe
  ) values (
    p_account_id,
    p_package_code,
    'active',
    'plan_change',
    jsonb_build_object(
      'source', 'plan_change',
      'plan_change_quote_id', p_quote_id
    )
  );
end;
$$;

create or replace function public.activate_commercial_plan_change_per_account(
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
  v_policy_revision text;
  v_account_client_id uuid;
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
      'client_id', v_existing_quote.client_id,
      'account_id', v_existing_quote.account_id
    );
  end if;

  select * into v_quote
  from public.commercial_plan_change_quotes
  where id = p_quote_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'quote_not_found');
  end if;

  if v_quote.change_scope <> 'per_account' or v_quote.account_id is null then
    return jsonb_build_object('ok', false, 'code', 'quote_scope_invalid');
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

  select cia.client_id into v_account_client_id
  from public.client_instagram_accounts cia
  where cia.account_id = v_quote.account_id
    and cia.client_id = v_quote.client_id
  limit 1;

  if v_account_client_id is null then
    return jsonb_build_object('ok', false, 'code', 'account_client_mismatch');
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

  if not found or v_source_entitlement.id is null or v_source_session.id is null then
    return jsonb_build_object('ok', false, 'code', 'source_missing');
  end if;

  if v_source_entitlement.account_id is distinct from v_quote.account_id then
    return jsonb_build_object('ok', false, 'code', 'entitlement_account_mismatch');
  end if;

  if v_source_entitlement.status <> 'entitlement_consumed' then
    return jsonb_build_object('ok', false, 'code', 'source_inactive');
  end if;

  v_current_revision := public.commercial_plan_change_source_revision_for_account_source(
    v_quote.source_entitlement_id,
    v_quote.source_checkout_session_id,
    v_quote.account_id,
    v_quote.active_commercial_period_value_cents
  );

  if v_current_revision is null or v_current_revision <> v_quote.source_revision then
    update public.commercial_plan_change_quotes
      set status = 'quote_stale', updated_at = v_now
      where id = v_quote.id;
    return jsonb_build_object('ok', false, 'code', 'quote_stale');
  end if;

  v_balance := public.account_scoped_credit_balance_cents(v_quote.client_id, v_quote.account_id, v_quote.currency);

  if v_balance <> v_quote.existing_customer_credit_cents then
    update public.commercial_plan_change_quotes
      set status = 'quote_stale', updated_at = v_now
      where id = v_quote.id;
    return jsonb_build_object('ok', false, 'code', 'credit_balance_changed');
  end if;

  insert into public.commercial_checkout_sessions (
    idempotency_key, flow_type, status, client_id, auth_user_id, purchaser_email,
    plan_key, billing_interval_months, outreach_addon_key, billable_account_count,
    term_discount_percent, agency_discount_percent, applied_discount_percent, applied_discount_type,
    pack_base_monthly_cents, pack_monthly_discounted_cents, pack_period_total_cents,
    outreach_base_monthly_cents, outreach_monthly_discounted_cents, outreach_period_total_cents,
    total_period_cents, catalog_snapshot, metadata, activated_at
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
    coalesce(v_quote.target_outreach_addon_key, v_source_session.outreach_addon_key),
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
    coalesce(v_quote.pricing_snapshot, v_source_session.catalog_snapshot),
    jsonb_build_object(
      'checkout_context', 'per_account_plan_change',
      'change_scope', 'per_account',
      'account_id', v_quote.account_id,
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
    client_id, checkout_session_id, plan_key, commercial_package_code, billing_interval_months,
    outreach_addon_key, outreach_variant, backend_addon_code,
    applied_discount_percent, applied_discount_type,
    pack_monthly_discounted_cents, pack_period_total_cents,
    outreach_monthly_discounted_cents, outreach_period_total_cents, total_period_cents,
    catalog_snapshot, status, account_id, consumed_at, metadata
  )
  select
    v_quote.client_id,
    v_new_session_id,
    v_quote.target_plan_key,
    v_quote.target_plan_key,
    v_quote.billing_interval_months,
    coalesce(v_quote.target_outreach_addon_key, v_source_entitlement.outreach_addon_key),
    v_source_entitlement.outreach_variant,
    v_source_entitlement.backend_addon_code,
    v_source_entitlement.applied_discount_percent,
    v_source_entitlement.applied_discount_type,
    v_source_entitlement.pack_monthly_discounted_cents,
    v_quote.target_full_period_price_cents,
    v_source_entitlement.outreach_monthly_discounted_cents,
    v_source_entitlement.outreach_period_total_cents,
    v_quote.target_full_period_price_cents,
    coalesce(v_quote.pricing_snapshot, v_source_entitlement.catalog_snapshot),
    'entitlement_consumed',
    v_quote.account_id,
    v_now,
    jsonb_build_object(
      'per_account_plan', true,
      'account_id', v_quote.account_id,
      'period_end_at', v_quote.period_end_at,
      'commercial_period_value_cents', v_quote.target_full_period_price_cents,
      'plan_change_quote_id', v_quote.id,
      'source_entitlement_id', v_source_entitlement.id
    )
  returning id into v_new_entitlement_id;

  perform public.apply_account_commercial_package_plan_change(
    v_quote.account_id,
    v_quote.target_plan_key,
    v_quote.id
  );

  v_policy_revision := public.bump_account_commercial_policy_revision(
    v_quote.account_id,
    v_quote.client_id,
    v_quote.target_plan_key,
    v_new_entitlement_id,
    v_quote.id,
    jsonb_build_object('change_scope', 'per_account', 'source', 'plan_change')
  );

  v_credit_applied := v_quote.credit_applied_cents;

  if v_quote.current_unused_credit_cents > 0 then
    insert into public.client_credit_ledger (
      client_id, account_id, source_entitlement_id, currency, entry_type, direction, amount_cents, balance_after_cents,
      source_quote_id, source_checkout_session_id, idempotency_key, metadata
    ) values (
      v_quote.client_id, v_quote.account_id, v_source_entitlement.id, v_quote.currency, 'proration_credit_generated', 'credit',
      v_quote.current_unused_credit_cents,
      v_balance + v_quote.current_unused_credit_cents,
      v_quote.id, v_new_session_id,
      p_idempotency_key || ':proration_credit',
      jsonb_build_object('source_entitlement_id', v_source_entitlement.id, 'account_id', v_quote.account_id)
    );
    v_balance := v_balance + v_quote.current_unused_credit_cents;
  end if;

  if v_credit_applied > 0 then
    insert into public.client_credit_ledger (
      client_id, account_id, source_entitlement_id, currency, entry_type, direction, amount_cents, balance_after_cents,
      source_quote_id, source_checkout_session_id, idempotency_key, metadata
    ) values (
      v_quote.client_id, v_quote.account_id, v_new_entitlement_id, v_quote.currency, 'plan_change_credit_applied', 'debit',
      v_credit_applied,
      greatest(0, v_balance - v_credit_applied),
      v_quote.id, v_new_session_id,
      p_idempotency_key || ':credit_applied',
      jsonb_build_object('target_plan_key', v_quote.target_plan_key, 'account_id', v_quote.account_id)
    );
    v_balance := greatest(0, v_balance - v_credit_applied);
  end if;

  insert into public.commercial_checkout_audit_events (
    checkout_session_id, entitlement_id, event_type, actor_email, client_id, payload
  ) values (
    v_new_session_id, v_new_entitlement_id, 'plan_change_activated', p_actor_email, v_quote.client_id,
    jsonb_build_object(
      'quote_id', v_quote.id,
      'account_id', v_quote.account_id,
      'change_scope', 'per_account',
      'source_plan_key', v_quote.source_plan_key,
      'target_plan_key', v_quote.target_plan_key,
      'amount_due_cents', v_quote.amount_due_cents,
      'remaining_credit_cents', v_quote.remaining_credit_cents,
      'period_end_at', v_quote.period_end_at,
      'policy_revision', v_policy_revision
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
    'client_id', v_quote.client_id,
    'account_id', v_quote.account_id,
    'entitlement_id', v_new_entitlement_id,
    'policy_revision', v_policy_revision
  );
end;
$$;

revoke all on function public.activate_commercial_plan_change_per_account(uuid, text, text, boolean) from public;
grant execute on function public.activate_commercial_plan_change_per_account(uuid, text, text, boolean) to service_role;

revoke all on function public.account_scoped_credit_balance_cents(uuid, uuid, text) from public;
grant execute on function public.account_scoped_credit_balance_cents(uuid, uuid, text) to service_role;

revoke all on function public.commercial_plan_change_source_revision_for_account_source(uuid, uuid, uuid, integer) from public;
grant execute on function public.commercial_plan_change_source_revision_for_account_source(uuid, uuid, uuid, integer) to service_role;
