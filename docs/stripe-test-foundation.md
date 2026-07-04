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
- `STRIPE_TEST_CHECKOUT_ALLOWED_ORIGINS` — comma/space separated public app origins allowed for Stripe Test success/cancel redirects
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

Stripe Checkout does **not** pass `payment_method_types`; payment methods stay controlled by Stripe Dashboard settings.

## Checkout Session creation boundary

Checkout Session creation is server-only and Test-only:

- the browser sends only the canonical commercial intent (`full_cycle` / `outreach_only`, package when applicable, outreach when applicable, billing interval, and internal client/entitlement context when applicable);
- the browser never supplies a trusted Stripe Price ID, amount, coupon, promotion code, Customer Balance, Product ID, or arbitrary redirect URL;
- server code resolves component Prices from `commercial_stripe_component_price_catalog` with `environment='test'`, `active=true`, expected amount, currency, component kind, and interval;
- success/cancel URLs are built from the request origin only after it matches `STRIPE_TEST_CHECKOUT_ALLOWED_ORIGINS`;
- a Stripe Customer is reused from `commercial_stripe_billing_profiles` when a client already exists, otherwise creation is idempotent and server-side only when the internal contract permits it;
- `mode: subscription` is used with one line item per component.

`full_cycle` creates exactly one package item and optionally one outreach item. `outreach_only` creates exactly one outreach item and no package item.

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

- `checkout.session.completed` — payment validation + fulfillment
- `checkout.session.expired` — mark attempt/session expired
- `customer.subscription.created|updated|deleted` — projection sync
- `invoice.paid` / `invoice.payment_failed` — billing projection updates

Events outside this allowlist are rejected fail-closed. Unknown customer/session/attempt correlation is also rejected; it is not silently ignored.

## Price mapping

Legacy combined Test Price IDs are stored in `commercial_stripe_price_catalog` for compatibility/audit.

New per-entitlement checkout paths resolve component Price IDs from `commercial_stripe_component_price_catalog`:

- package component: Growth / Pro / Premium;
- outreach component: Outreach Standard / Outreach AI;
- public catalog: existing recurring Price ID;
- immutable agency snapshot: server-created inline recurring Price per component, attached to the canonical Product.

The browser never sends `price_id`, `product_id`, amount, interval, discount, or entitlement binding as source of truth.

Plan-change one-off amounts are built from immutable `commercial_plan_change_quotes.amount_due_cents` server-side.

## Per-entitlement billing

Stripe Customer remains client-level. Stripe Subscription is entitlement-level:

`client_id -> Stripe Customer -> client_account_entitlement_id -> account_id when consumed -> Stripe Subscription`.

`full_cycle` subscriptions contain exactly one package item and optionally one outreach item. `outreach_only` subscriptions contain exactly one outreach item and no package item. Outreach Standard/AI exclusivity is per entitlement only; the same client may have Standard on A/B and AI on C.

Stripe never decides phone routing. Existing internal runtime data (`client_subscriptions.subscription_type`, assignments, `phone_devices.pool_type`) remains canonical.

Stripe is never the source of truth for entitlements. Stripe confirms payment state; internal tables and activation procedures remain authoritative for entitlement status, account binding, runtime mode, and any later worker/device eligibility.

## Local migration added for V1

`20260710150500_stripe_checkout_webhook_foundation_v1.sql` is required before the first real `outreach_only` checkout because historical commercial checkout tables required package fields (`plan_key`, `commercial_package_code`, package cents) to be non-null. The migration only makes those package fields nullable where `commercial_mode='outreach_only'` and adds mode-shape constraints. It is not applied to Production in this checkpoint.

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

1. Apply pending migrations on an isolated DB first, then Production only after review.
2. Set server-side Test variables in deployment only; do not commit or paste secrets.
3. Register the Stripe Test webhook endpoint and signing secret.
4. Confirm the 20 Test component mappings exist with `livemode=false`.
5. Admin: create prod-test authorization + launch Stripe Test checkout.
6. Complete payment in Stripe Test mode.
7. Verify webhook activates entitlement once (idempotent replay safe).
8. Verify failed fulfillment can be retried via webhook or admin recovery without a second charge.
9. Success page shows status via authenticated polling only.

Before the first real Checkout Test, confirm: no Live key, no Live object, no arbitrary redirect origin, no browser-supplied Price ID, no runtime/BotApp/phone side effect, and no production migration applied outside the release checklist.

## Rollback

Disable `STRIPE_TEST_CHECKOUT_ENABLED`. Simulation and existing commercial flows continue unchanged.
