# Test evidence matrix

Snapshot date: **2026-07-21**.

## Handoff evidence

| Evidence | Result | Level |
|---|---|---|
| Dedicated handoff suite | 22/22 passed | automated_tested |
| Relevant commercial suites | 80/81 passed | automated_tested |
| Targeted ESLint | Passed | automated_tested |
| Next.js production build | Passed | automated_tested |
| `git diff --check` | Passed | automated_tested |
| No-leak scan | Passed | automated_tested |
| Preview deployment | READY | automated_tested |
| Production deployment | READY | production_validated |
| Existing Test session polling | HTTP 200, ready for login | stripe_test_validated |
| `/instagram-login` route | HTTP 200 | production_validated |
| Automatic browser redirect | Ready, not yet physically observed by Liam | partial |
| Stripe Live checkout | Not exercised | blocked |
| Add-account onboarding targeted suite | 132/132 passed, including ephemeral PostgreSQL concurrency | automated_tested |
| Server-side 15 CT gate | 0 and 14 rejected; 15 accepted | automated_tested |
| Add-account production deployment | `dpl_GWNdmXkZE1vacaHtHajFMTFAukbo` READY; canonical alias active | production_validated |
| Add-account schema migration | Applied; server-only RPC privileges verified | production_validated |
| Add-account physical onboarding | Not performed; no real account was created | planned |
| Profile Intelligence V1 targeted suite | 59/59 passed: lookup/mapping, legacy/V1 compatibility, provenance, language, avatar bounds/fallback, reanalysis policy and no duplication | automated_tested |
| Profile Intelligence V1 targeted ESLint | Passed on 10 affected TS/TSX files | automated_tested |
| Profile Intelligence V1 Next.js production build | Passed with Next.js 16.2.1, including TypeScript and `/api/instagram-client/onboarding/avatar` | automated_tested |
| Profile Intelligence V1 local visual check | Passed with an isolated mocked GET; no Supabase write or provider call | locally_validated |
| Profile Intelligence V1 production status | Not committed, not deployed, no migration | planned |

The one failure in the combined 81-test run is the pre-existing cancellation
projection assertion in `stripe-checkout-webhook-foundation.test.mjs`; it is
outside the reserved-entitlement handoff scope. The dedicated handoff suite and
all newly affected paths are green.

Profile Intelligence V1 also passed `git diff --check` and a no-leak source
scan. The single live schema-confirmation request was not repeated by tests;
provider calls in the suite use injected fixtures only.

## Predicate cases covered

- canonical production shape with links owned by the checkout row;
- reserved, active and consumed entitlement compatibility states;
- null account required for a reserved entitlement;
- exact Auth user, tenant, client and owner membership;
- duplicate attempt, checkout or entitlement rejection;
- Test/Live separation and Test Session validation;
- unfulfilled attempt, missing fulfillment timestamp and fulfillment error;
- mismatched checkout, client, user or entitlement ownership;
- identical decision from Stripe-session and internal-attempt polling.

## Production read-only evidence

Before and after deployment, the checkout retained:

- one fulfilled attempt;
- one `checkout_paid` checkout;
- one `entitlement_reserved` entitlement with `account_id=null`;
- four processed related webhook records;
- one consumed production-Test authorization (`used=1`, `max=1`);
- zero Instagram accounts, credentials, assignments, run requests and runs.

The latest related webhook predates deployment, confirming that smoke validation
did not create or replay a webhook.

References:

- [Checkout and webhooks](05-checkout-and-webhooks.md)
- [Known gaps](10-known-gaps.md)
- [Stripe Test / Live matrix](../STRIPE_TEST_LIVE_MATRIX.md)
