# Stripe Catalog Provisioning

## Scope

Provisioning creates or verifies Stripe Products and public recurring Prices for the standard catalog only. It does not create agency snapshot Prices, checkout sessions, subscriptions, customers, webhooks, entitlements, or runtime assignments.

## Products

Exact public Product names:

- `Boost AI — Growth`
- `Boost AI — Pro`
- `Boost AI — Premium`
- `Instagram Outreach — Standard`
- `Instagram Outreach — AI`

## Prices

Public recurring Prices:

- 5 Products;
- 4 durations per Product: 1, 3, 6, 12 months;
- `currency=eur`;
- `recurring.interval=month`;
- `recurring.interval_count=1|3|6|12`;
- amount from the source-controlled commercial catalog and duration discount rules.

There are no combined package + outreach Prices.

## Environments

Test and Live mappings are separate. The committed provisioner is Test-only for apply mode: it must reject live keys, uncertain keys, and `--live --apply`.

The source-controlled provisioner is dry-run by default. Apply mode requires an explicit safety flag, a server Stripe Test configuration, and fail-closed reconciliation of the full catalog before creating any object.

Apply reconciliation is non-destructive:

- existing canonical Products/Prices are reused;
- missing canonical Products/Prices are created with deterministic idempotency keys;
- ambiguous visible Product names stop the run before creating duplicates;
- existing canonical Prices with different economics stop the run;
- no Product or Price is archived, disabled, deleted, or updated.

## Database Mapping

New component mapping table:

`commercial_stripe_component_price_catalog`

Required dimensions:

- `environment`;
- `product_key`;
- `component_kind`;
- `package_key` or `outreach_key`;
- `billing_interval_months`;
- `expected_amount_cents`;
- `currency`;
- `stripe_product_id`;
- `stripe_price_id`;
- `active`;
- `catalog_version`.

Legacy `commercial_stripe_price_catalog` remains readable for compatibility/audit, but new multi-item checkout paths must use component mappings.

## Secrets

No secrets are stored in the repo. Provisioning reports must be redacted and must never include API keys, webhook secrets, customer data, emails, tokens, or raw Stripe payloads.

## Operator Sequence

1. Review manifest output in dry-run.
2. Verify Product names and Price amounts.
3. Run apply only with an explicit operator flag.
4. Verify all 20 component mappings.
5. Apply database mappings only after Stripe objects are verified.
6. Keep Test and Live catalogs separate.

## Production Mapping Sync

After `20260710150400_commercial_stripe_per_entitlement_multicomponent_billing.sql`
exists on Production, sync Test catalog mappings with:

```bash
node scripts/stripe-sync-public-catalog-mapping.mjs --apply --i-understand-this-writes-production-mapping
```

The script is Test-only for Stripe and Production-only for Supabase:

- Stripe key must be `sk_test_...` or `rk_test_...`;
- `SUPABASE_URL` must target `zgafnshkjywfltxgbtzg`;
- the isolated test project `nxntngkhkoynljcagmkq` is refused;
- Stripe Products/Prices are read-only in mapping mode;
- no Customer, Checkout, Subscription, webhook, coupon, or promotion is created.
