# Stripe Test Foundation

## Scope

This phase adds **Stripe Test Mode infrastructure only**. It does not replace public simulated checkout, legal pages, or client dashboard billing UI.

## Architecture

1. **Admin harness** — `/instagram-dashboard/commercial-prod-test` panel **Stripe Test Checkout** (English UI).
2. **Server Stripe module** — `lib/commercial/stripe/*` (never imported in browser bundles for secrets).
3. **Internal commercial session** — `commercial_checkout_sessions.status = checkout_pending_payment` before webhook.
4. **Stripe attempt ledger** — `commercial_stripe_checkout_attempts` (one row per Stripe Checkout Session).
5. **Webhook ledger** — `commercial_stripe_webhook_events` (idempotent by `stripe_event_id`, no raw payload storage).
6. **Activation** — signed webhook only → existing `activateClientAccountEntitlementFromCheckout(mode:"stripe")` or `activatePlanChangeQuote`.
7. **Success page** — `/commercial/stripe-test/success` polls `session-status`; never activates.

## Expected environment variables (values not stored in repo)

- `STRIPE_SECRET_KEY` — must be **test** (`sk_test_…` / `rk_test_…` only)
- `STRIPE_WEBHOOK_SECRET` — webhook signing secret (test)
- `STRIPE_TEST_CHECKOUT_ENABLED=true`
- `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` — test portal configuration

Live keys and `livemode=true` events are **rejected** (`stripe_live_key_rejected`, `stripe_livemode_rejected`).

## Migrations (create only — do not apply in this phase)

- `20260710150000_commercial_stripe_test_foundation.sql`
  - `commercial_stripe_price_catalog`
  - `commercial_stripe_checkout_attempts`
  - `commercial_stripe_webhook_events`
  - `commercial_stripe_billing_profiles`
  - `commercial_stripe_subscriptions`
  - additive checkout session statuses

## Routes

| Route | Purpose |
|-------|---------|
| `POST /api/commercial/checkout/stripe/create-session` | Subscription checkout (internal/test gated) |
| `POST /api/commercial/checkout/stripe/plan-change/create-session` | One-off plan-change payment |
| `POST /api/commercial/stripe/webhook` | Signed webhook (sole activation source) |
| `GET /api/commercial/checkout/stripe/session-status` | Safe polling for success page |
| `POST /api/commercial/stripe/billing-portal` | Customer Portal (test) |
| `GET/POST /api/instagram-dashboard/commercial/stripe-test/*` | Admin readiness, catalog, harness checkout |

## Webhook events handled

- `checkout.session.completed` — activate subscription checkout or plan-change payment path
- `checkout.session.expired` — mark attempt/session expired
- `customer.subscription.created|updated|deleted` — projection sync
- `invoice.paid` / `invoice.payment_failed` — billing projection updates

## Price mapping

Test Price IDs are stored in `commercial_stripe_price_catalog` (environment=`test` only from admin UI). The browser never sends `price_id` as source of truth.

Plan-change one-off amounts are built from immutable `commercial_plan_change_quotes.amount_due_cents` server-side.

## Identity pre-checkout (first purchase)

Password is used **once** server-side via existing `resolveSimulatedPublicAuth` to create/reuse Supabase Auth user **without workspace**. Password is never written to Stripe metadata, commercial session metadata, or logs.

## Fail-closed codes

- `stripe_test_not_configured`
- `stripe_test_mode_required`
- `stripe_live_key_rejected`
- `stripe_livemode_rejected`

## Explicitly not replaced in this phase

- Public `CommercialCheckoutForm` simulated CTA
- Terms / Refund / Privacy / landing pricing
- `checkout_activated_test` simulation path
- Prod-test authorization flow
- Plan change with `amount_due_cents <= 0` (internal only)
- Stripe Live / public Stripe CTA

## Future test sequence (manual, after config)

1. Apply migration on isolated DB.
2. Set test env vars in deployment (not committed).
3. Admin: create prod-test authorization + test price mappings.
4. Admin harness: launch Stripe Test checkout.
5. Complete payment in Stripe Test mode.
6. Verify webhook activates entitlement once (idempotent replay safe).
7. Success page shows status via polling only.

## Rollback

Disable `STRIPE_TEST_CHECKOUT_ENABLED`. Simulation and existing commercial flows continue unchanged.
