# SOCIAL_PROFILE_SNAPSHOTS_V1

Intermediate rollout documentation only; this is not the final Frontend/Stripe handover.

Production status on 2026-07-22: both migrations and the ACL correction are applied, backend deployment `dpl_5nf1Snafg1FEE9vZzCvznhSV4KW3` is READY, and the 14 reliable legacy follower observations are imported. `SOCIAL_PROFILE_SNAPSHOTS_ENABLED` remains absent, so the collection pipeline is functionally disabled.

## Read-only cron resume (2026-07-22)

- Vercel scheduler invocation observed at `2026-07-22T10:17:16.243Z` on `/api/cron/instagram-follower-snapshots`: `GET`, HTTP `200`, deployment `dpl_5nf1Snafg1FEE9vZzCvznhSV4KW3`.
- With the flag absent, the deployed route returns `skipped_disabled` with `providerCalls=0`, `jobsCreated=0`, and `jobsProcessed=0` before database or provider work.
- Post-invocation database state: 14 snapshots total, all 14 legacy, 0 modern snapshots, and 0 jobs. Legacy Following and Posts remain `NULL`.
- Dynamic read-only inventory found 6 active accounts: 3 `snapshot_stale` because they only have legacy Followers, and 3 `no_snapshot`.
- Maximum baseline budget: 6 lookups, USD 0.024 at USD 4 per 1,000 successful searches. No lookup was consumed during this resume.
- Baseline collection remains blocked: the only deployed call to `processSocialProfileSnapshotJobs` is after the global flag gate in the cron route. Enabling that flag before baseline, Stats, dashboards, and BotApp validation would violate the approved rollout order. No job was enqueued and no provider call was made.

## Verified current state (2026-07-22)

- Production has 6 active `ig_accounts`; all are selected by the current daily collector.
- 3 accounts have historical follower rows and 3 have none.
- `ig_account_follower_snapshots` contains 14 real rows for 3 accounts, from 2026-06-19 through 2026-07-21.
- The last observable collector run selected 6 accounts, succeeded for 2 and failed for 4 (`provider_invalid_response`, `not_found`, two throttles).
- The legacy table stores followers only. Followings and posts have no persistent historical source.
- The Stats route asks for `ig_account_settings.timezone`, but that production column does not exist.
- The deployed legacy cron is `/api/cron/instagram-follower-snapshots` at `30 0 * * *`; the candidate changes it to an hourly queue scan at minute 17.

Current account coverage:

| Username | Client linked | Existing follower snapshots | Latest |
|---|---:|---:|---|
| `i_m_your_traker` | yes | 6 | 2026-07-18 00:30:47 UTC |
| `j_automatise_pour_toi` | yes | 1 | 2026-07-21 20:55:42 UTC |
| `mythyl_fitness` | yes | 7 | 2026-07-21 20:55:39 UTC |
| `p3_2_admin_recovery_test` | no | 0 | — |
| `p3_2_botapp_recovery_test` | no | 0 | — |
| `p3_internal_recovery_test` | no | 0 | — |

## Canonical pipeline

```text
existing public lookup
  -> reuse immediately during onboarding or explicit reanalysis
  -> otherwise an hourly DB-only scan enqueues at most one account/day job
       session_end if a completed run exists that local day
       daily_fallback otherwise
  -> atomic claim (FOR UPDATE SKIP LOCKED, lease, max 3 attempts)
  -> one SearchAPI lookup, rate-limited and cached by the existing adapter
  -> append-only ig_account_social_profile_snapshots
  -> authenticated Stats API / server-rendered Client Dashboard
  -> existing BotApp relay
  -> Stats drawer (persisted values only)
```

The drawer and Client Dashboard never invoke the provider. Manual admin refresh only enqueues a job and has a six-hour cooldown. Rate limiting stops the current batch after the first provider 429 and retries later with bounded backoff.

## Data contract and time

