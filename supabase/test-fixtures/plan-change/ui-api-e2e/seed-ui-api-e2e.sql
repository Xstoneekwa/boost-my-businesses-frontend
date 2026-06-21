-- UI/API E2E FIXTURE ONLY — fictional seed for one isolated run.
-- Expects psql variables: ui_run_id, ui_auth_user_id, ui_payment_auth_user_id, ui_client_id, ui_session_id, ui_entitlement_id, ui_test_email
-- period_end_at uses ISO-8601 Z suffix for deterministic JS proration (amount_due_cents > 0 on growth->pro upgrade).

insert into public.clients (id, name, status, metadata, created_at, updated_at)
values (
  :'ui_client_id'::uuid,
  'plan_change_ui_test_client_' || :'ui_run_id',
  'active',
  jsonb_build_object(
    'display_name', 'plan_change_ui_test_client_' || :'ui_run_id',
    'preferred_language', 'fr'
  ),
  '2026-06-01 12:00:00+00'::timestamptz,
  '2026-06-01 12:00:00+00'::timestamptz
)
on conflict (id) do update
set name = excluded.name,
    status = excluded.status,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at;

insert into public.tenant_users (user_id, tenant_id, role, created_at, updated_at)
values (
  :'ui_auth_user_id'::uuid,
  :'ui_client_id'::uuid,
  'tenant',
  '2026-06-01 12:00:00+00'::timestamptz,
  '2026-06-01 12:00:00+00'::timestamptz
)
on conflict (user_id) do update
set tenant_id = excluded.tenant_id,
    role = excluded.role,
    updated_at = excluded.updated_at;

insert into public.tenant_users (user_id, tenant_id, role, created_at, updated_at)
values (
  :'ui_payment_auth_user_id'::uuid,
  :'ui_client_id'::uuid,
  'tenant',
  '2026-06-01 12:00:00+00'::timestamptz,
  '2026-06-01 12:00:00+00'::timestamptz
)
on conflict (user_id) do update
set tenant_id = excluded.tenant_id,
    role = excluded.role,
    updated_at = excluded.updated_at;

insert into public.commercial_checkout_sessions (
  id, idempotency_key, flow_type, status, client_id, auth_user_id, purchaser_email,
  plan_key, billing_interval_months, outreach_addon_key, billable_account_count,
  term_discount_percent, agency_discount_percent, applied_discount_percent, applied_discount_type,
  pack_base_monthly_cents, pack_monthly_discounted_cents, pack_period_total_cents,
  outreach_base_monthly_cents, outreach_monthly_discounted_cents, outreach_period_total_cents,
  total_period_cents, catalog_snapshot, metadata, created_at, updated_at, activated_at
)
values (
  :'ui_session_id'::uuid,
  'plan_change_ui_test_seed_session_' || :'ui_run_id',
  'first_purchase',
  'checkout_activated_test',
  :'ui_client_id'::uuid,
  :'ui_auth_user_id'::uuid,
  :'ui_test_email',
  'growth',
  12,
  null,
  1,
  0,
  0,
  0,
  'none',
  10000,
  10000,
  120000,
  null,
  null,
  null,
  120000,
  '{}'::jsonb,
  jsonb_build_object('checkout_context', 'plan_change_ui_test_fixture'),
  '2026-06-01 12:00:00+00'::timestamptz,
  '2026-06-01 12:00:00+00'::timestamptz,
  '2026-06-01 12:00:00+00'::timestamptz
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
values (
  :'ui_entitlement_id'::uuid,
  :'ui_client_id'::uuid,
  :'ui_session_id'::uuid,
  'growth',
  'growth',
  12,
  null,
  null,
  null,
  0,
  'none',
  10000,
  120000,
  null,
  null,
  120000,
  '{}'::jsonb,
  'entitlement_consumed',
  null,
  '2026-06-01 12:00:00+00'::timestamptz,
  jsonb_build_object(
    'workspace_plan', true,
    'period_end_at', '2027-06-01T12:00:00.000Z',
    'commercial_period_value_cents', 120000
  ),
  '2026-06-01 12:00:00+00'::timestamptz,
  '2026-06-01 12:00:00+00'::timestamptz
)
on conflict (id) do nothing;
