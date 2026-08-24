# Commercial Account Capacity Projection V1

## Canonical contract

`client_instagram_accounts.active` remains the durable ownership and historical-visibility signal. Commercial occupancy is projected independently by `capacity_status`: `occupied` or the immutable terminal value `released_terminal`.

Capacity for a client is:

`unbound entitlement_reserved + active ownership links whose capacity_status = occupied`

An entitlement with an `account_id` is no longer reservation occupancy; its bound account is the sole occupancy owner. A terminally cancelled account retains its historical link but contributes zero occupied slots. Reusing capacity always creates a new Stripe subscription, entitlement and Instagram account chain; old commercial objects remain terminal.

## Terminal evidence and safety

Release requires all of: admin lifecycle `cancelled`, lifecycle state `cancelled`, matching completed `cancel` operation, terminal-cancelled entitlement, and matching terminal Stripe subscription projection. Missing or contradictory evidence remains `occupied`. Reload may repair the known `action_required/commercial_subscription_missing` drift only when that complete persisted terminal chain is proven.

The transition trigger makes `released_terminal` and its evidence immutable. The service-role-only RPC repeats all terminal checks under a row lock and atomically terminalizes an `in_progress` cancel operation before releasing capacity; therefore no committed release references a non-terminal operation. Replays with the same operation return `already_released_terminal`; they do not release twice.

## Backfill and rollback

The forward migration classifies only complete terminal chains. Rollback tombstones, unrelated inactive links and partial cancellations remain untouched. Before Approval 2, run the same predicate as a read-only dry run and record totals. The rollback intentionally refuses while any released row exists, because erasing a monotonic capacity decision would be unsafe; recovery must use a forward migration.

## Regression matrix

| Case | Expected |
|---|---|
| A active account | occupied |
| B paused account | occupied |
| C terminal cancel | link visible, released_terminal |
| D repeated cancel | no double release |
| E partial/ambiguous cancel | occupied, fail closed |
| F rollback tombstone | not classified |
| G terminal cancel without active subscription | remains cancelled |
| H genuinely incomplete relationship | action_required preserved |
| I unbound reserved entitlement | one unit |
| J same entitlement bound | reservation zero + account one |
| K bound account cancelled | unit becomes zero |
| L replacement chain | new entitlement/account becomes one |
| M concurrent reservation/cancel | DB lock/constraints; capacity gate must serialize |
| N 1000+ rows | partial `(client_id, capacity_status)` index supports query |
| O historical visibility | `active` unchanged |

Stripe Tax and checkout tax behavior are outside this change and remain unchanged.

## Approval 2 rollout

Approval 2 must separately authorize production migration application and deployment. Required gates: exact production ancestry, read-only backfill counts, real PostgreSQL forward/behavior/rollback validation, targeted and build tests, then post-apply schema/RLS/grants/count certification. This Approval 1 does not authorize any production mutation.