- Counts are nullable non-negative integers. `0` is valid and is never mapped to missing.
- A row is rejected if all three counts are missing.
- `observed_at` is UTC `timestamptz`.
- `snapshot_local_date` is computed once and persisted with `account_timezone`.
- Timezone order in the contract: non-UTC assigned phone timezone, schedule timezone when a future account-scoped source exists, then `Africa/Johannesburg` platform fallback.
- Production schema audit on 2026-07-22 found no account-, schedule-, or tenant-scoped timezone column joinable by `account_id`. The only current account-resolvable source is `phone_devices.timezone` through `account_assignments`; unassigned accounts therefore use the explicit platform fallback. `phone_rest_windows.timezone` is device-rest configuration, not an account schedule source, and is not reused here.
- Successful daily fallback has a partial unique index per account/local date.
- General idempotency is `(account_id, idempotency_key)`.
- Snapshot UPDATE and DELETE are rejected; job rows remain mutable operational state.

Session matching order:

1. exact `source_run_id` or `source_business_session_id`;
2. successful same-account and same-local-date snapshot within 18 hours;
3. no match (`—`), with no reuse of an old current value.

## Trigger policy

- Onboarding lookup: reuse the result already paid for after the account ID exists.
- Explicit reanalysis: reuse that explicit result; no second call.
- Session end: the daily scheduler detects the latest completed/stopped run and enqueues a run-linked job.
- Daily fallback: only from 23:00 account-local time when no completed run exists for that local day.
- Manual admin refresh: queue only, six-hour cooldown.
- Future accounts: every active `ig_accounts` row is discovered automatically; client ownership is not required for collection.

## Provider budget

The hard application cap is 10 successful attempts per cron batch. At most one scheduled observation is enqueued per active account/local day; onboarding and reanalysis reuse their existing lookup.

For the 6 current accounts:

- theoretical baseline: 6 searches/day;
- approximately 180 searches per 30-day month;
- no additional scheduled search relative to the already deployed one-search/account/day collector;
- at the public Developer rate of USD 4 per 1,000 successful searches, 180 successes represent USD 0.72 of plan value per month (the plan itself is USD 40/month for 10,000 searches; failed requests are not billed).

The scheduler must not be enabled above the purchased allowance without an explicit budget decision. Pricing source: https://www.searchapi.io/pricing

## Compatibility and surfaces

- Existing reliable follower rows remain readable as a legacy fallback and are not copied or fabricated.
- New social snapshots take precedence for matching dates.
- Client Dashboard shows current followers/followings/posts and a persisted history; its existing follower chart merges real legacy follower history with new rows.
- Admin/BotApp Stats API exposes all three metrics, timestamps, sources and freshness states.
- BotApp relay remains a transparent authenticated projection. The Stats drawer displays `—`/Pending when no persisted value exists.
- Follow/Unfollow action counters remain separate and are never used to derive public profile totals.

## Migration and rollout order

1. Applied `20260722120000_social_profile_snapshots_v1.sql` and the complementary legacy/ACL migration.
2. Verified RLS and exact effective grants for `public`, `anon`, `authenticated`, and `service_role`.
3. Deployed the backend with queue processing disabled by the absent feature flag.
4. Certified one scheduler-owned inert cron invocation and completed the global read-only inventory and budget.
5. Resolve the one-shot baseline processing gate without enabling the recurring collector early.
6. Run the bounded baseline, then validate Stats and dashboards.
7. Deploy BotApp UI projection only after the real Followers + Followings Stats gate passes.
8. Enable the recurring collector last and observe one bounded invocation.

Rollback: disable the cron first, roll back application readers to the legacy follower projection, keep append-only rows intact, and do not drop data during the operational rollback.

## Known gaps before production approval

- Both migrations are applied remotely and the effective ACL matrix is certified.
- No production provider call or real current-value snapshot has been triggered; the current state remains 14 legacy snapshots and 0 jobs.
- Baseline processing has no approved execution path while the global feature flag must remain disabled; this is the active rollout blocker.
- Production environment allowance/remaining SearchAPI credits were not queried; only public plan pricing and the application call budget are documented.
- Visual captures are local fixtures only and cannot prove live provider freshness.
