-- FAST-TRACK FIXTURE ONLY — fictional isolated seed data.
-- Prefix: plan_change_test_ — no real emails or usernames.

-- Fixed fixture timestamps for stable source_revision in smoke scenarios.
-- period_end_at preserved across activations: 2026-12-31

insert into public.clients (id, name, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', 'plan_change_test_client_a', '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00'),
  ('22222222-2222-4222-8222-222222222222', 'plan_change_test_client_b', '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00'),
  ('33333333-3333-4333-8333-333333333333', 'plan_change_test_client_c', '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00'),
  ('44444444-4444-4444-8444-444444444444', 'plan_change_test_client_d', '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00'),
  ('55555555-5555-4555-8555-555555555555', 'plan_change_test_client_e', '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00')
on conflict (id) do nothing;

insert into public.commercial_checkout_sessions (
  id, idempotency_key, flow_type, status, client_id, auth_user_id, purchaser_email,
  plan_key, billing_interval_months, outreach_addon_key, billable_account_count,
  term_discount_percent, agency_discount_percent, applied_discount_percent, applied_discount_type,
  pack_base_monthly_cents, pack_monthly_discounted_cents, pack_period_total_cents,
  outreach_base_monthly_cents, outreach_monthly_discounted_cents, outreach_period_total_cents,
  total_period_cents, catalog_snapshot, metadata, created_at, updated_at, activated_at
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'plan_change_test_seed_session_a',
    'first_purchase', 'checkout_activated_test',
    '11111111-1111-4111-8111-111111111111',
    '99999999-9999-4999-8999-999999999999',
    'plan_change_test_purchaser_a@example.invalid',
    'growth', 12, null, 1, 0, 0, 0, 'none',
    10000, 10000, 120000, null, null, null, 120000, '{}'::jsonb, '{}'::jsonb,
    '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'plan_change_test_seed_session_b',
    'first_purchase', 'checkout_activated_test',
    '22222222-2222-4222-8222-222222222222',
    '99999999-9999-4999-8999-999999999999',
    'plan_change_test_purchaser_b@example.invalid',
    'growth', 12, null, 1, 0, 0, 0, 'none',
    10000, 10000, 120000, null, null, null, 120000, '{}'::jsonb, '{}'::jsonb,
    '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'plan_change_test_seed_session_c',
    'first_purchase', 'checkout_activated_test',
    '33333333-3333-4333-8333-333333333333',
    '99999999-9999-4999-8999-999999999999',
    'plan_change_test_purchaser_c@example.invalid',
    'premium', 12, null, 1, 0, 0, 0, 'none',
    30000, 30000, 360000, null, null, null, 360000, '{}'::jsonb, '{}'::jsonb,
    '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00'
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'plan_change_test_seed_session_d',
    'first_purchase', 'checkout_activated_test',
    '44444444-4444-4444-8444-444444444444',
    '99999999-9999-4999-8999-999999999999',
    'plan_change_test_purchaser_d@example.invalid',
    'growth', 12, null, 1, 0, 0, 0, 'none',
    10000, 10000, 120000, null, null, null, 120000, '{}'::jsonb, '{}'::jsonb,
    '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'plan_change_test_seed_session_e',
    'first_purchase', 'checkout_activated_test',
    '55555555-5555-4555-8555-555555555555',
    '99999999-9999-4999-8999-999999999999',
    'plan_change_test_purchaser_e@example.invalid',
    'growth', 12, null, 1, 0, 0, 0, 'none',
    10000, 10000, 120000, null, null, null, 120000, '{}'::jsonb, '{}'::jsonb,
    '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00'
  )
on conflict (id) do nothing;

insert into public.client_account_entitlements (
  id, client_id, checkout_session_id, plan_key, commercial_package_code, billing_interval_months,
  outreach_addon_key, outreach_variant, backend_addon_code,
  applied_discount_percent, applied_discount_type,
  pack_monthly_discounted_cents, pack_period_total_cents,
  outreach_monthly_discounted_cents, outreach_period_total_cents, total_period_cents,
  catalog_snapshot, status, account_id, consumed_at, metadata, created_at, updated_at
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'growth', 'growth', 12, null, null, null, 0, 'none',
    10000, 120000, null, null, 120000, '{}'::jsonb, 'entitlement_consumed', null,
    '2026-06-01 12:00:00+00',
    jsonb_build_object('workspace_plan', true, 'period_end_at', '2026-12-31T23:59:59+00'),
    '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01',
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'growth', 'growth', 12, null, null, null, 0, 'none',
    10000, 120000, null, null, 120000, '{}'::jsonb, 'entitlement_consumed', null,
    '2026-06-01 12:00:00+00',
    jsonb_build_object('workspace_plan', true, 'period_end_at', '2026-12-31T23:59:59+00'),
    '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
    '33333333-3333-4333-8333-333333333333',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'premium', 'premium', 12, null, null, null, 0, 'none',
    30000, 360000, null, null, 360000, '{}'::jsonb, 'entitlement_consumed', null,
    '2026-06-01 12:00:00+00',
    jsonb_build_object('workspace_plan', true, 'period_end_at', '2026-12-31T23:59:59+00'),
    '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00'
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
    '44444444-4444-4444-8444-444444444444',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'growth', 'growth', 12, null, null, null, 0, 'none',
    10000, 120000, null, null, 120000, '{}'::jsonb, 'entitlement_consumed', null,
    '2026-06-01 12:00:00+00',
    jsonb_build_object('workspace_plan', true, 'period_end_at', '2026-12-31T23:59:59+00'),
    '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
    '55555555-5555-4555-8555-555555555555',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'growth', 'growth', 12, null, null, null, 0, 'none',
    10000, 120000, null, null, 120000, '{}'::jsonb, 'entitlement_consumed', null,
    '2026-06-01 12:00:00+00',
    jsonb_build_object('workspace_plan', true, 'period_end_at', '2026-12-31T23:59:59+00'),
    '2026-06-01 12:00:00+00', '2026-06-01 12:00:00+00'
  )
on conflict (id) do nothing;

-- Scenario D: pre-existing customer credit (3000 cents) before quote activation.
insert into public.client_credit_ledger (
  id, client_id, currency, entry_type, direction, amount_cents, balance_after_cents,
  source_quote_id, source_checkout_session_id, idempotency_key, metadata, created_at
)
select
  'dddddddd-dddd-4ddd-8ddd-dddddddddd99',
  '44444444-4444-4444-8444-444444444444',
  'EUR', 'manual_adjustment', 'credit', 3000, 3000,
  null, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'plan_change_test_seed_credit_d',
  jsonb_build_object('fixture', 'plan_change_test_credit_seed'),
  '2026-06-01 12:00:00+00'
where not exists (
  select 1 from public.client_credit_ledger where idempotency_key = 'plan_change_test_seed_credit_d'
);
