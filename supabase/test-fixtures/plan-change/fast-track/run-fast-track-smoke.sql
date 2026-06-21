-- FAST-TRACK FIXTURE ONLY — Plan Change smoke scenarios (A–E).
-- Returns compact PASS/FAIL table: scenario, status, expected, actual, details_safe.

create temp table if not exists fast_track_smoke_results (
  scenario text not null,
  status text not null,
  expected text not null,
  actual text not null,
  details_safe text not null
);

truncate fast_track_smoke_results;

-- ---------------------------------------------------------------------------
-- Scenario A — Upgrade with positive amount due: payment required, no activation
-- ---------------------------------------------------------------------------
do $$
declare
  v_quote_id uuid := 'a0000001-0001-4001-8001-000000000001';
  v_result jsonb;
  v_quote_status text;
  v_ent_count integer;
begin
  insert into public.commercial_plan_change_quotes (
    id, client_id, idempotency_key,
    source_entitlement_id, source_checkout_session_id,
    source_plan_key, target_plan_key, billing_interval_months,
    period_start_at, period_end_at,
    active_commercial_period_value_cents, remaining_ratio_bps,
    current_unused_credit_cents, target_full_period_price_cents,
    target_remaining_cost_cents, existing_customer_credit_cents,
    available_credit_cents, credit_applied_cents, amount_due_cents,
    remaining_credit_cents, payment_status, source_revision, quote_expires_at
  )
  select
    v_quote_id,
    '11111111-1111-4111-8111-111111111111',
    'plan_change_test_scenario_a_key',
    e.id, s.id,
    'growth', 'pro', 12,
    '2026-06-01 12:00:00+00'::timestamptz, '2026-12-31 23:59:59+00'::timestamptz,
    120000, 5000,
    0, 240000, 10000, 0, 0, 0, 5000, 0,
    'pending',
    public.plan_change_test_source_revision(e.updated_at, s.updated_at, e.plan_key, 120000, e.id, s.id),
    now() + interval '7 days'
  from public.client_account_entitlements e
  join public.commercial_checkout_sessions s on s.id = e.checkout_session_id
  where e.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'
  on conflict (id) do nothing;

  v_result := public.activate_commercial_plan_change(
    v_quote_id,
    'plan_change_test_scenario_a_key',
    'plan_change_test_actor_a@example.invalid',
    false
  );

  select status into v_quote_status
  from public.commercial_plan_change_quotes where id = v_quote_id;

  select count(*) into v_ent_count
  from public.client_account_entitlements
  where client_id = '11111111-1111-4111-8111-111111111111'
    and plan_key = 'pro'
    and status = 'entitlement_consumed';

  insert into fast_track_smoke_results values (
    'A_upgrade_payment_required',
    case
      when v_result->>'code' = 'payment_required'
        and v_quote_status = 'quote_pending'
        and v_ent_count = 0
      then 'PASS' else 'FAIL'
    end,
    'payment_required; quote_pending; no pro entitlement',
    coalesce(v_result->>'code', v_result->>'ok'),
    format('quote_status=%s pro_entitlements=%s', v_quote_status, v_ent_count)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Scenario B — Upgrade confirmed (simulated): target plan, period end preserved
-- ---------------------------------------------------------------------------
do $$
declare
  v_quote_id uuid := 'b0000002-0002-4002-8002-000000000002';
  v_result jsonb;
  v_period_end timestamptz;
  v_expected_period_end timestamptz := '2026-12-31 23:59:59+00'::timestamptz;
  v_session_count integer;
  v_pro_count integer;
begin
  insert into public.commercial_plan_change_quotes (
    id, client_id, idempotency_key,
    source_entitlement_id, source_checkout_session_id,
    source_plan_key, target_plan_key, billing_interval_months,
    period_start_at, period_end_at,
    active_commercial_period_value_cents, remaining_ratio_bps,
    current_unused_credit_cents, target_full_period_price_cents,
    target_remaining_cost_cents, existing_customer_credit_cents,
    available_credit_cents, credit_applied_cents, amount_due_cents,
    remaining_credit_cents, payment_status, source_revision, quote_expires_at
  )
  select
    v_quote_id,
    '22222222-2222-4222-8222-222222222222',
    'plan_change_test_scenario_b_key',
    e.id, s.id,
    'growth', 'pro', 12,
    '2026-06-01 12:00:00+00'::timestamptz, '2026-12-31 23:59:59+00'::timestamptz,
    120000, 5000,
    0, 240000, 10000, 0, 0, 0, 5000, 0,
    'pending',
    public.plan_change_test_source_revision(e.updated_at, s.updated_at, e.plan_key, 120000, e.id, s.id),
    now() + interval '7 days'
  from public.client_account_entitlements e
  join public.commercial_checkout_sessions s on s.id = e.checkout_session_id
  where e.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01'
  on conflict (id) do nothing;

  v_result := public.activate_commercial_plan_change(
    v_quote_id,
    'plan_change_test_scenario_b_key',
    'plan_change_test_actor_b@example.invalid',
    true
  );

  select nullif(metadata->>'period_end_at', '')::timestamptz into v_period_end
  from public.client_account_entitlements
  where client_id = '22222222-2222-4222-8222-222222222222'
    and plan_key = 'pro'
    and status = 'entitlement_consumed'
  order by created_at desc
  limit 1;

  select count(*) into v_session_count
  from public.commercial_checkout_sessions
  where client_id = '22222222-2222-4222-8222-222222222222'
    and flow_type = 'plan_change';

  select count(*) into v_pro_count
  from public.client_account_entitlements
  where client_id = '22222222-2222-4222-8222-222222222222'
    and plan_key = 'pro'
    and status = 'entitlement_consumed';

  insert into fast_track_smoke_results values (
    'B_upgrade_simulated_activation',
    case
      when (v_result->>'ok')::boolean = true
        and (v_result->>'idempotent_replay')::boolean = false
        and v_period_end = v_expected_period_end
        and v_pro_count >= 1
        and v_session_count = 1
      then 'PASS' else 'FAIL'
    end,
    'ok; pro entitlement; period_end preserved (timestamptz); single plan_change session',
    coalesce(v_result->>'ok', 'false') || '; period_end=' || coalesce(v_period_end::text, 'null'),
    format('pro_entitlements=%s plan_change_sessions=%s', v_pro_count, v_session_count)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Scenario C — Downgrade: credit ledger, no cash collection, period end preserved
-- ---------------------------------------------------------------------------
do $$
declare
  v_quote_id uuid := 'c0000003-0003-4003-8003-000000000003';
  v_result jsonb;
  v_ledger_count integer;
  v_ledger_amount integer;
  v_period_end timestamptz;
  v_expected_period_end timestamptz := '2026-12-31 23:59:59+00'::timestamptz;
  v_cash_sessions integer;
begin
  insert into public.commercial_plan_change_quotes (
    id, client_id, idempotency_key,
    source_entitlement_id, source_checkout_session_id,
    source_plan_key, target_plan_key, billing_interval_months,
    period_start_at, period_end_at,
    active_commercial_period_value_cents, remaining_ratio_bps,
    current_unused_credit_cents, target_full_period_price_cents,
    target_remaining_cost_cents, existing_customer_credit_cents,
    available_credit_cents, credit_applied_cents, amount_due_cents,
    remaining_credit_cents, payment_status, source_revision, quote_expires_at
  )
  select
    v_quote_id,
    '33333333-3333-4333-8333-333333333333',
    'plan_change_test_scenario_c_key',
    e.id, s.id,
    'premium', 'growth', 12,
    '2026-06-01 12:00:00+00'::timestamptz, '2026-12-31 23:59:59+00'::timestamptz,
    360000, 5000,
    8000, 120000, 5000, 0, 8000, 3000, 0, 5000,
    'not_required',
    public.plan_change_test_source_revision(e.updated_at, s.updated_at, e.plan_key, 360000, e.id, s.id),
    now() + interval '7 days'
  from public.client_account_entitlements e
  join public.commercial_checkout_sessions s on s.id = e.checkout_session_id
  where e.id = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01'
  on conflict (id) do nothing;

  v_result := public.activate_commercial_plan_change(
    v_quote_id,
    'plan_change_test_scenario_c_key',
    'plan_change_test_actor_c@example.invalid',
    false
  );

  select count(*), coalesce(max(amount_cents), 0)
  into v_ledger_count, v_ledger_amount
  from public.client_credit_ledger
  where client_id = '33333333-3333-4333-8333-333333333333'
    and entry_type = 'proration_credit_generated'
    and idempotency_key = 'plan_change_test_scenario_c_key:proration_credit';

  select nullif(metadata->>'period_end_at', '')::timestamptz into v_period_end
  from public.client_account_entitlements
  where client_id = '33333333-3333-4333-8333-333333333333'
    and plan_key = 'growth'
    and status = 'entitlement_consumed'
  order by created_at desc
  limit 1;

  select count(*) into v_cash_sessions
  from public.commercial_checkout_sessions
  where client_id = '33333333-3333-4333-8333-333333333333'
    and flow_type = 'plan_change'
    and total_period_cents > 0;

  insert into fast_track_smoke_results values (
    'C_downgrade_credit_no_cash',
    case
      when (v_result->>'ok')::boolean = true
        and v_ledger_count = 1
        and v_ledger_amount = 8000
        and v_cash_sessions = 0
        and v_period_end = v_expected_period_end
      then 'PASS' else 'FAIL'
    end,
    'proration_credit_generated=8000; amount_due=0; period_end preserved (timestamptz)',
    format('ledger=%s amount=%s cash_sessions=%s', v_ledger_count, v_ledger_amount, v_cash_sessions),
    format('period_end=%s ok=%s', coalesce(v_period_end::text, 'null'), coalesce(v_result->>'ok', 'false'))
  );
end $$;

-- ---------------------------------------------------------------------------
-- Scenario D — Credit reused: applied correctly, remainder non-negative
-- ---------------------------------------------------------------------------
do $$
declare
  v_quote_id uuid := 'd0000004-0004-4004-8004-000000000004';
  v_result jsonb;
  v_balance integer;
  v_debit_count integer;
begin
  insert into public.commercial_plan_change_quotes (
    id, client_id, idempotency_key,
    source_entitlement_id, source_checkout_session_id,
    source_plan_key, target_plan_key, billing_interval_months,
    period_start_at, period_end_at,
    active_commercial_period_value_cents, remaining_ratio_bps,
    current_unused_credit_cents, target_full_period_price_cents,
    target_remaining_cost_cents, existing_customer_credit_cents,
    available_credit_cents, credit_applied_cents, amount_due_cents,
    remaining_credit_cents, payment_status, source_revision, quote_expires_at
  )
  select
    v_quote_id,
    '44444444-4444-4444-8444-444444444444',
    'plan_change_test_scenario_d_key',
    e.id, s.id,
    'growth', 'pro', 12,
    '2026-06-01 12:00:00+00'::timestamptz, '2026-12-31 23:59:59+00'::timestamptz,
    120000, 5000,
    0, 240000, 5000, 3000, 3000, 2000, 3000, 1000,
    'pending',
    public.plan_change_test_source_revision(e.updated_at, s.updated_at, e.plan_key, 120000, e.id, s.id),
    now() + interval '7 days'
  from public.client_account_entitlements e
  join public.commercial_checkout_sessions s on s.id = e.checkout_session_id
  where e.id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01'
  on conflict (id) do nothing;

  v_result := public.activate_commercial_plan_change(
    v_quote_id,
    'plan_change_test_scenario_d_key',
    'plan_change_test_actor_d@example.invalid',
    true
  );

  select coalesce(sum(case when direction = 'credit' then amount_cents else -amount_cents end), 0)::integer
  into v_balance
  from public.client_credit_ledger
  where client_id = '44444444-4444-4444-8444-444444444444';

  select count(*) into v_debit_count
  from public.client_credit_ledger
  where client_id = '44444444-4444-4444-8444-444444444444'
    and entry_type = 'plan_change_credit_applied'
    and amount_cents = 2000;

  insert into fast_track_smoke_results values (
    'D_credit_reused_remainder',
    case
      when (v_result->>'ok')::boolean = true
        and (v_result->>'remaining_credit_cents')::integer = 1000
        and v_balance = 1000
        and v_balance >= 0
        and v_debit_count = 1
      then 'PASS' else 'FAIL'
    end,
    'remaining_credit_cents=1000; ledger balance=1000; credit debit applied',
    format('balance=%s remaining=%s debits=%s', v_balance, v_result->>'remaining_credit_cents', v_debit_count),
    coalesce(v_result->>'ok', 'false')
  );
end $$;

-- ---------------------------------------------------------------------------
-- Scenario E — Idempotence: repeat activation does not duplicate
-- ---------------------------------------------------------------------------
do $$
declare
  v_quote_id uuid := 'e0000005-0005-4005-8005-000000000005';
  v_first jsonb;
  v_second jsonb;
  v_session_count integer;
  v_quote_count integer;
begin
  insert into public.commercial_plan_change_quotes (
    id, client_id, idempotency_key,
    source_entitlement_id, source_checkout_session_id,
    source_plan_key, target_plan_key, billing_interval_months,
    period_start_at, period_end_at,
    active_commercial_period_value_cents, remaining_ratio_bps,
    current_unused_credit_cents, target_full_period_price_cents,
    target_remaining_cost_cents, existing_customer_credit_cents,
    available_credit_cents, credit_applied_cents, amount_due_cents,
    remaining_credit_cents, payment_status, source_revision, quote_expires_at
  )
  select
    v_quote_id,
    '55555555-5555-4555-8555-555555555555',
    'plan_change_test_scenario_e_key',
    e.id, s.id,
    'growth', 'pro', 12,
    '2026-06-01 12:00:00+00'::timestamptz, '2026-12-31 23:59:59+00'::timestamptz,
    120000, 5000,
    0, 240000, 10000, 0, 0, 0, 5000, 0,
    'pending',
    public.plan_change_test_source_revision(e.updated_at, s.updated_at, e.plan_key, 120000, e.id, s.id),
    now() + interval '7 days'
  from public.client_account_entitlements e
  join public.commercial_checkout_sessions s on s.id = e.checkout_session_id
  where e.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01'
  on conflict (id) do nothing;

  v_first := public.activate_commercial_plan_change(
    v_quote_id,
    'plan_change_test_scenario_e_key',
    'plan_change_test_actor_e@example.invalid',
    true
  );

  v_second := public.activate_commercial_plan_change(
    v_quote_id,
    'plan_change_test_scenario_e_key',
    'plan_change_test_actor_e@example.invalid',
    true
  );

  select count(*) into v_session_count
  from public.commercial_checkout_sessions
  where idempotency_key = 'plan_change_test_scenario_e_key:session';

  select count(*) into v_quote_count
  from public.commercial_plan_change_quotes
  where idempotency_key = 'plan_change_test_scenario_e_key'
    and status = 'quote_activated';

  insert into fast_track_smoke_results values (
    'E_idempotence_no_duplicate',
    case
      when (v_first->>'ok')::boolean = true
        and (v_first->>'idempotent_replay')::boolean = false
        and (v_second->>'ok')::boolean = true
        and (v_second->>'idempotent_replay')::boolean = true
        and v_session_count = 1
        and v_quote_count = 1
      then 'PASS' else 'FAIL'
    end,
    'second call idempotent_replay; single session and activated quote',
    format('first_replay=%s second_replay=%s sessions=%s', v_first->>'idempotent_replay', v_second->>'idempotent_replay', v_session_count),
    format('activated_quotes=%s', v_quote_count)
  );
end $$;

select scenario, status, expected, actual, details_safe
from fast_track_smoke_results
order by scenario;

select
  count(*) filter (where status = 'PASS') as pass_count,
  count(*) filter (where status = 'FAIL') as fail_count,
  count(*) as total
from fast_track_smoke_results;
