# Stripe Test / Live Matrix

> Canonical billing snapshot verified on **2026-07-14** from Git, controlled
> documentation and read-only production Supabase queries. No Stripe secret,
> customer data or private URL is recorded here.

## Environment matrix

| Capability | Stripe Test | Stripe Live |
|---|---|---|
| Server-side checkout implementation | Implemented and pushed | Code path is intentionally Test-gated |
| Component price catalog | 20 active `environment=test` rows | **UNKNOWN / NOT CONFIGURED BY PROOF** |
| First-purchase checkout | 2 fulfilled attempts, `livemode=false` | No live attempt proven |
| Subscriptions | 2 active `full_cycle`, `livemode=false` | No live subscription proven |
| Signed webhook fulfillment | Implemented and tested in Test | **NOT ENABLED OR VALIDATED** |
| Billing portal | Test contract implemented | **NOT VALIDATED** |
| Plan change | Test implementation documented | Live path **NOT VALIDATED** |
| Production launch authorization | Test only | **NOT GRANTED** |

Sources: commit `65c58f1` ancestry, Supabase production tables, and the linked
Stripe documents; verified 2026-07-14.

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
