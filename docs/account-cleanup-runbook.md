# Account cleanup runbook — Test Instagram onboarding rollback v1

## Scope

Use `rollback_test_instagram_onboarding_v1` only for an exact Test checkout and
only with an operator-approved account, tenant, entitlement, checkout, username,
package, reason, request ID, and idempotency key. The RPC defaults to dry-run and
is service-role only. Never expose it to a browser or BotApp renderer.

## Mandatory sequence

1. Verify the deployed frontend/backend, Worker, and BotApp baselines.
2. Prove zero active request, run, lock, Auto Login, live view, processing job,
   and device heartbeat occupancy.
3. Snapshot the two unrelated tenant accounts and the exact assignment/instance.
4. Call the RPC with `p_dry_run=true`; retain only redacted counts and IDs.
5. Prove zero mutation by comparing the scoped state fingerprint and audit count.
6. Deploy active-projection filtering when the tombstone state is new.
7. Re-run guards, then call once with `p_dry_run=false` and the same fingerprint.
8. Read every affected table, verify the unrelated account snapshot, and replay
   the same idempotency key to obtain `already_rolled_back`.
9. Do not click **Ajouter un compte Instagram**; hand control back to the client.

## Atomic mutation and retention

- `ig_accounts`: never deleted; internal username tombstone, lifecycle cancelled.
- credentials/Vault: canonical `revoke_instagram_account_credentials` only;
  partial Vault failure aborts and rolls back the transaction.
- assignment/instance: canonical `release_account_schedule_capacity`; exact
  occupant and idle device are checked before release.
- entitlement: returned to reserved without changing package, checkout, term, or
  pricing history.
- active tenant/subscription projections: marked inactive/removed.
- account settings/filters: deleted so the new UUID starts clean.
- targets: archived; non-historical verification jobs removed; CT events kept.
- protection lists: entries disabled; versions/events retained and advanced.
- incident: retained and resolved with the approved reason.
- runs, requests, action logs, runtime events, completed onboarding session,
  checkout, and commercial events: retained.

The append-only `test_instagram_onboarding_rollbacks` row stores hashes, IDs,
redacted counts, before/after status, actor, request, reason, and result. It never
stores a password, secret reference value, token, credential content, or target
list.

## Down and compensation

DDL rollback, before any successful data execution: revoke/drop the RPC, then
drop the rollback audit table and the three added ownership projection columns.

After a successful data rollback, never run an automatic down migration. Data
compensation requires a separate GO and manual review of the append-only audit,
because Vault neutralization and username reuse are intentionally not reversed.
The safe forward path is a new canonical onboarding with a new account UUID.
