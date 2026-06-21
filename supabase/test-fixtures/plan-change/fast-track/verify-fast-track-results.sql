-- FAST-TRACK FIXTURE ONLY — read-only verification of existing plan_change_test_* results.
-- No RPC calls. No INSERT/UPDATE/DELETE on persistent tables.

with expected_period_end as (
  select '2026-12-31 23:59:59+00'::timestamptz as ts
),
scenario_a as (
  select
    'A_upgrade_payment_required' as scenario,
    case
      when q.status = 'quote_pending'
        and q.payment_status = 'pending'
        and q.amount_due_cents > 0
        and coalesce(pro.pro_count, 0) = 0
      then 'PASS'
      else 'FAIL'
    end as status,
    'quote_pending; payment pending; no pro entitlement' as expected,
    format(
      'quote_status=%s payment_status=%s pro_entitlements=%s',
      q.status,
      q.payment_status,
      coalesce(pro.pro_count, 0)
    ) as actual,
    format('amount_due_cents=%s', q.amount_due_cents) as details_safe
  from public.commercial_plan_change_quotes q
  cross join expected_period_end e
  left join lateral (
    select count(*)::integer as pro_count
    from public.client_account_entitlements ent
    where ent.client_id = '11111111-1111-4111-8111-111111111111'
      and ent.plan_key = 'pro'
      and ent.status = 'entitlement_consumed'
  ) pro on true
  where q.idempotency_key = 'plan_change_test_scenario_a_key'
),
scenario_b as (
  select
    'B_upgrade_simulated_activation' as scenario,
    case
      when q.status = 'quote_activated'
        and q.payment_status in ('simulated_confirmed', 'confirmed')
        and coalesce(pro.pro_count, 0) >= 1
        and coalesce(sess.session_count, 0) = 1
        and pro.period_end_ts = e.ts
      then 'PASS'
      else 'FAIL'
    end as status,
    'quote_activated; pro entitlement; period_end preserved (timestamptz); single plan_change session' as expected,
    format(
      'quote_status=%s pro_entitlements=%s plan_change_sessions=%s period_end=%s',
      q.status,
      coalesce(pro.pro_count, 0),
      coalesce(sess.session_count, 0),
      coalesce(pro.period_end_ts::text, 'null')
    ) as actual,
    format('payment_status=%s', q.payment_status) as details_safe
  from public.commercial_plan_change_quotes q
  cross join expected_period_end e
  left join lateral (
    select
      count(*)::integer as pro_count,
      max(nullif(ent.metadata->>'period_end_at', '')::timestamptz) as period_end_ts
    from public.client_account_entitlements ent
    where ent.client_id = '22222222-2222-4222-8222-222222222222'
      and ent.plan_key = 'pro'
      and ent.status = 'entitlement_consumed'
  ) pro on true
  left join lateral (
    select count(*)::integer as session_count
    from public.commercial_checkout_sessions s
    where s.client_id = '22222222-2222-4222-8222-222222222222'
      and s.flow_type = 'plan_change'
  ) sess on true
  where q.idempotency_key = 'plan_change_test_scenario_b_key'
),
scenario_c as (
  select
    'C_downgrade_credit_no_cash' as scenario,
    case
      when q.status = 'quote_activated'
        and q.amount_due_cents = 0
        and coalesce(ledger.ledger_count, 0) = 1
        and coalesce(ledger.ledger_amount, 0) = 8000
        and coalesce(cash.cash_sessions, 0) = 0
        and growth.period_end_ts = e.ts
      then 'PASS'
      else 'FAIL'
    end as status,
    'proration_credit_generated=8000; amount_due=0; period_end preserved (timestamptz)' as expected,
    format(
      'ledger=%s amount=%s cash_sessions=%s period_end=%s',
      coalesce(ledger.ledger_count, 0),
      coalesce(ledger.ledger_amount, 0),
      coalesce(cash.cash_sessions, 0),
      coalesce(growth.period_end_ts::text, 'null')
    ) as actual,
    format('quote_status=%s amount_due_cents=%s', q.status, q.amount_due_cents) as details_safe
  from public.commercial_plan_change_quotes q
  cross join expected_period_end e
  left join lateral (
    select
      count(*)::integer as ledger_count,
      coalesce(max(l.amount_cents), 0)::integer as ledger_amount
    from public.client_credit_ledger l
    where l.client_id = '33333333-3333-4333-8333-333333333333'
      and l.entry_type = 'proration_credit_generated'
      and l.idempotency_key = 'plan_change_test_scenario_c_key:proration_credit'
  ) ledger on true
  left join lateral (
    select count(*)::integer as cash_sessions
    from public.commercial_checkout_sessions s
    where s.client_id = '33333333-3333-4333-8333-333333333333'
      and s.flow_type = 'plan_change'
      and s.total_period_cents > 0
  ) cash on true
  left join lateral (
    select nullif(ent.metadata->>'period_end_at', '')::timestamptz as period_end_ts
    from public.client_account_entitlements ent
    where ent.client_id = '33333333-3333-4333-8333-333333333333'
      and ent.plan_key = 'growth'
      and ent.status = 'entitlement_consumed'
    order by ent.created_at desc
    limit 1
  ) growth on true
  where q.idempotency_key = 'plan_change_test_scenario_c_key'
),
scenario_d as (
  select
    'D_credit_reused_remainder' as scenario,
    case
      when q.status = 'quote_activated'
        and q.remaining_credit_cents = 1000
        and coalesce(bal.ledger_balance, -1) = 1000
        and coalesce(debit.debit_count, 0) = 1
      then 'PASS'
      else 'FAIL'
    end as status,
    'remaining_credit_cents=1000; ledger balance=1000; credit debit applied' as expected,
    format(
      'remaining_credit_cents=%s ledger_balance=%s debit_count=%s',
      q.remaining_credit_cents,
      coalesce(bal.ledger_balance, -1),
      coalesce(debit.debit_count, 0)
    ) as actual,
    format('quote_status=%s credit_applied_cents=%s', q.status, q.credit_applied_cents) as details_safe
  from public.commercial_plan_change_quotes q
  left join lateral (
    select coalesce(sum(
      case when l.direction = 'credit' then l.amount_cents else -l.amount_cents end
    ), 0)::integer as ledger_balance
    from public.client_credit_ledger l
    where l.client_id = '44444444-4444-4444-8444-444444444444'
  ) bal on true
  left join lateral (
    select count(*)::integer as debit_count
    from public.client_credit_ledger l
    where l.client_id = '44444444-4444-4444-8444-444444444444'
      and l.entry_type = 'plan_change_credit_applied'
      and l.amount_cents = 2000
  ) debit on true
  where q.idempotency_key = 'plan_change_test_scenario_d_key'
),
scenario_e as (
  select
    'E_idempotence_no_duplicate' as scenario,
    case
      when coalesce(quotes.activated_quotes, 0) = 1
        and coalesce(sessions.session_count, 0) = 1
      then 'PASS'
      else 'FAIL'
    end as status,
    'single activated quote; single plan_change session (idempotency artifacts)' as expected,
    format(
      'activated_quotes=%s plan_change_sessions=%s',
      coalesce(quotes.activated_quotes, 0),
      coalesce(sessions.session_count, 0)
    ) as actual,
    'read-only structural idempotence check' as details_safe
  from (select 1) anchor
  left join lateral (
    select count(*)::integer as activated_quotes
    from public.commercial_plan_change_quotes q
    where q.idempotency_key = 'plan_change_test_scenario_e_key'
      and q.status = 'quote_activated'
  ) quotes on true
  left join lateral (
    select count(*)::integer as session_count
    from public.commercial_checkout_sessions s
    where s.idempotency_key = 'plan_change_test_scenario_e_key:session'
  ) sessions on true
),
all_results as (
  select scenario, status, expected, actual, details_safe from scenario_a
  union all select scenario, status, expected, actual, details_safe from scenario_b
  union all select scenario, status, expected, actual, details_safe from scenario_c
  union all select scenario, status, expected, actual, details_safe from scenario_d
  union all select scenario, status, expected, actual, details_safe from scenario_e
)
select scenario, status, expected, actual, details_safe
from all_results
order by scenario;

