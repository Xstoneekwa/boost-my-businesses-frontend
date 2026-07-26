# Account protection lists v1

## Canonical semantics

`interaction_blacklist` prevents interaction workflows from targeting a normalized Instagram username. `unfollow_whitelist` protects a normalized Instagram username from unfollow selection. The canonical source is `public.account_protection_list_entries`, scoped by `account_id` and `list_kind`.

The legacy fields `ig_account_filters.blacklist_accounts`, `ig_account_filters.whitelist_words`, and `ig_interacted_users.whitelist_protected` are not read, copied, merged, changed, or deleted by this migration. In particular, no Rex value is backfilled: both new canonical Rex lists start empty.

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

GET returns `{ items, size, version, updatedAt, status }`, where status is `loaded_empty` or `loaded_with_items`, and includes ETag plus `Cache-Control: private, no-store`. PUT accepts `{ items: [] }`. PATCH accepts `{ add: [], remove: [] }`. DELETE normalizes the path username and is logically idempotent.

Normalization trims whitespace, removes leading `@`, lowercases, rejects empty values and URLs, validates the Instagram username shape, and deduplicates. Invalid input is never silently discarded. HTTP 422 returns `entryErrors` with `invalid_username`, `instagram_url_not_allowed`, `duplicate_input`, or `empty_username`.

## Audit privacy

An event contains the operation, counts, changed flag, request fingerprint, source surface, actor, request/idempotency identifiers, and previous/new versions. It never stores a complete list, credentials, secrets, or a raw request body. Single-entry add/remove/delete events may include the normalized username; multi-entry events leave it null.

## Rollout roadmap

This release supplies only DB, backend service, Client API, Admin API, tests, and documentation. Client UI, Admin UI, BotApp integration, and once-per-run Worker loading remain future work and must consume these APIs/canonical tables. This release does not change Auto Login, runs, phones, ADB, Worker code, or legacy values.

## Rollback

Routes can be disabled immediately with `ACCOUNT_PROTECTION_LISTS_V1_ENABLED=false` or by reverting the backend commit. The explicit down script is `supabase/rollback/20260726041500_account_protection_lists_v1.down.sql`. It refuses to drop anything if canonical entries, version rows, or audit events exist. When all three are empty, it drops only the canonical RPC and three new tables. It has no effect on `ig_account_filters`, `ig_interacted_users`, Worker code, or legacy data.
