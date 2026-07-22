# SOCIAL_PROFILE_SNAPSHOTS_V1

Intermediate rollout documentation only; this is not the final Frontend/Stripe handover.

Production status on 2026-07-22 before the cost-guard rollout: the snapshot, legacy/ACL, and baseline migrations are applied. Production contains 16 snapshots (14 legacy and 2 modern) and 6 baseline jobs. Three jobs are terminal `not_found`, one retryable job is queued after `provider_invalid_response`, and two jobs succeeded. `SOCIAL_PROFILE_SNAPSHOTS_ENABLED` and `SOCIAL_PROFILE_SNAPSHOTS_BASELINE_ENABLED` remain absent, so automatic collection and baseline execution are disabled.

The one-shot baseline processor described below was deployed and used for one controlled batch. Its flag was then removed again. The cost guard described next is an intermediate checkpoint, not the final Frontend/Stripe handover.

## Enqueue cost guard candidate

`SOCIAL_PROFILE_SNAPSHOT_ENQUEUE_COST_GUARD_V1` adds one canonical server-only decision before every recurring, baseline, or admin-refresh job insertion:

1. a successful non-legacy snapshot for the current normalized username within 36 hours returns `skipped_fresh`;
2. an existing `queued` or `processing` job for the same account and username returns `existing_job_pending` or `retryable_backoff`;
3. a later suppressible terminal result for the current username returns `terminal_suppressed`;
4. a changed username is treated as a new public identity;
5. an authenticated admin refresh may bypass freshness and terminal history, but not an active job or the six-hour cooldown;
6. otherwise the RPC inserts one job and returns `enqueued`.

The database serializes enqueue decisions per account and normalized username, then enforces a partial unique index over `queued` and `processing`. This protects concurrency across recurring, baseline, and manual triggers while leaving historical terminal jobs intact. The RPC is denied to `public`, `anon`, and `authenticated`; only `service_role` receives execute permission.

The authenticated cron dry-run remains available while the recurring flag is disabled. It performs classification only and reports new-job provider budget separately from an already queued retry. It performs no provider call and no job or snapshot write.

Retryable provider results retain the same job with linear 15-minute backoff and a maximum of three claims. A third transient failure becomes `failed` with a `retry_exhausted:` error code, which suppresses immediate automatic daily recollection. No account ID or username is embedded in the guard.

## Controlled one-shot baseline candidate

The candidate endpoint is server-only:

`POST /api/instagram-dashboard/internal/social-profile-snapshots/baseline`

It requires the existing Instagram admin session and tenant authorization before reading the baseline flag or database. It does not accept the BotApp relay key and has no client UI entry point. The independent `SOCIAL_PROFILE_SNAPSHOTS_BASELINE_ENABLED=true` flag is required; it neither reads nor activates the recurring `SOCIAL_PROFILE_SNAPSHOTS_ENABLED` flag.

Dry run request:

```json
{ "mode": "dry_run", "max_accounts": 10 }
```

Dry run dynamically classifies every account as current, stale, missing, invalid, lifecycle-excluded, or ambiguous. It returns the eligible count, maximum calls, and maximum estimated cost, with zero job write and zero provider call.

Execution additionally requires exact operator gates:

```json
{
  "mode": "execute",
  "max_accounts": 6,
  "expected_account_count": 6,
  "max_provider_calls": 6,
  "idempotency_key": "operator-supplied-unique-value",
  "confirmation": "RUN_BASELINE"
}
```

- The dynamic eligible count must exactly match `expected_account_count`.
- Both account and provider-call limits are hard-capped at 10.
- An account with a non-legacy snapshot less than 36 hours old is skipped.
- Invalid usernames, inactive lifecycles, and multiple active assignments are excluded.
- The operator key is SHA-256 hashed before persistence; only the hash identifies the batch.
- Job idempotency is stable per account, local date, and `baseline_one_shot`, independently of the operator key.
- A second inventory check occurs after job insertion. Newly ineligible jobs are discarded before claim.
- The dedicated SQL claim function selects only `baseline_one_shot` jobs from the exact hashed batch. It cannot drain the recurring or historical queue.
- Atomic `FOR UPDATE SKIP LOCKED` claiming, the unique daily baseline index, and the stable job key bound concurrent attempts.
- The normal append-only persistence contract is reused. Missing Following or Posts remain `NULL`; no old snapshot is updated or fabricated.
- Logs contain only a batch-hash prefix and aggregate counts. Provider payloads, usernames, credentials, and the raw idempotency key are excluded.

Candidate rollback is code/config only: keep the separate baseline flag absent or false, remove the route in a later application rollback if needed, and retain append-only observations and operational jobs. The candidate does not enable the recurring scheduler.

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

The hard application cap is 10 successful attempts per cron batch. The cost guard must reduce the current production new-job budget to zero: two fresh accounts skipped, three terminal identities suppressed, and the existing retry reported separately at zero or one call depending on its backoff. At most one scheduled observation is enqueued per eligible account/local day; onboarding and reanalysis reuse their existing lookup.

The following figures describe the pre-guard theoretical ceiling for the 6 current accounts, not the post-guard expected spend:

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
5. Review and deploy the separately gated one-shot baseline processor without enabling the recurring collector early.
6. Run the bounded baseline, then validate Stats and dashboards.
7. Deploy BotApp UI projection only after the real Followers + Followings Stats gate passes.
8. Enable the recurring collector last and observe one bounded invocation.

Rollback: disable the cron first, roll back application readers to the legacy follower projection, keep append-only rows intact, and do not drop data during the operational rollback.

## Known gaps before production approval

- Both migrations are applied remotely and the effective ACL matrix is certified.
- No production provider call or real current-value snapshot has been triggered; the current state remains 14 legacy snapshots and 0 jobs.
- A separately gated baseline processor is implemented locally but is not yet deployed, migrated, enabled, or exercised against the provider; production therefore still has no approved execution path.
- Production environment allowance/remaining SearchAPI credits were not queried; only public plan pricing and the application call budget are documented.
- Visual captures are local fixtures only and cannot prove live provider freshness.
- The BotApp Overview can report relay/dispatcher disconnected while Profiles and Stats still read correctly from the Shared backend API. This is tracked separately and is not part of the enqueue cost guard.
- The tenant-scoped Client Dashboard for the second modern account still needs a read-only UI recertification when its own authorized client session is available. Authentication must not be bypassed.
