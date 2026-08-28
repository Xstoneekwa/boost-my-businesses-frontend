# Profiles / Live / Stats canonical snapshot contract

## Separate causes and ownership

BotApp's empty projection was caused by accepting invalid/empty Live success and replacing membership with an incomplete response. Backend's follower-stat divergence was independently caused by a placeholder `pending_account_follower_snapshots` projection backed by mutable `ig_accounts.followers_count`, while Stats already used `ig_account_social_profile_snapshots`.

`readCanonicalSocialSnapshots` is now shared by full Profiles, Live through full Profiles, and the BotApp Stats consumer (`[accountId]/stats-history`). It reads only canonical successful snapshots, requested account IDs and the bounded observation period ending at request time. Stable ordering, exact count, pagination, unique keys and a 40-page cap prevent silently publishing a truncated result. Query errors or incomplete data never fall back to mutable counters. Full Profiles reports snapshot unavailability without erasing account membership; Stats preserves its existing error response policy.

`canonicalSocialSnapshotProjection` provides the existing 72-hour follower delta and local-date Stats projection. Zero stays zero; missing proof stays null. No historical snapshot, action receipt, quota, lifecycle, timezone policy or counter is rewritten. Profiles reads a 30-day window; Stats retains its requested history window. Comparisons must use the same cutoff/window; a shorter requested Stats history is not missing canonical evidence.

Live may emit `profiles_membership_v1` only after `getManageData({ requireCanonicalComplete: true })` succeeds, the errors list is empty, and the complete lifecycle ledger agrees exactly with its operational active list. Removed IDs require an actual canonical row explicitly excluded by existing lifecycle policy; a missing ID alone is never removal proof, even when the entire ledger is empty. Thus a physically deleted record without a retained lifecycle tombstone remains conservatively visible until explicit proof is supplied. IDs are limited to requested known client IDs and bound to the request projection revision. An incomplete/contradictory ledger never gains removal authority. Client tombstones prevent stale resurrection. This envelope changes no account lifecycle state.

## Credentials/readiness: test reconciliation only

The old fixture expected `credentials_reauth_required` after stored credentials, lacked current package/settings/filter/physical-phone prerequisites and implicitly authorized enqueue via the default mode. Current product behavior distinguishes saved-but-unverified credentials from freshly proven Instagram identity.

The replacement fixture verifies passive readiness before/after `confirmValidCredentials`, zero passive enqueue, unchanged `login_status=unknown`, and a separate explicit `connect_enqueue` authorization on an in-memory mock. Confirming credentials does not prove Instagram connected. Existing negative readiness/identity tests remain required. No credentials/readiness product code changed and no real preflight request was created.

## Qualification and rollout boundary

Required: shared-source tests; actual full Profiles/Live/Stats handler replay; cross-account and future-date isolation; capped pagination; missing-count/error/count-drift rejection; authoritative removal versus incomplete inventory; current credentials/readiness gates; no canonical action/counter writes. Final certification binds this exact Backend commit with the A2 + Profiles guard BotApp ASAR and the frozen Worker manifest. Production deployment receipt is a future requirement, not supplied by these mocked tests.

No production deployment, migration, backfill, run, tick, login or device interaction in this phase.
