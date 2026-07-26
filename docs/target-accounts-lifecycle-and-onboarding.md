# Target accounts lifecycle and canonical Instagram onboarding

Status: implemented and deployed candidate; final product validation remains pending until a real third agency account completes the flow. Do not treat this document as final acceptance evidence yet.

## One canonical client path

Every client entry point uses the same path for a standard or agency tenant, for the first or any later account, and for an existing or newly purchased entitlement:

`Add Instagram account` → plan choice when needed → checkout activation → reserved entitlement → `/instagram-client?onboarding=1` → credentials → public analysis → account protection and targeting → target accounts → server gate of 15 eligible targets → onboarding complete.

The client `POST /api/instagram-client/accounts` endpoint is deliberately closed with `instagram_onboarding_required`. It cannot create an account or reopen the historical direct-create modal. Admin account-creation tooling is separate and unchanged.

## Commercial handoff and entitlement

- Simulated add-account activation returns `/instagram-client?onboarding=1`.
- Stripe Test binds an additional-account checkout to the authenticated client user and tenant on the server. Its fulfillment status returns the same canonical onboarding destination.
- A future Live checkout must preserve this same server-side handoff contract; the browser does not choose an entitlement or tenant identifier.
- The onboarding begin operation re-resolves the latest reserved entitlement for the authenticated tenant and verifies package compatibility.
- The entitlement is consumed exactly once inside the same PostgreSQL transaction that creates and links the account and stores the credential secret. A failed transaction leaves it reserved.

## Credentials and account creation

The credential step accepts a normalized Instagram username, a write-only password, and an optional validated login email. The password is sent only to the authenticated onboarding endpoint, written to the canonical Vault credential service, omitted from the onboarding session, and never returned in the API projection.

The `begin_client_instagram_onboarding` RPC atomically creates the account, default settings and filters, Vault secret reference, tenant ownership link, package/subscription link, audit record, and entitlement consumption. Its idempotency key and database locks prevent double-click or retry duplication. A browser refresh reloads the server-owned onboarding session; React state is not the source of truth.

## Account-scoped protection lists

The Protection & targeting screen reads and writes the existing `ig_account_filters` row through `/api/instagram-client/accounts/{accountId}/filters`:

- whitelist: Instagram usernames protected from unfollow;
- blacklist: Instagram usernames excluded from interaction.

Both lists are optional, normalized, deduplicated, ownership-checked, and isolated by `account_id`. They remain editable later from the account targeting UI. The onboarding UI saves them before advancing the targeting session. This change does not alter Worker behavior or claim new runtime-enforcement evidence.

## Target accounts and readiness gate

Targets use the existing account-scoped `ig_targets` APIs for single, bulk, assisted search, archive and validation. The completion RPC recounts rows in PostgreSQL and accepts only rows for the new `account_id` that are:

- `status` equal to `valid` or `active`;
- `quality_status = eligible`;
- `verification_status = found`;
- neither archived nor deleted.

Zero or fourteen qualifying rows cannot complete onboarding. Fifteen qualifying rows complete it and set the client account onboarding status to `configured`. Fifteen submitted but rejected or pending rows do not satisfy the gate. Completion records `runtime_activation_requested: false`; it does not start Auto Login, a campaign, a run, a Worker, or a device action.

## Ownership, isolation and recovery

Every route requires the client session and revalidates tenant ownership. Onboarding RPCs are `service_role` only, onboarding session rows have RLS enabled, and browser roles have no direct execute privilege. A different tenant or unauthenticated caller is rejected.

Active sessions are resumable after refresh. Expired or failed sessions expose an explicit restart path. Concurrent starts, restarts, credential submissions and completions are serialized by database locks and idempotency constraints. Failures after Vault creation roll back the account, ownership links and entitlement consumption together.

## Error contract

Client responses expose stable, non-secret errors such as `session_required`, `entitlement_required`, `email_invalid`, `target_minimum_not_met`, and `instagram_onboarding_required`. Raw secrets, Vault identifiers, device assignments and internal provider payloads are not projected to the client.

## Verification and rollback

Automated verification covers routing, old-flow exclusion, authentication, entitlement idempotency, transaction rollback, tenant/account isolation, protection-list persistence, target qualification and the 15-target gate. The production build must include `/api/instagram-client/onboarding` and `/api/instagram-client/onboarding/avatar`.

Rollback is application-only because this delivery creates no new database schema. Reverting the delivery commit restores the previous frontend/backend behavior, but doing so would also restore the deprecated client path and therefore requires an explicit product decision. The two checked-in migrations document schema already present in production; they are not newly applied by this delivery.

## Pending final acceptance

The implementation must not be marked fully validated until a separate GO authorizes a real third agency account test through credentials, protection lists, CT validation and readiness. The current smoke is intentionally limited to displaying the credentials screen, with zero account creation and zero entitlement consumption.
