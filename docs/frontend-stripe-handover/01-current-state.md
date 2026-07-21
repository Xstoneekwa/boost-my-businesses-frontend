# Frontend / Stripe current state

Snapshot date: **2026-07-21**.

This document records the current commercial handoff after the third paid
Stripe Test tenant checkout. It complements the canonical checkout and Stripe
matrix documents; it does not replace them.

## Current checkpoint

- Product: Growth, 12 months.
- Paid amount: EUR 1,323 in Stripe Test.
- Checkout type: `first_purchase`.
- Checkout attempt: fulfilled, `livemode=false`.
- Commercial checkout: `checkout_paid`.
- Canonical entitlement: `entitlement_reserved`, with `account_id=null`.
- Auth user, tenant, client ownership and subscription ownership: present and
  consistent.
- Instagram account: not created.
- Existing paid Checkout Session used for validation: `cs_test_a1PF...Pmmc`.
- No webhook replay, recovery route or manual business-data mutation was used.

The post-checkout handoff now treats a uniquely linked reserved entitlement as
ready for login when every Test-only ownership and fulfillment guard passes.
The production polling response is:

```json
{
  "commercial_status": "checkout_paid",
  "ready_for_login": true,
  "login_path": "/instagram-login"
}
```

The login route returns HTTP 200. The automatic browser redirect remains ready
for Liam's physical validation; it is not recorded as physically observed yet.

## Deployment evidence

- Functional commit: `b0d459f3b1f3ba384081e7247fb0e9e75cf49efa`.
- Preview deployment: `dpl_8VP2dMfdcriSYcNMQyKQMx5NBifM`, READY.
- Production deployment: `dpl_7RgAHghWTTYDEVzFThN7mGfeZpRU`, READY.
- Production alias: `https://www.boostmybusinesses.com`.
- Preview build and TypeScript validation passed. Its route smoke could not run
  because the Preview environment does not expose the server-only Supabase
  service-role variable.
- Production route smoke passed against the pre-existing paid Test session.

No new Checkout Session, payment, tenant, entitlement, Instagram account,
request or run was created by deployment or smoke validation.

## Capability matrix

| Capability | Implemented | Automated tested | Stripe Test validated | Stripe Live validated |
|---|---|---|---|---|
| Initial checkout | Yes | Yes | Yes | No |
| Reserved entitlement handoff | Yes after patch | Yes | Yes after smoke | No |
| Redirect to login | Yes | Yes | Ready for Liam / not physical yet | No |
| Live checkout | No | No | N/A | No |
| Server gate for 15 CT | Local patch | Yes (0/14 rejected, 15 accepted) | No | No |

## Next phase

The **Add Instagram account** targeting flow is implemented and automated-tested
in a clean local worktree. It has five server-resumable steps: Connection,
Public analysis, Targeting, Target accounts and Complete. The completion RPC
requires a minimum of 15 validated and eligible CTs; it does not impose a
maximum. Credentials use the existing server-side Vault path and no phone
assignment, Connect, Auto Login or worker run is started.

This work is not committed, migrated, deployed or physically validated yet.
Until those operations receive a separate GO, Liam must not use the production
Add Instagram account flow, `additional_account`, Connect or Auto Login.

## Profile Intelligence V1 — production checkpoint

The factual public-analysis patch is committed as
`cc73eb26ae99f0ca5d597d0660763742fabbdaf1` and deployed in production. One authorized SearchAPI
`instagram_profile` lookup observed `username`, `name`, `bio`, `avatar`,
`avatar_hd`, numeric `followers`, `following`, `posts`, and one recent caption.
No stable Instagram ID semantics, privacy, verification, business, category,
external link, bio links, contact or location field was present on that canary;
those values remain unknown unless a later response actually supplies them.

The patch adds per-field provenance, bounded caption minimization, conservative
deterministic FR/EN detection, a same-origin authenticated avatar proxy and an
idempotent same-session public reanalysis. Reanalysis performs one paid provider
lookup only after the explicit user action; normal rendering and avatar fallback
perform none. The measured schema-confirmation lookup took 1,166 ms, so explicit
reanalysis adds roughly one provider round trip to the UI latency.

Production deployment `dpl_AtT2a8EcjcDPS4fMww2DPbJ4EmZJ` is READY at
`https://boost-my-businesses-ai-frontend-vercel-624e51lgs.vercel.app` and the
canonical alias. No migration was added for V1.

