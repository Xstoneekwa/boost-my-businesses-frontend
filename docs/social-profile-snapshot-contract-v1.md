# Social profile snapshot contract V1

## Canonical source

`ig_account_social_profile_snapshots` is the only canonical read/write source
for public Followers, Followings and Posts observations. It already contains
the three counts, `observed_at`, provider/trigger provenance, lookup/freshness
state and a per-account idempotency key. The legacy
`ig_account_follower_snapshots` table is retained read-only for history and
rollback compatibility but is no longer read by Profiles Live or Stats.

No schema migration is required. Existing service-role RPCs, leases, unique
indexes and job/cost guards remain authoritative.

## Daily collection

Vercel calls `GET /api/cron/instagram-follower-snapshots` daily at `02:15 UTC`.
Authentication is the canonical `Authorization: Bearer <CRON_SECRET>` check and
runs before dry-run, classification, enqueue or provider work. Missing or wrong
credentials return 401. Internal provider/database messages are never returned.

Production collection is additionally gated by
`SOCIAL_PROFILE_SNAPSHOTS_ENABLED=true`; disabled deployments return a zero-work
`skipped_disabled` result. `dry_run=1` invokes only the guarded RPC
classification and reports zero writes and zero provider calls.

Eligible accounts are selected by active admin lifecycle, independently of
Worker scheduler status. Manual, paused/inactive-at-scheduler, no-recent-run and
active-with-run accounts are therefore collected equally when not archived.
The collector uses the existing backend public-profile provider only: it never
creates Worker requests/runs, opens Instagram or touches a phone.

Daily idempotency is `(account_id, trigger, local business date)`. The guarded
RPC suppresses fresh work, terminal not-found identities and duplicate jobs.
Processing claims at most 10 jobs/provider calls per invocation, releases
leases, retries only bounded retryable failures (maximum three attempts), and
continues after isolated failures. A rate limit stops the remaining batch and
requeues its claimed jobs with backoff.

## Freshness and 3-day delta

Profiles Live exposes:

- `value`, `baselineValue`, `currentValue`;
- `currentFollowers`, `currentFollowings`;
- `baselineCapturedAt`, `currentCapturedAt`, `capturedAt`;
- `ageSeconds`, `windowHours=72`, `windowCoverageHours`;
- `status`, `source`, `sourceProvider`.

Freshness is `fresh` at age <=36 h, `aging` above 36 h through 72 h, and
`stale` above 72 h. No current snapshot is `unavailable`. A current snapshot
without an acceptable baseline is `insufficient_data` regardless of age.

The metric is net follower change over approximately 72 hours, not today's
growth, gross acquisitions/losses, the last run result or Worker-attributed
growth. The baseline closest to `currentCapturedAt - 72 h` is accepted only
within a +/-24 h tolerance (coverage 48–96 h); its actual coverage is returned.
Outside that bound, the value is null and status is `insufficient_data`.
Negative and zero values are preserved.

Stats History uses the same table and exposes each Followers/Followings/Posts
value with its snapshot timestamp, provider and freshness status. Organic
growth remains valid for Manual accounts and is never described as Worker
output.

## Rollback and operations

Rollback consists of disabling `SOCIAL_PROFILE_SNAPSHOTS_ENABLED`, restoring
the immediately previous Backend deployment, and leaving all canonical/legacy
history untouched. Do not delete jobs or reset snapshots. Reverting the UI/API
projection does not require a database rollback because this checkpoint applies
no schema migration.

Before enabling: verify `CRON_SECRET` exists, the guarded enqueue/claim RPCs and
service-role grants are present, tests/build are green, and the new route is
registered. After deploy: verify unauthenticated and wrong-token 401 responses,
perform at most the read-only dry-run classification, and wait for the natural
cron for the first write/provider evidence.
