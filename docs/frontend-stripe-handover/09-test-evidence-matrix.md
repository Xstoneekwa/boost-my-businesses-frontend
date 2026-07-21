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
| Profile Intelligence V1 production status | `cc73eb26ae99f0ca5d597d0660763742fabbdaf1`; `dpl_AtT2a8EcjcDPS4fMww2DPbJ4EmZJ` READY; no migration | production_validated |
| Profile Intelligence V2 field-level suite | 91/91 passed before the final smoke; final affected-core and onboarding guard replay 74/74 passed, covering field-level/global quality, FR/EN, no-geo, provenance, empty exclusions, manual edits, V4 compatibility, one-call rule and PostgreSQL concurrency | automated_tested |
| Profile Intelligence V2 prompt/no-leak | Snapshot limited to approved public fields, domain-only external link and 5 x 280-character captions; forbidden secrets/UUIDs/CDN URLs excluded | automated_tested |
| Profile Intelligence V2 targeted ESLint | Passed on 8 affected source and test files | automated_tested |
| Profile Intelligence V2 scoped TypeScript | Passed with isolated no-emit config | automated_tested |
| Profile Intelligence V2 Next.js production build | Passed with Next.js 16.2.1 | automated_tested |
| Profile Intelligence V2 local visual check | 10 deterministic captures: five states in FR and EN; GET fixtures only, no onboarding API or OpenAI call | locally_validated |
| Profile Intelligence V2 field-level smoke | One isolated `gpt-4o-mini-2024-07-18` Responses call: HTTP 200, schema/language/business valid, no geographic output, `targeting_quality_valid=true`, 5,399 ms total, estimated $0.0003465 and one provider fetch; no onboarding route or database write | locally_validated |
| Profile Intelligence V2 field-level status | Interim checkpoint locally certified before deployment; no migration. Production enrichment must remain untouched until Liam manually requests reanalysis | locally_validated |
| Confirmed Profile Intelligence to Targeting mapping | 97/97 targeted tests; enriched description before biography, keywords distinct from themes, canonical/localized language, `user_confirmed`-only geography, existing-targeting-session hydration, no automatic `save_targeting`, V1/V4/V5 compatibility | automated_tested |
| Confirmed Targeting mapping UI | Desktop and responsive deterministic GET-only fixtures; five content-sized multiline controls, no horizontal overflow, empty geography and localized `Français`; no POST or provider call | locally_validated |
| Confirmed Targeting mapping release status | Interim checkpoint only; production acceptance requires Liam's manual read-only control and must not save targeting or advance to CT | planned |

The one failure in the combined 81-test run is the pre-existing cancellation
projection assertion in `stripe-checkout-webhook-foundation.test.mjs`; it is
outside the reserved-entitlement handoff scope. The dedicated handoff suite and
all newly affected paths are green.

Profile Intelligence V1 also passed `git diff --check` and a no-leak source
scan. The single live schema-confirmation request was not repeated by tests;
provider calls in the suite use injected fixtures only.

Profile Intelligence V2 uses injected provider responses for automated and
visual validation. The separately authorized safe-scope canary smoke was
isolated from onboarding and persisted no payload or response artifact. Quality
is evaluated per field: weak optional category/description values do not block
valid core targeting fields, while insufficient essential fields are neutralized
and make the analysis retryable rather than confirmable. This matrix update is
interim evidence, not the final consolidated Frontend/Stripe handover.

The confirmed-to-targeting mapping replay also passed targeted ESLint, scoped
TypeScript, the Next.js 16.2.1 production build, `git diff --check` and no-leak.
No migration, provider call or business write is part of this checkpoint.

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