-- Summary (CTE scope is per statement; repeat all_results for pass/fail counts).
with expected_period_end as (
  select '2026-12-31 23:59:59+00'::timestamptz as ts
),
scenario_a as (
  select case
    when q.status = 'quote_pending'
      and q.payment_status = 'pending'
      and q.amount_due_cents > 0
      and coalesce(pro.pro_count, 0) = 0
    then 'PASS' else 'FAIL'
  end as status
  from public.commercial_plan_change_quotes q
  left join lateral (
    select count(*)::integer as pro_count
    from public.client_account_entitlements ent
    where ent.client_id = '11111111-1111-4111-8111-111111111111'
      and ent.plan_key = 'pro'
      and ent.status = 'entitlement_consumed'
  ) pro on true
  where q.idempotency_key = 'plan_change_test_scenario_a_key'
),
scenario_b as (
  select case
    when q.status = 'quote_activated'
      and q.payment_status in ('simulated_confirmed', 'confirmed')
      and coalesce(pro.pro_count, 0) >= 1
      and coalesce(sess.session_count, 0) = 1
      and pro.period_end_ts = e.ts
    then 'PASS' else 'FAIL'
  end as status
  from public.commercial_plan_change_quotes q
  cross join expected_period_end e
  left join lateral (
    select count(*)::integer as pro_count,
      max(nullif(ent.metadata->>'period_end_at', '')::timestamptz) as period_end_ts
    from public.client_account_entitlements ent
    where ent.client_id = '22222222-2222-4222-8222-222222222222'
      and ent.plan_key = 'pro'
      and ent.status = 'entitlement_consumed'
  ) pro on true
  left join lateral (
    select count(*)::integer as session_count
    from public.commercial_checkout_sessions s
    where s.client_id = '22222222-2222-4222-8222-222222222222'
      and s.flow_type = 'plan_change'
  ) sess on true
  where q.idempotency_key = 'plan_change_test_scenario_b_key'
),
scenario_c as (
  select case
    when q.status = 'quote_activated'
      and q.amount_due_cents = 0
      and coalesce(ledger.ledger_count, 0) = 1
      and coalesce(ledger.ledger_amount, 0) = 8000
      and coalesce(cash.cash_sessions, 0) = 0
      and growth.period_end_ts = e.ts
    then 'PASS' else 'FAIL'
  end as status
  from public.commercial_plan_change_quotes q
  cross join expected_period_end e
  left join lateral (
    select count(*)::integer as ledger_count,
      coalesce(max(l.amount_cents), 0)::integer as ledger_amount
    from public.client_credit_ledger l
    where l.client_id = '33333333-3333-4333-8333-333333333333'
      and l.entry_type = 'proration_credit_generated'
      and l.idempotency_key = 'plan_change_test_scenario_c_key:proration_credit'
  ) ledger on true
  left join lateral (
    select count(*)::integer as cash_sessions
    from public.commercial_checkout_sessions s
    where s.client_id = '33333333-3333-4333-8333-333333333333'
      and s.flow_type = 'plan_change'
      and s.total_period_cents > 0
  ) cash on true
  left join lateral (
    select nullif(ent.metadata->>'period_end_at', '')::timestamptz as period_end_ts
    from public.client_account_entitlements ent
    where ent.client_id = '33333333-3333-4333-8333-333333333333'
      and ent.plan_key = 'growth'
      and ent.status = 'entitlement_consumed'
    order by ent.created_at desc
    limit 1
  ) growth on true
  where q.idempotency_key = 'plan_change_test_scenario_c_key'
),
scenario_d as (
  select case
    when q.status = 'quote_activated'
      and q.remaining_credit_cents = 1000
      and coalesce(bal.ledger_balance, -1) = 1000
      and coalesce(debit.debit_count, 0) = 1
    then 'PASS' else 'FAIL'
  end as status
  from public.commercial_plan_change_quotes q
  left join lateral (
    select coalesce(sum(
      case when l.direction = 'credit' then l.amount_cents else -l.amount_cents end
    ), 0)::integer as ledger_balance
    from public.client_credit_ledger l
    where l.client_id = '44444444-4444-4444-8444-444444444444'
  ) bal on true
  left join lateral (
    select count(*)::integer as debit_count
    from public.client_credit_ledger l
    where l.client_id = '44444444-4444-4444-8444-444444444444'
      and l.entry_type = 'plan_change_credit_applied'
      and l.amount_cents = 2000
  ) debit on true
  where q.idempotency_key = 'plan_change_test_scenario_d_key'
),
scenario_e as (
  select case
    when coalesce(quotes.activated_quotes, 0) = 1
      and coalesce(sessions.session_count, 0) = 1
    then 'PASS' else 'FAIL'
  end as status
  from (select 1) anchor
  left join lateral (
    select count(*)::integer as activated_quotes
    from public.commercial_plan_change_quotes q
    where q.idempotency_key = 'plan_change_test_scenario_e_key'
      and q.status = 'quote_activated'
  ) quotes on true
  left join lateral (
    select count(*)::integer as session_count
    from public.commercial_checkout_sessions s
    where s.idempotency_key = 'plan_change_test_scenario_e_key:session'
  ) sessions on true
),
all_results as (
  select status from scenario_a
  union all select status from scenario_b
  union all select status from scenario_c
  union all select status from scenario_d
  union all select status from scenario_e
)
select
  count(*) filter (where status = 'PASS') as pass_count,
  count(*) filter (where status = 'FAIL') as fail_count,
  count(*) as total
from all_results;
