# Target accounts lifecycle and canonical Instagram onboarding

Status: implemented and deployed candidate; final product validation remains pending until a real third agency account completes the flow. Do not treat this document as final acceptance evidence yet.

## One canonical client path

Every client entry point uses the same path for a standard or agency tenant, for the first or any later account, and for an existing or newly purchased entitlement:

`Add Instagram account` → plan choice when needed → checkout activation → reserved entitlement → `/instagram-client?onboarding=1` → credentials → public analysis → optional account protection lists → targeting criteria → target accounts → server gate of 15 eligible targets → onboarding complete.

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

The dedicated optional step reads and writes `account_protection_list_entries` through the versioned canonical API:

- `unfollow_whitelist`: never automatically unfollow; other interactions remain allowed unless also blacklisted;
- `interaction_blacklist`: blocks automated Follow, Like, Comment, Welcome DM, Outreach DM and Story Watch, but not Unfollow.

Both lists are normalized, deduplicated, ownership-checked, isolated by `account_id`, protected by ETag/If-Match and idempotency keys, and resumable after refresh. Saving or skipping records explicit empty canonical versions before targeting can continue. They remain editable later from the Client three-column targeting screen, Admin Settings → Sources, and BotApp Settings → Sources. Changes to an active campaign apply to the next Worker session because the current run keeps its immutable start snapshot.

## Target accounts and readiness gate

Targets use the existing account-scoped `ig_targets` APIs for single, bulk, assisted search, archive and validation. The completion RPC recounts rows in PostgreSQL and accepts only rows for the new `account_id` that are:

- `status` equal to `valid` or `active`;
- `quality_status = eligible`;
- `verification_status = found`;
- neither archived nor deleted.

Zero or fourteen qualifying rows cannot complete onboarding. Fifteen qualifying rows complete it and set the client account onboarding status to `configured`. Fifteen submitted but rejected or pending rows do not satisfy the gate. Completion records `runtime_activation_requested: false`; it does not start Auto Login, a campaign, a run, a Worker, or a device action.

## Post-onboarding login and readiness boundary

After the 15-target gate, assignment and Auto Login remain separate explicit
steps. The canonical chain and incident-assisted recovery are documented in
[`client-connect-challenge.md`](./client-connect-challenge.md). A login can be
`connected` while the account is not yet `ready`; Client, Admin and BotApp must
all consume the same Backend readiness projection.

Identity is proven either by the Worker exact own-profile guard or by an
authenticated operator through **Confirm login & refresh readiness** after a
physical review of the assigned app instance. Historical pre-proof accounts
are handled only by the bounded compatibility contract described in
[`client-tenant-onboarding-e2e.md`](./client-tenant-onboarding-e2e.md); no future
account inherits that exception.

## Ownership, isolation and recovery

Every route requires the client session and revalidates tenant ownership. Onboarding RPCs are `service_role` only, onboarding session rows have RLS enabled, and browser roles have no direct execute privilege. A different tenant or unauthenticated caller is rejected.

Active sessions are resumable after refresh. Expired or failed sessions expose an explicit restart path. Concurrent starts, restarts, credential submissions and completions are serialized by database locks and idempotency constraints. Failures after Vault creation roll back the account, ownership links and entitlement consumption together.

## Error contract

Client responses expose stable, non-secret errors such as `session_required`, `entitlement_required`, `email_invalid`, `target_minimum_not_met`, and `instagram_onboarding_required`. Raw secrets, Vault identifiers, device assignments and internal provider payloads are not projected to the client.

## Verification and rollback

Automated verification covers routing, old-flow exclusion, authentication, entitlement idempotency, transaction rollback, tenant/account isolation, protection-list persistence, target qualification and the 15-target gate. The production build must include `/api/instagram-client/onboarding` and `/api/instagram-client/onboarding/avatar`.

Rollback must be coordinated across web, BotApp, Worker and the later onboarding/snapshot migration. Do not re-enable the legacy Client filters endpoint as a fallback. The canonical foundation down migration refuses to remove non-empty data. A rollback never starts a run or touches a phone.

## Pending final acceptance

The implementation must not be marked fully validated until a separate GO authorizes a real third agency account test through credentials, protection lists, CT validation and readiness. The current smoke is intentionally limited to displaying the credentials screen, with zero account creation and zero entitlement consumption.

## Logical rollback isolation

`rollback_test_instagram_onboarding_v1` archives only non-terminal targets of
the exact rolled-back account and removes only its pending/processing/retry CT
verification jobs. Successful/failed/skipped verification rows and all
`ct_target_audit_events` remain historical evidence. Canonical protection-list
entries for that account are disabled, list versions advance once, and one
redacted `clear` event is appended per affected list kind. Other account IDs are
never selected by the cleanup statements.

Because the next onboarding creates a new account UUID, neither legacy filter
columns nor canonical protection-list rows can be inherited automatically.
