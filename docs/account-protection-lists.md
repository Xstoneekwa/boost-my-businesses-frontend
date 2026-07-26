# Account protection lists v1

## Canonical semantics

`interaction_blacklist` blocks automated Follow, Like, Comment, Welcome DM, Outreach DM, Story Watch, and future automated interactions for a normalized Instagram username. It never blocks Unfollow. `unfollow_whitelist` blocks automatic Unfollow only; other interactions remain allowed unless the username is also in `interaction_blacklist`. The canonical source is `public.account_protection_list_entries`, scoped by `account_id` and `list_kind`.

The legacy fields `ig_account_filters.blacklist_accounts`, `ig_account_filters.whitelist_words`, and `ig_interacted_users.whitelist_protected` are no longer active sources. The old Client filters endpoint returns HTTP 410, the generic Admin filters API neither exposes nor overwrites the two retired values, and the Worker ignores `ig_interacted_users.whitelist_protected`.

### Legacy inventory and explicit Rex exclusion

The read-only production inventory found exactly one account with non-empty retired protection fields: inactive `@rex_gen_boost_ai` (`df707a97-bfb1-4286-bf09-25090a7b3207`). Its retired whitelist contained `bricosympa.official` and `vincentfavrephotographe`; its retired blacklist contained `eric_fankh`, `unefemmeautiste`, `andy.deleu`, `fhore_pilates`, and `bonheurdechine`. No other account had non-empty legacy protection values, and the canonical tables were empty at inventory time.

Rex is explicitly excluded from import because it is inactive and scheduled for separate cleanup. Nothing in this release deletes or rewrites those seven historical values. They remain preserved only for cleanup evidence; all canonical Rex lists start empty. New and active accounts use canonical lists only. Cleanup must remain a separate authorized task.

## Schema and versioning

- `account_protection_list_entries` stores one normalized username per account/list pair. Removal is logical (`active=false`) so a later add can be audited as a reactivation.
- `account_protection_list_versions` stores the monotone representation version for each account/list pair. A missing row represents version `0`.
- `account_protection_list_events` stores one append-only, metadata-minimal event per accepted mutation request.

Account/list/active and recent-account queries are indexed, as are all account and nullable auth-user foreign keys used by audit or cascade paths.

The transactional `mutate_account_protection_list` RPC locks the version row, checks `If-Match`, calculates the desired representation, updates rows, increments the version only when the active representation changes, and writes the audit event in the same transaction. Retries with the same idempotency key and request fingerprint produce no duplicate side effects. Reusing a key for a different request returns `idempotency_conflict`.

The ETag format is `"apl:{accountId}:{listKind}:v{version}"`. PUT, PATCH, and DELETE require this exact ETag in `If-Match` and require `Idempotency-Key`. A stale version returns HTTP `409 version_conflict`; a missing precondition returns HTTP 428.

## Security and lifecycle

RLS is enabled on all three tables. `public`, `anon`, and `authenticated` have no direct table privileges. Explicit policies permit only `service_role`; audit events grant only SELECT and INSERT, never UPDATE, DELETE, or TRUNCATE. The public RPC is `SECURITY INVOKER`, has EXECUTE revoked from `public`, `anon`, and `authenticated`, and is granted only to `service_role`.

Client routes first require an active client session and the canonical `client_can_manage_instagram_account` ownership check. Admin routes require the canonical Instagram admin permission. Both surfaces call the same service. Active and paused accounts allow reads and writes. Archived, trashed, cancelled, canceled, or deleted accounts remain readable but mutations return HTTP 409.

## API

Client:

- `GET|PUT|PATCH /api/instagram-client/accounts/{accountId}/protection-lists/{listKind}`
- `DELETE /api/instagram-client/accounts/{accountId}/protection-lists/{listKind}/{username}`

Admin uses the same suffix below `/api/instagram-dashboard/accounts/`.

BotApp uses the same service through relay-authenticated routes below `/api/instagram-dashboard/botapp/accounts/`; the renderer has no Supabase key or local list source of truth.

GET returns `{ items, size, version, updatedAt, status }`, where status is `loaded_empty` or `loaded_with_items`, and includes ETag plus `Cache-Control: private, no-store`. PUT accepts `{ items: [] }`. PATCH accepts `{ add: [], remove: [] }`. DELETE normalizes the path username and is logically idempotent.

Normalization trims whitespace, removes leading `@`, lowercases, rejects empty values and URLs, validates the Instagram username shape, and deduplicates. Invalid input is never silently discarded. HTTP 422 returns `entryErrors` with `invalid_username`, `instagram_url_not_allowed`, `duplicate_input`, or `empty_username`.

## Audit privacy

An event contains the operation, counts, changed flag, request fingerprint, source surface, actor, request/idempotency identifiers, and previous/new versions. It never stores a complete list, credentials, secrets, or a raw request body. Single-entry add/remove/delete events may include the normalized username; multi-entry events leave it null.

## Product surfaces and runtime

- Client targeting keeps the existing three-column layout and maps “Liste blanche” to `unfollow_whitelist` and “Liste noire” to `interaction_blacklist`. Add, multi-add, remove, search, counts, no-store refresh, ETag conflict reload, and active-campaign editing use the canonical API.
- Client onboarding is credentials → analysis → optional protection lists → targeting criteria → 15 eligible target accounts → completion. Saving an empty list still creates its version marker, making the optional step resumable and explicit.
- Admin Settings → Sources shows the same two account-scoped lists below Target accounts / Sources.
- BotApp Settings → Sources shows the same two lists in English through the secure relay.
- The Worker dispatcher calls `get_account_protection_lists_for_run` exactly once for an account or outreach session before device access. It serializes the immutable snapshot into the subprocess environment. Active runs never refresh it; a new/resumed request reloads it.
- If the snapshot is unavailable, malformed, or account-mismatched, the dispatcher blocks before device access. No per-candidate or per-action database query exists.

No real run, login, ADB, phone, Stripe, cap, or Rex cleanup action is part of deployment verification.

## Rollback

Routes can be disabled immediately with `ACCOUNT_PROTECTION_LISTS_V1_ENABLED=false` or by reverting the web release. Worker rollback is an atomic symlink switch to the previous release plus one dispatcher restart; BotApp rollback restores its pre-release app bundle. The foundation down script is `supabase/rollback/20260726041500_account_protection_lists_v1.down.sql`; it refuses to drop non-empty canonical data. Before schema rollback, remove the later onboarding/snapshot RPC migration through its release rollback procedure. No rollback deletes the retired Rex values.
