# CT Target Availability — Phase 8B.1 foundations

> V2-1 update: the dormant observation runtime, fail-open observation writer, universal local shadows and unconnected Backend assessment writer are implemented on the dedicated branches. Production remains unactivated. See `ct-system-roadmap-v2.md`.

## Status and safety boundary

Phase 8B.1 created the dormant database contract. V2-1 adds a feature-gated Worker import and unconnected adapters; with all flags OFF, no capture, thread, network call or write occurs.

There is no decision, replacement, archive, rename, notification, email, campaign mutation, cron or deployment in this phase.

## Additive database contract

Migration: `20260728220631_ct_target_availability_foundations_v1.sql`.

It creates five service-role-only relations:

| Relation | Ownership | Mutation contract |
|---|---|---|
| `ct_target_availability_observations` | redacted Worker/provider evidence | append-only |
| `ct_target_identity_history` | identity/username observations | append-only |
| `ct_target_identity_current` | current identity projection | controlled upsert later |
| `ct_target_availability_assessments` | pure model results | append-only |
| `ct_target_availability_current` | current assessment pointer | controlled upsert later |

The migration does not alter `ig_targets`. This prevents a stable platform ID from leaking through existing `select *` projections and preserves all current target behavior.

Every table has RLS enabled and forced. `PUBLIC`, `anon` and `authenticated` have no table privilege. Only `service_role` receives the minimum table operations. Append-only triggers reuse the certified Phase 8B guard. Composite tenant/account and account/target foreign keys preserve isolation. Foreign keys and recheck/quarantine query paths are indexed.

No RPC is introduced. A future ingestion RPC must be a separate reviewed change if direct table inserts are not retained.

## Worker observation contract

The Worker worktree adds `target_availability_observation.py`, but no production module imports it. The module:

- accepts an explicit tenant/account/target/username scope;
- normalizes usernames;
- accepts a stable platform ID only when already available;
- records lookup, profile, badge, Followers surface, terminal end, repetition, retries, timeout, recovery, UI/network/session ambiguity and versions;
- creates a deterministic SHA-256 idempotency key scoped by tenant, account, target, run and event key;
- returns a short JSON-serializable immutable value;
- performs no I/O and contains no decision verb.

It cannot archive, replace, rename, notify, email, activate, navigate, log or write to Supabase.

## Observation vocabulary

The Worker contract exposes observations only:

- `target_username_lookup_started`
- `target_profile_found` / `target_profile_not_found`
- `target_stable_identity_observed`
- `target_verified_status_detected`
- `target_followers_surface_normal`
- `target_followers_entry_failed`
- `target_followers_surface_restricted`
- `target_followers_surface_terminally_limited`
- `target_repeated_first_profiles_detected`
- `target_navigation_retry_budget_exhausted`
- `target_navigation_timeout`
- `target_recovery_succeeded` / `target_recovery_failed`
- `target_ui_ambiguity`
- `target_network_ambiguity`

Lifecycle reasons and client actions remain outside the Worker.

## Future budgets

These defaults are domain proposals only; they are not connected to `config.py`:

| Budget | Default | Hard model bound |
|---|---:|---:|
| username lookup | 2.5 s | 0.25–10 s |
| Followers entry | 4 s | 0.5–15 s |
| retry count | 1 | 0–2 |
| navigation | 8 s | lookup ≤ navigation ≤ 30 s |
| total Availability | 10 s | navigation ≤ availability ≤ 45 s |

The future runtime rule is: classify the local failure, emit one observation, skip to the next CT, and schedule asynchronous recheck. A CT-local failure must never terminate the complete run. Implementing this rule requires the dedicated Worker phase; Phase 8B.1 does not alter control flow.

## Stable Instagram identity

The current production CT rows have no stored stable platform ID. The Worker UI paths do not expose a reliable numeric Instagram identity today. The existing public-profile provider can return `instagram_user_id` / `external_profile_id` at validation time, at network cost and outside the Golden Flow.

Recommended acquisition order:

1. provider verification at CT add/revalidation;
2. reuse of a previously certified stable ID;
3. opportunistic Worker observation only if a future hybrid detector exposes a reliable ID;
4. never infer identity from username similarity.

