# Stripe Test / Live Matrix

> Canonical billing snapshot verified on **2026-07-21** from Git, controlled
> documentation and read-only production Supabase queries. No Stripe secret,
> customer data or private URL is recorded here.

## Environment matrix

| Capability | Stripe Test | Stripe Live |
|---|---|---|
| Server-side checkout implementation | Implemented and pushed | Code path is intentionally Test-gated |
| Component price catalog | 20 active `environment=test` rows | **UNKNOWN / NOT CONFIGURED BY PROOF** |
| First-purchase checkout | 3 fulfilled attempts, `livemode=false` | No live attempt proven |
| Subscriptions | 3 paid Test first-purchase checkouts; current entitlement state verified per checkout | No live subscription proven |
| Signed webhook fulfillment | Implemented and tested in Test | **NOT ENABLED OR VALIDATED** |
| Billing portal | Test contract implemented | **NOT VALIDATED** |
| Plan change | Test implementation documented | Live path **NOT VALIDATED** |
| Production launch authorization | Test only | **NOT GRANTED** |

Sources: commit `65c58f1` ancestry, handoff commit `b0d459f3`, Supabase
production tables, production deployment `dpl_7RgAHghWTTYDEVzFThN7mGfeZpRU`,
and the linked Stripe documents; verified 2026-07-20.

## July 20 physical Test checkout checkpoint

- Growth, 12 months, EUR 1,323 was paid in Stripe Test.
- Stripe Test customer, subscription and invoice were created.
- Signed webhook fulfillment completed without manual replay or recovery.
- Auth, tenant/client ownership and the uniquely linked entitlement are
  consistent.
- The canonical entitlement is `entitlement_reserved` with `account_id=null`.
- No Instagram account exists yet.
- The corrected production handoff returns `checkout_paid`,
  `ready_for_login=true` and `/instagram-login` for the existing paid Test
  session.
- Automatic redirect is ready for Liam's physical check; it is not yet recorded
  as physically observed.
- Stripe Live remains **NOT IMPLEMENTED OR VALIDATED** by this checkpoint.

| Capability | Implemented | Automated tested | Stripe Test validated | Stripe Live validated |
|---|---|---|---|---|
| Initial checkout | Yes | Yes | Yes | No |
| Reserved entitlement handoff | Yes after patch | Yes | Yes after smoke | No |
| Redirect to login | Yes | Yes | Ready for Liam / not physical yet | No |
| Live checkout | No | No | N/A | No |
| Server minimum gate for 15 eligible CT | Local patch | Yes (0/14 rejected, 15 accepted) | No | No |

The local Add Instagram account patch does not change Stripe billing or consume
another checkout authorization. It preserves the reserved entitlement and
creates the Instagram account only inside a resumable server-owned onboarding
session. This row is not production evidence: migration, deployment and a
physical tenant validation remain pending.

Profile Intelligence V1 is a separate production checkpoint at
`cc73eb26ae99f0ca5d597d0660763742fabbdaf1`. Its factual
reanalysis updates only the existing onboarding session snapshot and preserves
the prepared account, ownership, credentials and entitlement. It does not call
Stripe, alter package gates, consume another authorization or activate runtime.
Ordinary avatar rendering costs no provider request; one SearchAPI request is
made only for an explicit accepted reanalysis. No production migration was
required.

Profile Intelligence V2 Safe Scope extends factual V1 with one explicit bounded
OpenAI enrichment action for Growth, Pro and Premium onboarding. This interim
checkpoint is locally certified with `gpt-4o-mini-2024-07-18`, the Responses
endpoint, strict Structured Output, an 8-second timeout, one call maximum and no
retry or fallback. Language and recursive no-geography guards run before
field-level quality validation. `niche`, `probable_audience`, `themes` and
`keywords` are essential; `suggested_category`, `business_description` and
`exclusions` are optional. A weak optional value is neutralized without
suppressing valid core fields, and empty exclusions are valid. Suggestions
remain separate from facts and require explicit client confirmation. The final
isolated smoke returned HTTP 200 with `targeting_quality_valid=true` in 5,399 ms
for an estimated $0.0003465, using one provider fetch and zero business writes.
Geography is absent from the AI contract, Stripe and entitlements are unchanged,
and Target AI V2.2 remains disconnected. Deployment alone does not certify
production enrichment: Liam must manually request that validation later. This
entry is an interim factual update, not the final Frontend/Stripe handover.

## Locked commercial model

- `full_cycle`: exactly one package component plus optional Outreach component.
- `outreach_only`: exactly one Outreach component and no package component.
- One Stripe subscription contains one line item per entitled component.
- Trusted Product, Price, amount, discount and redirect data are resolved
  server-side; the browser supplies commercial intent only.
- Activation occurs only from a valid signed, paid webhook. The success page
  never activates an entitlement.
- Test mode rejects live keys and `livemode=true` events.
- Welcome DM defaults: Pro and Premium `true`; Growth and Internal Test `false`;
  Outreach standalone enables Outreach, not Welcome.

Live package proof from `commercial_packages`, 2026-07-14:

| Package | Welcome default | Follow cap | Unfollow cap |
|---|---:|---:|---:|
| Growth | false | 80 | 80 |
| Internal Test | false | 20 | 20 |
| Premium | true | 120 | 120 |
| Pro | true | 120 | 120 |
| Outreach standalone | false | n/a | n/a |

Prices, product identifiers and customer-specific records are deliberately not
copied into this document.

## Gates remaining before Stripe Live

1. Explicit Liam GO for Live commercial activation.
2. Separate Live products/prices mapped to the locked model and reviewed
   server-side; no reuse of Test identifiers.
3. Live-restricted keys and webhook secret provisioned outside Git, with least
   privilege and rotation/revocation procedure.
4. Live webhook endpoint/signature/replay/idempotency and recovery runbook
   validated without exposing payloads or secrets.
5. Tax, currency, invoice, refund/cancellation, proration and billing-portal
   policies approved for the operating entities and markets.
6. Live entitlement activation, downgrade/expiry and component reconciliation
   tested with controlled transactions and explicit rollback criteria.
7. Monitoring, alerting, audit retention and support ownership approved.
8. Final security review of authorization, client ownership and price catalog.

Until every gate is proven, Live status remains **NOT ENABLED OR VALIDATED**.

## Canonical references

- [stripe-test-foundation.md](stripe-test-foundation.md)
- [stripe-per-entitlement-billing.md](stripe-per-entitlement-billing.md)
- [commercial-checkout.md](commercial-checkout.md)
- [commercial-per-account-plan-change.md](commercial-per-account-plan-change.md)
- [Frontend / Stripe current state](frontend-stripe-handover/01-current-state.md)
- [Checkout and webhooks](frontend-stripe-handover/05-checkout-and-webhooks.md)
- [Test evidence matrix](frontend-stripe-handover/09-test-evidence-matrix.md)
