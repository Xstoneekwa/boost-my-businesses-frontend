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

## Profile Intelligence V1 — local checkpoint

The factual public-analysis patch is validated locally on baseline
`7b7285bcf347dc7158356e049eef4172dadbda89`. One authorized SearchAPI
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

Status: local only. No commit, deployment, production migration, account
creation, analysis completion, password rewrite or second entitlement
consumption is part of this checkpoint. No AI suggestion is active.

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