Timing: initial validation, periodic asynchronous revalidation, and post-failure recheck. Never before every run. A rename requires the stable ID already certified before the username divergence and the same ID on the new username. Otherwise the state remains unresolved/conflict and requires an operator.

## Verified targets

`verified_badge` and `followers_surface` are separate fields. Badge alone leaves Availability `available` when the surface is normal. `verified_restricted` requires:

- a verified badge observation;
- a restricted/terminally limited Followers surface;
- two distinct healthy cross-run observations for medium confidence, or one strong terminal observation for high confidence;
- no network/session ambiguity.

This phase neither changes the existing Backend hygiene nor invokes it. The known legacy `rejected_verified` archive behavior remains outside this dormant contract and must be reconciled before activation.

## Local Shadow

`availability-shadow.ts` accepts only the versioned pure Worker payload, enforces tenant/account/target/username scope, deduplicates by idempotency key, rejects conflicting duplicates and converts observations into `TargetAvailabilityAssessment`.

The report is frozen, serializable, explicitly `mode=local_shadow` and `mutationExecuted=false`. It imports no Supabase client and is not used by a route, cron or component.

## Local validation

- two independent full PostgreSQL reconstructions passed;
- structural hash identical: `be9acd376a02f7d7e52abd0239da7f49`;
- legacy CT SQL/security contracts remained green;
- Availability table/RLS/grant/idempotency/append-only/non-mutation contract passed;
- generated DB types include all five new relations;
- Worker observation contract: 11/11 targeted tests and 2,063/2,063 full Worker tests passed under Python 3.9;
- Backend: 25/25 lifecycle, 3/3 architecture, 15/15 Premium Shadow and 43/43 CT Premium tests passed;
- targeted TypeScript strict check and ESLint passed;
- migration SHA-256: `742c8753057109c22cdc349a942baac2318690d29ba40c90e79cfd41489134db`.

Supabase CLI `db lint` could not load `pgsql_check` in the plain temporary PostgreSQL cluster. This is an environment limitation, not a hidden green result; direct SQL contract validation remains authoritative for this phase.

## Phase 8B.2 ACL and foreign-key forward-fix

The original migration stated the narrow grants after table creation, but the
hosted project's `postgres` default privileges had already granted
`service_role` all table privileges. A `GRANT` is additive, so the effective
ACL remained `arwdDxtm`. The compensating migration
`20260728230641_ct_target_availability_restrict_service_role_and_index_fks_v1.sql`
first revokes all `service_role` table privileges on the five Availability
relations, then restores only the documented contract:

| Relation class | SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER |
|---|---:|---:|---:|---:|---:|---:|---:|
| observations, identity history, assessments | yes | yes | no | no | no | no | no |
| identity current, availability current | yes | yes | yes | no | no | no | no |

The migration does not change policies or global/default privileges. RLS stays
enabled and forced, client roles remain unprivileged, and the five existing
`service_role` policies remain the only policies on these tables. Table ACL is
the operative least-privilege boundary because hosted `service_role` bypasses
RLS.

The Supabase performance advisor reported fourteen uncovered foreign keys. The
forward-fix adds eleven indexes: on four tables, one composite
`(account_id, target_id)` index covers both the single-column `account_id` FK
and the composite account/target FK through the PostgreSQL left-prefix rule.
Separate `target_id`, `observation_id`, and `last_history_id` indexes cover the
remaining relationships. No original index is removed; the existing partial
run/stable-ID and domain query-path indexes remain intact.

The dedicated forward-fix contract verifies exact table and column ACLs,
PUBLIC/anon/authenticated denial, real `service_role` reads/inserts/current
updates, denial of historical updates/deletes and all truncation/reference/
trigger operations, RLS/policies, all fourteen FK prefixes, absence of
duplicate indexes, and rollback of every synthetic fixture.

## Phase 8B.2 deployment gate

The package can be proposed for a separate controlled dormant deployment only after:

1. migration SQL review and checksum freeze;
2. production preflight/backup and exact allowlist;
3. confirmation that the Phase 8B append-only trigger exists;
4. transaction-scoped apply of this single migration;
5. catalog/RLS/grant/index checks;
6. verification that all five tables are empty;
7. confirmation that no application or Worker adapter is deployed.

Phase 8B.2 must not deploy Worker code, connect observation writers, enable a flag or start Phase 8C.
