# Checkout and webhooks

Snapshot date: **2026-07-20**.

## Physical Stripe Test checkout

The validated purchase used the canonical initial checkout flow for Growth,
12 months, EUR 1,323, in Stripe Test. Stripe created the Test customer,
subscription and invoice, and the payment succeeded.

The related webhook deliveries were received in this order:

1. `checkout.session.completed`
2. `invoice.paid`
3. `customer.subscription.created`
4. `customer.subscription.updated`

All four records are processed. Repeated processing remained idempotent. No
webhook was replayed for this checkpoint.

## Handoff defect

The checkout and fulfillment were already correct, but the success-page polling
predicate treated only an activated entitlement as login-ready. The canonical
post-purchase row was `entitlement_reserved`, so the page remained on
"Payment received" even though payment, provisioning and ownership were valid.

The first divergence was therefore the readiness projection, not Stripe
payment, webhook fulfillment, Auth creation or tenant provisioning.

## Corrected predicate

`hasCheckoutEntitlementReadyForLogin()` now owns the readiness decision for
both the Stripe session polling path and the internal attempt polling path.
It accepts a reserved entitlement only when all of these remain true:

- the attempt is a fulfilled `first_purchase` in Test mode;
- the Stripe identifier is a Test Checkout Session;
- fulfillment has a timestamp and no fulfillment error;
- the attempt/session lookup is unique;
- checkout, Auth user, tenant/client and ownership links are exact;
- the linked entitlement is unique and belongs to the same checkout/client;
- `entitlement_reserved` has `account_id=null`;
- no identity or ownership mismatch exists.

Any missing, duplicate, Live, expired, mismatched or ambiguous evidence returns
not-ready. No browser-supplied tenant, client, entitlement owner or Stripe
customer is trusted.

## Validation

The existing paid Test session was polled in production after deployment. It
returned HTTP 200 with `checkout_paid`, `ready_for_login=true` and
`login_path=/instagram-login`. The login route also returned HTTP 200.

Preview deployment and build were READY, but Preview route smoke was unavailable
because that environment does not contain the server-only Supabase service-role
variable. No secret was copied into Preview to bypass that boundary.

No new payment, Checkout Session, webhook, recovery execution or business-data
write was produced by the smoke.

References:

- [Current state](01-current-state.md)
- [Test evidence matrix](09-test-evidence-matrix.md)
- [Commercial checkout](../commercial-checkout.md)
- [Stripe provisioning](../stripe-provisioning.md)
