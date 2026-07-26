# Stripe Per-Entitlement Billing

## Contract

Stripe is a billing projection. It does not replace entitlements, account runtime packages, scoped credits, scheduler eligibility, phone routing, or commercial policy revisions.

Customer scope:

```text
client_id -> Stripe Customer
```

Subscription scope:

```text
client_account_entitlement_id -> Stripe Subscription
```

`account_id` is nullable while an entitlement is reserved. It becomes required for per-account plan-change and is bound only when the canonical account/slot consumption flow consumes the entitlement.

## Commercial Modes

`full_cycle`:

- exactly one package item: Growth, Pro, or Premium;
- zero or one outreach item: Outreach Standard or Outreach AI;
- maximum two Stripe subscription items;
- runtime routing remains `full_cycle`.

`outreach_only`:

- no package item;
- exactly one outreach item: Outreach Standard or Outreach AI;
- exactly one Stripe subscription item;
- runtime routing remains `outreach_only`.

`full_cycle` and `outreach_only` are internal commercial/runtime modes, not Stripe Products.

## Outreach Exclusivity

Outreach exclusivity is per entitlement only.

Allowed:

- Account A / entitlement A: Outreach Standard;
- Account B / entitlement B: Outreach Standard;
- Account C / entitlement C: Outreach AI.

Forbidden:

- same entitlement with Standard + AI;
- same entitlement with two outreach items;
- client-wide Standard-vs-AI blocking.

## Catalog

Public Products:

- `Boost AI — Growth`
- `Boost AI — Pro`
- `Boost AI — Premium`
- `Instagram Outreach — Standard`
- `Instagram Outreach — AI`

Each Product has four public recurring Prices: 1, 3, 6, and 12 months. Amounts are derived from the existing commercial catalog and duration discount rules. There are no combined package + outreach public Prices.

## Snapshot Pricing

If an immutable `pricing_snapshot` differs from the public catalog because of agency/volume pricing, Stripe must not approximate it with a public Price, coupon, promotion code, or Customer Balance.

The server creates one recurring inline Price per component using:

- canonical Product;
- exact component amount from the snapshot;
- `currency=eur`;
- monthly recurring interval with `interval_count` 1/3/6/12;
- non-sensitive metadata: `client_id`, `entitlement_id`, `pricing_snapshot_fingerprint`, `component_kind`, `commercial_mode`.

The breakdown comes from the internal snapshot fields (`pack*`, `outreach*`). Historical snapshots are not rewritten.

## Plan Change

Plan-change Stripe payment is one-off and uses only `commercial_plan_change_quotes.amount_due_cents`.

No Stripe proration, coupon, Customer Balance, or second amount calculation is allowed. After payment confirmation, only the source entitlement/account projection may be rebound. If the rebind cannot be proven, the attempt stays `reconciliation_required` and no internal activation occurs.

Unsupported transitions stay fail-closed until separately implemented: mode changes, outreach Standard/AI changes, outreach removal, and duration changes.

## Runtime Routing

Stripe projection carries `commercial_mode`, but phone/runtime routing remains internal:

- `client_subscriptions.subscription_type`;
- `client_subscription_accounts`;
- `account_assignments`;
- `phone_devices.pool_type`;
- scheduler/run-control eligibility.

Stripe must never assign phones or override runtime package state directly.

## Test onboarding entitlement rollback

For an exact `checkout_activated_test` session only, the transactional rollback
may return its consumed per-account entitlement to `entitlement_reserved`.
`client_id`, checkout, package, term, pricing snapshots, and Test commercial
history are unchanged. Active state becomes `account_id = NULL` and
`consumed_at = NULL`; the prior consumption is retained in the commercial audit
event and append-only rollback audit. A conflicting reserved entitlement causes
the whole operation to fail before mutation.
