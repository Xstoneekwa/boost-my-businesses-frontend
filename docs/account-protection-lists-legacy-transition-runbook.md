# Account protection lists legacy transition runbook

## Inventory evidence

Read-only production inventory on 2026-07-26 found one non-empty legacy account:

- account: inactive `@rex_gen_boost_ai`
- account id: `df707a97-bfb1-4286-bf09-25090a7b3207`
- legacy `whitelist_words`: `bricosympa.official`, `vincentfavrephotographe`
- legacy `blacklist_accounts`: `eric_fankh`, `unefemmeautiste`, `andy.deleu`, `fhore_pilates`, `bonheurdechine`
- canonical entries at inventory: zero

No other account had non-empty `ig_account_filters.whitelist_words` or `ig_account_filters.blacklist_accounts`.

## Decision

Do not backfill Rex. It is inactive and scheduled for a separate cleanup task. Preserve the retired fields unchanged until that cleanup receives its own GO. New and active accounts use `account_protection_list_entries` only. The legacy Client endpoint is retired and no runtime reads `ig_interacted_users.whitelist_protected`.

This is an explicit exclusion, not silent data loss: the seven values above are the traceable historical inventory. Canonical Rex lists intentionally remain empty.

## Later Rex cleanup

The cleanup task must independently re-check lifecycle state, active runs/requests/locks, ownership and retention requirements. It must not infer authorization from this release. If the account is deleted, canonical rows cascade with the account; legacy evidence disposal follows the cleanup retention decision.

## Rollback rule

Never restore legacy fields as a fallback. If canonical APIs or the worker snapshot are unavailable, block writes/runs safely and repair the canonical path.
