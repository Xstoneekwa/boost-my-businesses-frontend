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
- `20260710150100_commercial_stripe_webhook_recovery.sql`
  - webhook recovery columns + `claim_commercial_stripe_webhook_event` RPC (service role only)
  - attempt fulfillment states + reconciliation columns

## Routes

| Route | Purpose |
|-------|---------|
| `POST /api/commercial/checkout/stripe/create-session` | Subscription checkout (internal/test gated) |
| `POST /api/commercial/checkout/stripe/plan-change/create-session` | One-off plan-change payment |
| `POST /api/commercial/stripe/webhook` | Signed webhook (sole activation source) |
| `GET /api/commercial/checkout/stripe/session-status` | Safe polling for success page (ownership enforced) |
| `POST /api/commercial/stripe/billing-portal` | Customer Portal (test) |
| `GET/POST /api/instagram-dashboard/commercial/stripe-test/*` | Admin readiness, catalog, harness checkout |
| `POST /api/instagram-dashboard/commercial/stripe-test/recover-fulfillment` | Admin-only retry of paid attempt fulfillment |

## Payment confirmed vs checkout completed

`checkout.session.completed` alone is **not** sufficient.

Subscription fulfillment requires:

- valid webhook signature
- `livemode === false`
- internal attempt linked to the Stripe session
- Checkout Session `payment_status === paid`
- Stripe Subscription id present
- Subscription status `active` or `trialing`

Plan-change one-off fulfillment requires:

- valid webhook signature
- `livemode === false`
- internal attempt with persisted `stripe_subscription_id` + `target_stripe_price_id`
- Checkout Session `payment_status === paid`
- PaymentIntent `succeeded` when available

Unpaid / async-pending sessions are stored as attempt status `awaiting_payment`. No entitlement, no workspace, no internal plan change.

Stripe Test Foundation currently restricts Checkout to `payment_method_types: ["card"]` to avoid deferred payment methods in V1.

## Webhook event state machine

Ledger statuses: `processing`, `processed`, `ignored`, `failed`, `retryable`.

Claim rules (`claim_commercial_stripe_webhook_event`):

- never seen → claim `processing`
- `processed` / `ignored` → HTTP 200 deduplicated
- `failed` / `retryable` → reclaim and reprocess
- fresh `processing` lease → HTTP 503 concurrent (Stripe retries)
- stale `processing` lease → reclaim

HTTP responses:

- fulfillment success → 200 + `processed`
- transient fulfillment failure → 500 + `retryable`
- permanent validation failure → 422 + `failed`

## Attempt state machine

Attempt statuses:

- `session_created`
- `awaiting_payment`
- `payment_confirmed`
- `fulfillment_processing`
- `fulfilled`
- `reconciliation_required`
- `expired` / `failed` / `cancelled`

Rules:

- `fulfilled` only after payment confirmed + optional Stripe sync + internal activation succeed
- payment confirmed is persisted before fulfillment begins
- `reconciliation_required` keeps payment proof without creating a new Checkout

## Plan change sync (mandatory)

At attempt creation:

- resolve and persist `stripe_subscription_id`
- resolve and persist `target_stripe_price_id`
- refuse Checkout creation if either is missing

After payment confirmed:

1. sync subscription item to target Price (`proration_behavior: "none"`)
2. only then confirm quote payment + call `activate_commercial_plan_change`

If sync fails: internal plan unchanged, quote not activated, attempt → `reconciliation_required`, webhook → retryable.

Admin recovery retries fulfillment for an existing paid attempt only. No second Checkout. No second charge.

## Session-status ownership

`GET /api/commercial/checkout/stripe/session-status`:

- requires authenticated user or admin
- verifies `auth_user_id` or `client_id` ownership
- returns only safe commercial status fields
- never returns Stripe customer id, payment intent, webhook payload, or secrets

First purchase without client workspace: user must sign in with the pre-created Auth identity to poll status. Anonymous lookup by Stripe session id is rejected.

## Webhook events handled

- `checkout.session.completed` / `checkout.session.async_payment_succeeded` — payment validation + fulfillment
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
- `payment_not_confirmed`
- `stripe_subscription_missing`
- `target_price_missing`
- `stripe_subscription_sync_failed`
- `session_forbidden`

## Explicitly not replaced in this phase

- Public `CommercialCheckoutForm` simulated CTA
- Terms / Refund / Privacy / landing pricing
- `checkout_activated_test` simulation path
- Prod-test authorization flow
- Plan change with `amount_due_cents <= 0` (internal only)
- Stripe Live / public Stripe CTA

## Future test sequence (manual, after config)

1. Apply migrations on isolated DB.
2. Set test env vars in deployment (not committed).
3. Admin: create prod-test authorization + test price mappings.
4. Admin harness: launch Stripe Test checkout.
5. Complete payment in Stripe Test mode.
6. Verify webhook activates entitlement once (idempotent replay safe).
7. Verify failed fulfillment can be retried via webhook or admin recovery without a second charge.
8. Success page shows status via authenticated polling only.

## Rollback

Disable `STRIPE_TEST_CHECKOUT_ENABLED`. Simulation and existing commercial flows continue unchanged.
