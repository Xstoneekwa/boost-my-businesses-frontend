# Tenants, users and commercial units

Snapshot date: **2026-07-20**.

## Third paid Stripe Test tenant

The completed Growth 12-month checkout created the third paid Stripe Test
tenant. It may be the fourth tenant row overall because non-paying/internal
tenants are counted separately from paid Stripe Test tenants.

Read-only production checks confirmed:

- one fulfilled Test `first_purchase` attempt for the checkout;
- one paid commercial checkout;
- one Auth user for the canonical email;
- one active client/tenant;
- one active tenant-user membership;
- one active owner relationship in `client_users`;
- one uniquely linked reserved entitlement;
- no Instagram account or Instagram credentials;
- no account assignment, run request or run.

## Reserved entitlement semantics

`entitlement_reserved` is the canonical state after initial payment and before
an Instagram account is added. In this state:

- `account_id` must remain null;
- ownership is anchored by the trusted server-side checkout, Auth user, client
  and tenant links;
- the entitlement is ready to be consumed only by the future Add Instagram
  account flow;
- it must not be interpreted as an already-created Instagram account.

The handoff predicate accepts `entitlement_reserved` and the compatibility
states `active` and `entitlement_consumed`, but only when the exact checkout,
attempt, identity, ownership and Test-mode guards all agree. Ambiguous or
duplicate rows fail closed.

## Commercial unit boundary

The initial purchase reserves one commercial entitlement. It does not create a
synthetic `account_id`. Future Instagram accounts must be created through the
canonical onboarding flow, each with its own entitlement/commercial-unit
ownership.

The production-Test authorization's `max_accounts=1` limits the authorization
to one initial checkout use. It does not define the tenant's future Instagram
account capacity.

## Next ownership gate

Before any Instagram account is added, implement and validate the server-side
maximum-15-CT gate. `additional_account` remains out of scope and blocked until
its ownership and billing path are secured.

References:

- [Current state](01-current-state.md)
- [Checkout and webhooks](05-checkout-and-webhooks.md)
- [Commercial checkout](../commercial-checkout.md)
- [Stripe per-entitlement billing](../stripe-per-entitlement-billing.md)