## Profile Intelligence V2 — interim field-level checkpoint

V2 adds one explicit, server-only **Analyze with AI** action on the Analysis
step. The model is the stable snapshot `gpt-4o-mini-2024-07-18`; the active
localized prompt is Profile Intelligence V5 targeting-ready. The requested output language is resolved
separately from the detected profile language, constrained in the strict
Structured Output schema, and validated deterministically before persistence.
The request uses a strict Structured Output,
an 8-second timeout, one provider call maximum, no automatic retry, and a
minimized public snapshot capped at five 280-character captions. No CDN URL,
credential, internal UUID, tenant, entitlement, Stripe, device or private data
is sent.

Suggestions remain distinct from facts and require explicit client confirmation.
The AI contract has no geography property. Public location remains
`public_observed`; target geography is entered or confirmed by the client during
Targeting and is never converted from an AI suggestion.
After schema, language and recursive no-geography validation, quality is assessed
per field. `niche`, `probable_audience`, `themes` and `keywords` are essential;
`suggested_category`, `business_description` and `exclusions` are optional. The
global result requires valid niche and audience, at least three useful themes and
four useful keywords. Weak optional fields are selectively neutralized, empty
exclusions are valid, and rejected text is neither browser-projected nor logged.
Accepted suggestions, client-confirmed values, normalized field quality, global
targeting quality, prompt/model/timestamps and safe metrics are stored separately
in the existing `public_analysis.ai_analysis` JSONB object. Optimistic
compare-and-swap, a short lease, idempotency key and cooldown protect concurrency.
The action creates no account, CT, entitlement, ownership or credential and does
not call SearchAPI, SerpApi or Target AI.

Status before release: locally certified on baseline
`f5457a788a1ce549d038d7f205f3bfab4052452c`. The final isolated Responses smoke
returned HTTP 200, `targeting_quality_valid=true`, 5,399 ms total latency,
estimated cost $0.0003465 and `provider_fetch_count=1`, with zero business write.
No provider payload, response artifact or migration is included. Isolated canary
calls do not use the onboarding route. Target AI V2.2 and its Growth/Pro/Premium
gates remain unchanged. Production enrichment remains unvalidated until Liam
explicitly triggers a manual reanalysis after deployment.

This is an interim factual checkpoint only. The consolidated, exhaustive final
Frontend/Stripe handover remains deferred until Profile Intelligence, Target AI
V2.2, the 15-CT onboarding, the three agency-tenant accounts, plan changes and
cancellation, occupied-phone Auto Login, and final production validation are all
closed.

### Confirmed Profile Intelligence to Targeting projection — interim checkpoint

The Targeting draft now projects confirmed audience, niche, enriched business
description, themes and keywords without semantic aliases. Enriched
`business_description` precedes the public biography; keywords never fall back
to themes and niche never falls back to category. Language remains canonical
`fr`/`en` with localized labels, while geography is populated only from a
`user_confirmed` location.

An existing session already at `targeting` rehydrates from confirmed Profile
Intelligence values only when its stored targeting draft is empty. A non-empty
server draft and in-browser edits in the mounted session are preserved. No
automatic `save_targeting`, AI call, account, CT or entitlement creation is
introduced. Production acceptance remains a manual Liam check. This note is
interim evidence and is not the final Frontend/Stripe handover.

The deterministic cost harness uses the `gpt-4o-mini-2024-07-18` rates
($0.15/M input tokens and $0.60/M output tokens): 800 input + 200 output tokens
is about $0.00024. The server timeout is 8 seconds and no unbounded retry or
automatic model fallback exists.

Documentation handover updated: yes

Updated handover files:

- `docs/frontend-stripe-handover/01-current-state.md`
- `docs/frontend-stripe-handover/04-tenants-users-commercial-units.md`
- `docs/frontend-stripe-handover/05-checkout-and-webhooks.md`
- `docs/frontend-stripe-handover/09-test-evidence-matrix.md`
- `docs/frontend-stripe-handover/10-known-gaps.md`
- `docs/commercial-checkout.md`
- `docs/STRIPE_TEST_LIVE_MATRIX.md`

Canonical references:

- [Commercial checkout](../commercial-checkout.md)
- [Stripe Test / Live matrix](../STRIPE_TEST_LIVE_MATRIX.md)
- [Stripe per-entitlement billing](../stripe-per-entitlement-billing.md)
- [Stripe provisioning](../stripe-provisioning.md)
