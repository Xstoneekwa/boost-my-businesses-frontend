# Target Availability V1 — Pre-deployment Consolidated Checkpoint

Status: `CHECKPOINT_AND_READINESS_ONLY`

Captured at: `2026-07-30T14:06:16Z`

This document is the official consolidated checkpoint after Gate 4B, Gate 4C and the local Identity / Assessment / Current / Replay construction. It records readiness only. It does not authorize a merge, migration, deployment, producer, Shadow, enforcement, restart, run, tick or phone action.

## 1. Executive Summary

Target Availability V1 has two distinct proven layers:

1. Production foundations and observation plumbing are deployed dormant. Gate 4B certified memory capture without DB writes. Gate 4C certified four scoped observation writes for one pilot, followed by a safe cleanup.
2. Identity Resolution, Availability Assessment, Availability Current and deterministic Replay are implemented and tested on the isolated Backend branch `f214f84b27dde5d32026010575231be3adaf25d1`, but are not integrated into the current Backend production baseline and are not deployed.

The additive migration `20260730123708_ct_target_availability_identity_assessment_current_v1.sql` is compatible with the production schema observed during this checkpoint: proposed column collisions `0`, proposed index collisions `0`, RLS already enabled and forced on the five Availability tables, client grants `0`, and service-role grants minimal. It remains local and unapplied.

`GLOBAL_DORMANT_DEPLOYMENT_READY=true`, conditionally on a separate deployment review that rebases or cherry-picks the isolated construction onto the current baseline, reruns the complete certification suite, backs up the schema, verifies the migration allowlist and receives a separate explicit GO. Dormant readiness is not deployment authorization.

`GLOBAL_SHADOW_READINESS=PARTIALLY_READY`. Global Shadow is blocked by the absence of a certified current-baseline integration, explicit per-run/account/day/global write caps, retention policy, multi-account and multi-worker load evidence, end-to-end projector failure isolation, operational metrics and alerting, and a multi-account capacity review.

No business action exists in Target Availability V1. Stable Instagram ID remains `OPTION_B`: available in principle from the public validation provider, absent from the Worker UI path, and never substituted by username similarity.

## 2. Scope

Included:

- consolidation of Gate 4B and Gate 4C evidence;
- review of local Identity, Assessment, Current and Replay construction;
- read-only production DB state and capacity measurements;
- full audit of the dormant additive migration and documentary rollback;
- comparison with current Backend, Worker, Auto Restart and Unfollow baselines;
- dormant-deployment and global-Shadow readiness decisions;
- risks, blockers and inputs for the final CT documentation block.

Excluded:

- production merge, migration or deployment;
- producer, capture, writer, Shadow, policy Shadow, Lifecycle or enforcement activation;
- CT mutation, replacement, notification or email;
- dispatcher restart, run, tick, ADB or phone action;
- modification or deletion of the four Gate 4C observations.

## 3. Production Baselines

### 3.1 Baseline ledger

| Surface | Construction baseline | Current checkpoint baseline | State |
|---|---|---|---|
| Backend | `47b6a6619368a558ffa607a3faa0d31da3d81ff4` | `d1de142892a13e4d24bb7fd1d7e2651f423a421b` | Production deployment `dpl_3Dih83u6YEvQg7RPgGFpUJRrrLRf`, READY, alias `www` |
| Worker | `6a5edff51346cc44fa84775fe7511bf455802163` | `cfaea18b2f6b6eaef18de7e5dac855f9bf292d0d` | Active release `/Users/admin/phonefarm-worker-releases/cfaea18-follow-60s-loriele-canary-v1` |
| Worker V3 intermediate | n/a | `f10e03efa244e9d21b2b9a589f6639002fc47a56` | Ancestor of current Worker; Search/Unfollow/Auto Restart delivery |
| Target Availability local | `47b6a66` | `f214f84b27dde5d32026010575231be3adaf25d1` | Isolated branch, pushed, not merged/deployed |
| Post-Gate 4C checkpoint | n/a | `acdbb26f9c8bd97aa144c1ac643e366e9395d5e6` | Official documentation input |
| DB | foundations through `20260728230641` | latest migration `20260729234627_unfollow_search_outcome_and_phase_circuit_v2` | Target Availability V3 migration not applied |

The active Worker changed after the Search/Unfollow V3 restitution. `cfaea18` is a descendant of `f10e03e` and adds a bounded Follow 60-second canary. It modifies `instagram_navigation.py` and `runner.py`, so the deployment review must use `cfaea18`, not the historical `6a5edff` or intermediate `f10e03e`, as its Worker integration baseline.

### 3.2 Production state to preserve

Read-only checks during this checkpoint confirmed:

- Target Availability capture `false`;
- writer `false`;
- allowlist empty;
- kill switch file present, therefore ON;
- Availability Shadow `false`;
- Policy Shadow `false`;
- Unfollow V2 Shadow `true` and enforce `false`;
- Backend production deployment remains READY.

Lifecycle enforcement and replacement remain OFF by the certified post-Gate 4C contract. This checkpoint did not change or re-arm any flag.

## 4. Architecture

```text
Worker / Instagram observations
              |
              v
Target Availability Observations
              |
              v
Identity Resolution
              |
              +--> Identity History
              +--> Identity Current
              |
              v
Availability Assessment
              |
              v
Availability Current
              |
              v
Future Target Lifecycle consumer
```

The layers are intentionally separate:

| Domain | Definition | Forbidden responsibility |
|---|---|---|
| Target Availability | Accessibility, identity and technical exploitability of a CT, with confidence and evidence freshness. | Performance scoring, exhaustion, replacement, notification or campaign mutation. |
| Target Performance | Yield and quality of a CT. | Identity or accessibility truth. |
| Target Utilization | Historical degree of CT exploitation. | Availability or replacement decisions. |
| Target Lifecycle | Future aggregation of Availability, Performance and Utilization. | Bypassing evidence or package policy. |
| Premium Replacement | Future commercial policy consuming Lifecycle. | Acting directly on raw Availability or affecting Growth/Pro automatically. |

The dependency is one-way. Target Availability V1 contains no action vocabulary, Lifecycle state, Premium policy, CT mutation, email or notification. Architecture tests enforce this boundary.

## 5. Gate 4B Evidence

| Evidence | Certified value |
|---|---|
| Pilot | `rex_gen_boost_ai` |
| Run | `59ddd9f3-2e98-4516-be36-2dc686810e54` |
| Source | Natural `auto_restart_tick` |
| Golden Flow | Completed; 50 follows, 42 likes, 2 CTs |
| Memory observations | 4 created, 4 valid |
| Tenant / account / target scope | Canonical and complete |
| Rejected / errors / invalid scope | `0 / 0 / 0` |
| Retained payload | `0` |
| Aggregate memory | 811 bytes |
| Hook latency | Mean ~3.24 ms; max 7.21 ms |
| Writer / Shadow | OFF / OFF |
| Availability DB rows created | 0 |
| Non-pilot captured | 0 |
| Cleanup restart | 0 |

Classification: `CERTIFIED_PRODUCTION — MEMORY_ONLY_NO_DB_WRITE`.

Gate 4B proves canonical tenant resolution, correct account and target scope, bounded serializable capture, zero retention and Golden Flow parity. It does not prove DB writing, semantic Availability classification or multi-account capacity.

## 6. Gate 4C Evidence

| Evidence | Certified value |
|---|---|
| Pilot | `j_automatise_pour_toi` |
| Tenant | `aefbca70-fc91-4be8-bc44-c7b8ad776272` |
| Account | `ba73eda4-d22a-4b93-9683-2af7b8aab764` |
| Request / run | `0294f589-fecd-491c-93d6-73782915fd68` / `9f7f6aba-04e0-4af5-9e96-9498f9abeb60` |
| Source | Natural `instagram_schedule_session_cron` |
| Golden Flow | Completed; 50 follows, 49 likes, 2 CTs |
| Observations | 4 valid rows |
| Duplicate / partial scope | `0 / 0` |
| Non-pilot / cross-tenant writes | `0 / 0` |
| Sensitive / unexpected keys | `0 / 0` |
| Evidence size | Maximum 677 bytes |
| DB latency | p50 361.8575 ms; p95 593.8087 ms; max 629.941 ms, sample n=4 |
| Other four Availability tables | 0 rows |
| Cleanup | capture OFF, writer OFF, allowlist empty, kill switch ON |
| Cleanup restart | 0 |

Classification: `CERTIFIED_PRODUCTION — ONE_PILOT_LIMITED_DB_WRITER_RESTORED_SAFE`.

The four observations remain the only Availability data in production and must not be deleted. Gate 4C proves limited writer safety and isolation. It does not prove Identity, Assessment or Current semantics, rare signals, multi-worker contention or global load.

## 7. Local Construction

Branch: `feat/target-availability-identity-assessment-current-v1-20260730`

Final SHA: `f214f84b27dde5d32026010575231be3adaf25d1`

Classification: `TESTED_LOCAL`, `NOT_DEPLOYED`.

Constructed components:

- pure Identity Resolution engine;
- pure, deterministic, versioned Availability Assessment engine;
- deterministic Availability Current projector;
- centralized confidence, repetition and TTL policies;
- deterministic replay harness and CLI;
- 30 rare-signal fixtures;
- additive migration and documentary rollback;
- local architecture and DB security contracts.

No Worker runtime hook, Backend route, cron, UI, BotApp feature or production flag was added by this construction phase.

## 8. Identity Resolution

The Identity engine is fail-closed and scope-bound to `tenant_id`, `account_id` and `target_id`.

Certified rules:

- username is an observation, never a stable ID;
- a stable-ID mismatch produces an identity conflict and never merges targets;
- a username change is confirmed only when the same reliable stable ID is present;
- repeated username change without stable ID remains suspected;
- ambiguous and partial scopes are rejected;
- history is append-only;
- current projection is idempotent and reconstructible;
- identical usernames in different tenants/accounts remain isolated.

Local states include `identity_confirmed`, `identity_probable`, `username_change_suspected`, `username_change_confirmed`, `identity_conflict`, `identity_ambiguous`, `stable_id_missing`, `stale_identity` and `insufficient_identity_evidence`.

## 9. Assessment Engine

The Assessment engine is pure: no React, UI, Supabase client, network, Lifecycle, Premium or business action imports.

Properties:

- deterministic canonical ordering and serialization;
- versioned engine/rules/policy contract;
- confidence restricted to `unknown`, `low`, `medium`, `high`;
- repetition counted across distinct runs;
- TTL and freshness centralized;
- contributing and ignored observation IDs traceable;
- temporary Instagram/network/UI errors never become permanent unavailability;
- verified badge alone never proves a verified restriction;
- badge plus restricted followers surface requires repeated fresh evidence from distinct runs;
- newer recovery evidence can supersede a prior negative signal;
- stale or conflicting evidence fails closed.

No status is a Lifecycle status. An Assessment result authorizes no mutation.

## 10. Availability Current

Availability Current is a deterministic projection, not a decision engine.

Certified properties:

- exact retries are idempotent;
- older events cannot regress current state;
- older engine/policy revisions cannot overwrite newer projections;
- concurrent candidate assessments converge to the same deterministic winner;
- cross-account or cross-tenant writes are rejected;
- full current state is reconstructible from append-only evidence and assessments;
- it contains no replacement, archive, rename, notification or campaign action.

## 11. Replay Harness

| Metric | Result |
|---|---:|
| Fixtures | 30 |
| Fixtures passed | 30 |
| Fixtures failed | 0 |
| Input observations | 1,043 |
| Accepted | 1,036 |
| Rejected cleanly | 6 |
| Deduplicated | 1 |

Replay certifies determinism, serialization, multi-tenant isolation, concurrency convergence, version upgrades, stale/out-of-order evidence and no retained raw UI/secret data. It is local proof, not terrain proof.

## 12. Database Contract

### 12.1 Current production foundation

| Table | Production rows | State |
|---|---:|---|
| `ct_target_availability_observations` | 4 | Certified limited writer evidence |
| `ct_target_identity_history` | 0 | Deployed dormant |
| `ct_target_identity_current` | 0 | Deployed dormant |
| `ct_target_availability_assessments` | 0 | Deployed dormant |
| `ct_target_availability_current` | 0 | Deployed dormant |

Production migrations:

- `20260728220631_ct_target_availability_foundations_v1`;
- `20260728230641_ct_target_availability_restrict_service_role_and_index_fks_v1`.

The current global DB migration head is `20260729234627_unfollow_search_outcome_and_phase_circuit_v2`.

### 12.2 Local additive migration audit

Migration: `20260730123708_ct_target_availability_identity_assessment_current_v1.sql`.

| Control | Verdict | Evidence |
|---|---|---|
| Additive-only | PASS | Adds 41 nullable/defaulted columns, 27 checks and 4 indexes to existing Availability tables. |
| Backfill / business data | PASS | No `UPDATE`, `INSERT`, `DELETE`, `TRUNCATE` or data copy. |
| Destructive DDL | PASS | No drop/rename/type rewrite in the forward migration. |
| Trigger / runtime activation | PASS | No trigger, cron, RPC, flag or caller. |
| FKs | PASS | Adds no FK and preserves the existing composite tenant/account/target FKs. |
| Constraints | PASS | Bounded enums, counts, evidence arrays, version strings and time ordering. |
| Indexes | PASS | Partial indexes for latest identity, stale identity, assessment validity and stale current. |
| RLS | PASS | Reasserts `ENABLE` and `FORCE` on all four altered tables. |
| Client grants | PASS | Revokes `public`, `anon`, `authenticated`; live client grants are currently 0. |
| Service role | PASS | Append-only tables `SELECT, INSERT`; current tables `SELECT, INSERT, UPDATE`. |
| Functions / `SECURITY DEFINER` / `search_path` | NOT APPLICABLE | Migration creates no function or RPC. |
| Production column collisions | PASS | 0 of 41 proposed columns exist. |
| Production index collisions | PASS | 0 of 4 proposed index names exist. |
| Migration ordering | PASS | Timestamp is strictly after current DB head; no concurrent post-head migration found. |
| Local static tests | PASS | 4/4. |
| Local PostgreSQL reconstruction | PASS | Previously certified full CT rebuild and security contract. |

Supabase documents grants and RLS as separate access-control layers and requires RLS on exposed `public` tables. This contract uses both minimal grants and forced RLS: <https://supabase.com/docs/guides/api/securing-your-api> and <https://supabase.com/docs/guides/database/postgres/row-level-security>.

The April 2026 Supabase default-exposure change does not weaken this contract: the migration explicitly revokes client grants rather than depending on project defaults.

### 12.3 Idempotence and rollback

The domain writes are idempotent through deterministic keys and current-state ordering. The DDL file itself is intentionally an exactly-once migration and is not safely re-runnable by hand because `ADD COLUMN` and `ADD CONSTRAINT` omit `IF NOT EXISTS`. Deployment review must enforce the exact migration allowlist and migration-ledger check; manual replay is forbidden.

The rollback is documentary and scoped to the 41 new columns and four indexes. It does not touch observations or legacy CT tables. Once producers write V3 fields, the rollback becomes data-destructive and must not be executed without backup, producer shutdown, explicit DB GO and acceptance of losing V3 projections. Before any producer activation, forward-fix is preferred over rollback unless the migration itself prevents operation.

## 13. Security and Tenancy

Live read-only verification at checkpoint:

- five Availability tables have RLS enabled and forced;
- `public`, `anon` and `authenticated` table grants: `0`;
- service role privileges exactly match append-only/current responsibilities;
- no proposed column or index collision;
- production contains no V3 columns from the local migration;
- four observations belong to one tenant/account and two targets;
- cross-tenant, non-pilot, partial-scope and sensitive writes in Gate 4C: `0`.

The local engines reject scope mismatch before aggregation. Same-username records across tenants/accounts never aggregate. Stable-ID conflict cannot reassign ownership or merge target IDs.

## 14. Stable ID Status

`STABLE_ID_SOURCE_STATUS=OPTION_B`.

Current finding:

- the public validation provider can return `instagram_user_id` / `external_profile_id` outside the Golden Flow;
- the Worker UI path does not expose a reliable numeric Instagram ID;
- username is never a substitute;
- missing stable ID produces a fail-closed identity state;
- automatic rename is forbidden without a stable-ID match.

Readiness decisions:

| Boundary | Stable ID required? | Decision |
|---|---|---|
| Dormant global deployment | No | No producer or decision runs; missing ID has no user effect. |
| Global Availability Shadow | No, but strongly recommended | Shadow may emit `stable_id_missing` and keep rename ambiguous; it must not act. |
| Lifecycle integration | Yes for any identity/rename-dependent state | Lifecycle must not consume a confirmed rename or identity merge without stable proof. Passive fail-closed computation may be built, but no identity-driven policy may progress. |
| Automatic rename | Yes, absolute | No exception and no username-similarity fallback. |

## 15. Concurrent Work Reconciliation

### 15.1 Backend since `47b6a66`

Current production `d1de142` changes only:

- `app/instagram-dashboard/auto-restart-data.ts`;
- `lib/instagram-dashboard/auto-restart-global-delay-contract.test.mjs`;
- `lib/instagram-dashboard/auto-restart-human-resume.test.ts`;
- `lib/instagram-dashboard/auto-restart-lineage-policy.test.ts`;
- `lib/instagram-dashboard/auto-restart-lineage-policy.ts`;
- `lib/instagram-dashboard/auto-restart-tick.ts`;
- `lib/instagram-dashboard/auto-restart-two-silent-retries.test.ts`.

Direct file overlap with the 21-file Target Availability local branch: `none`.

The Target Availability branch changes `lib/target-availability/**`, `package.json`, one Target Availability document and the local migration/rollback/DB tests. Git conflict risk is low. Semantic integration risk remains because the branch is based on `47b6a66`, not `d1de142`; deployment review must create a new successor branch from `d1de142`, apply the Target Availability commits in order, and rerun the full Backend/DB certification.

### 15.2 Worker since `6a5edff`

`f10e03e` changed Search/Unfollow surfaces including `instagram_navigation.py`, `runner.py`, `unfollow_*` modules and tests. Active `cfaea18` adds `follow_60s_canary.py` and changes `instagram_navigation.py`, `runner.py` and its tests.

No local Target Availability V1 construction file lives in the Worker repository. Nevertheless:

- `runner.py` is a shared Golden Flow and Target Availability parity surface;
- `tests/test_target_availability_disabled_parity.py` changed in the V3 lineage;
- `instagram_navigation.py` produces UI facts that future Availability observations may consume;
- current Worker is a descendant of the Gate 4C baseline, so deployment review must rerun the 71 targeted Availability tests and the current full Worker suite on `cfaea18` or its successor.

### 15.3 Migrations and semantic conflicts

- Current DB head: `20260729234627`.
- Local Target Availability migration: `20260730123708`.
- Concurrent Backend V3 created/applied no migration.
- Production column collisions: `0`.
- Production index collisions: `0`.
- Direct migration filename collision: `none`.
- Semantic collision with Unfollow V2: none at schema level; Unfollow remains legacy-authoritative, Shadow ON, enforce OFF.
- Semantic collision with Auto Restart: observation hooks may execute inside natural restarted runs, so load, deduplication and failure isolation must be certified together before global Shadow.

Fusion strategy: additive successor from current baselines, no replacement of current files, no blind branch merge, exact migration allowlist, full tests, dormant flags, then a separate deployment GO.

## 16. Global Dormant Deployment Readiness

`GLOBAL_DORMANT_DEPLOYMENT_READY=true`.

This means the construction is technically eligible for a separate deployment review under all of the following conditions:

1. reconcile onto Backend `d1de142` or its then-current successor;
2. reconcile Worker assumptions against `cfaea18` or its then-current successor;
3. rerun Backend, Worker, architecture, replay and DB reconstruction suites;
4. verify no newer production migration collides;
5. take a schema backup and prepare a forward-fix/rollback decision tree;
6. apply only the reviewed migration and deploy only the reviewed code;
7. keep capture, writer, Shadow, policy Shadow, enforcement, Lifecycle and replacement OFF;
8. keep the kill switch ON and the allowlist empty;
9. expose no new client route or grant;
10. perform no runtime restart solely for dormant code.

Dormant deployment is global by nature: code and columns may exist for every account because no producer is active. Artificial per-account deployment adds no safety while all gates remain OFF.

`GLOBAL_DORMANT_DEPLOYMENT_BLOCKERS=NONE_ARCHITECTURAL;SEPARATE_RECONCILIATION_REVIEW_BACKUP_ALLOWLIST_TEST_AND_EXPLICIT_GO_REQUIRED`.

## 17. Global Shadow Readiness

`GLOBAL_SHADOW_READINESS=PARTIALLY_READY`.

Ready components:

- deterministic, idempotent, multi-tenant local engines;
- out-of-order and version-regression protection;
- limited production writer proof;
- dynamic kill-switch file;
- bounded Worker queue/batch/timeout/retry/circuit-breaker contract;
- no action vocabulary or Lifecycle dependency;
- exact service-role-only DB boundary.

Blockers before global Shadow:

- integrate and test on current Backend and Worker baselines;
- explicit maximum observations per run, account, business day and globally;
- retention and purge policy for append-only observations/history/assessments;
- multi-account and multi-worker load test with contention and retry injection;
- monitoring for accepted/rejected/duplicate/partial/cross-tenant writes, queue depth, latency and circuit breaker;
- alerting and automatic shutdown thresholds;
- end-to-end failure isolation for Identity/Assessment/Current projectors;
- recovery/replay runbook after partial projector failure;
- live proof that current projection convergence matches local replay;
- enforce-OFF invariant checked on the integrated production artifact;
- capacity and latency review using more than four production writes;
- controlled soak before removing an allowlist.

Stable ID is not a blocker for observational Shadow if every ambiguous rename remains fail-closed. It is a blocker for identity-driven Lifecycle decisions.

## 18. Capacity Model

### 18.1 Measured data

Read-only production snapshot at `2026-07-30T14:06:16Z`:

| Measure | Value | Confidence |
|---|---:|---|
| Canonically active client-account links | 5 | Measured (`client_instagram_accounts.active=true`, account not archived/trashed) |
| Non-archived CT rows for those accounts | 106 | Measured; 15–31 per account |
| Runs in trailing 7 days | 54 | Measured |
| Average runs/day | 7.71 | Derived: 54 / 7 |
| CT traversals recorded by runs | 41 | Measured from `ig_runs.total_targets` |
| Average CT/run | 0.759 | Derived: 41 / 54; historical field may under-report partial runs |
| Gate observations/CT | 2 | Measured on Gate 4B and 4C: loaded + summary |
| Production Availability observations | 4 | Measured |
| Average physical observation row size | 1,008 bytes | Measured with `pg_column_size`, n=4 only |
| Gate 4C write latency | p50 362 ms / p95 594 ms | Measured, n=4 only |

### 18.2 Current-rate projection

If global capture reproduced the trailing seven-day run/CT rate and exactly two observations per traversed CT:

- observations: `41 CT / 7 days × 2 = 11.7/day`;
- raw observation row bytes: about `11.5 KiB/day`, `0.34 MiB/30 days`;
- identity-history append upper bound: `11.7/day`;
- assessments at one per CT/run: `5.9/day`;
- identity-current plus availability-current upserts: `11.7/day`;
- total observation/history/assessment/current write operations: about `41/day`.

This is a model, not a production forecast. It excludes JSON/index/TOAST overhead, retries, rechecks, rare-signal bursts and any under-count in `ig_runs.total_targets`.

### 18.3 Conservative five-account planning scenario

Assumptions, not measurements:

- 5 active accounts;
- 2 runs/account/day;
- up to 4 CT/run;
- 2 observations/CT;
- one history candidate per observation;
- one assessment and two current upserts per CT.

Result:

- 80 observations/day;
- up to 80 identity-history inserts/day;
- 40 assessment inserts/day;
- 80 current upserts/day;
- 280 write operations/day;
- about 78.8 KiB/day or 2.31 MiB/30 days of raw observation rows;
- applying a provisional 5× storage margin gives about 11.6 MiB/month for observation rows plus indexes/overhead, excluding other tables.

Unknowns requiring measurement before global Shadow:

- actual hooks emitted on retries/recovery;
- row sizes for identity history and assessments;
- index amplification and vacuum cost;
- concurrent run peaks rather than daily averages;
- recheck volume and TTL churn;
- retention horizon;
- writer latency distribution at multi-account load.

Index paths expected to carry the load: tenant/account/target time, source run, stable ID, recheck/valid-until and stale-after partial indexes. Current volumes are too small to validate their selectivity or cost.

`CAPACITY_MODEL_STATUS=MEASURED_BASELINE_PLUS_BOUNDED_SCENARIO;GLOBAL_LOAD_NOT_CERTIFIED`.

## 19. Failure Isolation

Required invariant:

```text
Availability failure
        |
        v
log / metric / rejection
        |
        v
Follow or Unfollow run continues
```

Current proof:

- Worker observation writer is bounded and fail-open for the Golden Flow;
- incomplete or unauthorized scope is fail-closed for Availability only;
- Gate 4B/4C completed their natural runs without Availability-induced regression;
- local Assessment and Current are pure and currently unwired, so they cannot affect production runs.

Remaining integration risk:

- a future synchronous call from `runner.py`, `account_session_orchestrator.py` or a navigation loop into Identity/Assessment/Current could block the Golden Flow through serialization, DB timeout, retry or projector exception;
- an unbounded replay inside a run could consume CPU/memory;
- a current-table upsert placed in the Worker critical path could inherit the ~594 ms pilot p95 and amplify it.

Required mitigation before Shadow:

- keep assessment/projectors outside the Instagram critical path;
- use a bounded queue or Backend worker with short timeout and no unbounded retries;
- catch and classify every domain/DB failure;
- reject Availability work without failing the account run;
- add injected DB timeout, serialization failure, stale version, duplicate and circuit-breaker tests;
- alert, then dynamically close the kill switch when caps/SLOs are exceeded.

`FAILURE_ISOLATION_STATUS=OBSERVATION_PATH_CERTIFIED;PROJECTOR_PATH_LOCAL_ONLY_AND_REQUIRES_INTEGRATION_PROOF`.

## 20. Tests and Certification

| Surface | Result | Classification |
|---|---:|---|
| Gate 4B memory capture | Certified natural run | `CERTIFIED_PRODUCTION` |
| Gate 4C limited writer | Certified natural run | `CERTIFIED_PRODUCTION` |
| Availability DB foundations | 5 tables, RLS/grants/FKs | `DEPLOYED_DORMANT` |
| Worker targeted baseline | 71/71 | `TESTED_LOCAL` + terrain gates |
| Worker full baseline | 2199/2199 | `TESTED_LOCAL` |
| Backend new tests | 32/32 | `TESTED_LOCAL` |
| Backend global | 2399/2466; 67 identical baseline failures | `TESTED_LOCAL_NO_NEW_REGRESSION` |
| Architecture | 7/7 | `TESTED_LOCAL` |
| Target domain rerun at checkpoint | 25/25 + 3/3 architecture | `TESTED_LOCAL` |
| DB static rerun at checkpoint | 4/4 | `TESTED_LOCAL` |
| DB PostgreSQL reconstruction | Full contract green | `TESTED_LOCAL` |
| Replay | 30/30, 1,043 inputs | `TESTED_LOCAL` |
| Idempotence/out-of-order/concurrency/multi-tenant | Green | `TESTED_LOCAL` |
| Current Worker `cfaea18` integrated with local V1 | Not performed | `NOT_OBSERVED` |
| Global multi-account Shadow | Not performed | `BLOCKED` |
| Rare terminal Instagram signals | Not observed in production | `NOT_OBSERVED` |
| Local V3 migration in production | Not applied | `NOT_DEPLOYED` |

Warnings about typeless TypeScript modules are test-runner warnings, not test failures. No test executed by this checkpoint wrote to production.

## 21. Risks and Blockers

| ID | Risk | Severity | Probability | Impact | Mitigation | Blocks dormant | Blocks global Shadow | Blocks Lifecycle |
|---|---|---|---|---|---|---|---|---|
| R1 | Stable ID absent from Worker UI | High | High | False rename/merge | Provider proof; fail closed; no username fallback | No | No, if observational | Yes for identity decisions |
| R2 | DB latency/failure in a synchronous path | High | Medium | Slow or failed Golden Flow | Out-of-band projector, timeout, fail-open | No | Yes | Yes |
| R3 | Concurrent projection race | High | Medium | Stale current state | Deterministic ordering, CAS, load test | No | Yes | Yes |
| R4 | Observation/history/assessment growth | High | Medium | Storage/vacuum cost | Caps, retention, partition review | No | Yes | Yes |
| R5 | Runtime env flags require restart while kill switch is dynamic | High | Medium | Slow shutdown if wrong control used | Kill-switch runbook and automatic closure | No | Yes | Yes |
| R6 | Monitoring and alerting absent | High | High | Silent drift or overload | Metrics, alerts, dashboard, SLOs | No | Yes | Yes |
| R7 | Multi-account/multi-worker load not observed | High | High | Queue/DB contention | Capacity test and progressive soak | No | Yes | Yes |
| R8 | Projector failure isolation not integrated | High | Certain | Future run regression | Non-critical-path adapter and fault injection | No | Yes | Yes |
| R9 | False Instagram UI/network signals | Medium | High | Wrong availability state | Repeat/TTL/conflict states and cross-run proof | No | No | Yes |
| R10 | Delayed/out-of-order/version-regressed events | Medium | Low | Current regression | Tested deterministic winner and version guard | No | No | Yes until live proof |
| R11 | Duplicate/retry bursts | Medium | Medium | Write amplification | Idempotency keys, caps, duplicate metrics | No | Yes | Yes |
| R12 | Auto Restart increases retries/run concurrency | Medium | Medium | Burst load and duplicate evidence | Joint Auto Restart soak and source-run keys | No | Yes | Yes |
| R13 | Unfollow V2 and shared `runner.py` evolution | Medium | Medium | Golden Flow divergence | Rebase on `cfaea18`, rerun parity/full suite | No | Yes | Yes |
| R14 | Target branch based on old Backend baseline | Medium | Certain | Blind merge drops current fixes | Additive successor from `d1de142` | Procedural | Yes | Yes |
| R15 | DDL migration is not manually re-entrant | Medium | Low | Second apply fails | Exact migration ledger/allowlist | No with standard runner | Yes if unresolved | Yes |
| R16 | Rollback drops V3 projection data | Medium | Medium | Evidence/projection loss | Backup; pre-producer rollback only; prefer forward-fix | No | Yes | Yes |
| R17 | Rare terminal signals not observed | Medium | High | Misclassification | Replay corpus then Shadow evidence | No | No | Yes |
| R18 | Pilot latency based on only four writes | Medium | High | Invalid capacity conclusion | Larger controlled soak and percentiles | No | Yes | Yes |
| R19 | Dormant indexes currently unused | Low | High | Small write/storage overhead | Keep until representative load review | No | No | No |

`RISKS_COUNT_BY_SEVERITY=CRITICAL:0,HIGH:8,MEDIUM:10,LOW:1`.

## 22. Deployment Review Requirements

The next authorized phase may only be a separate deployment review. It must:

1. resolve the then-current Backend, Worker and DB heads;
2. create a clean successor branch from the current Backend production SHA;
3. apply the eight Target Availability commits without blind merge;
4. review `package.json` and test-runner changes explicitly;
5. verify the local migration hash and exact allowlist;
6. compare every proposed column, constraint and index against production again;
7. verify RLS, grants, policies, FKs and append-only triggers after a local rebuild;
8. rerun Target domain, replay, architecture, Backend global and current Worker suites;
9. verify no public route, cron or producer is introduced;
10. define backup, restore and forward-fix procedures;
11. prove all production flags remain OFF and kill switch ON;
12. produce a deployment plan but perform no deployment without another explicit GO.

Sequence boundaries:

1. **Checkpoint consolidated** — this document.
2. **Deployment review** — reconciliation and execution plan only.
3. **Global dormant deployment** — migration/code present, all producers OFF.
4. **Multi-account capacity review** — load, concurrency, DB volume, latency, monitoring and kill switches.
5. **Global Shadow activation** — all active accounts, no business action.
6. **Lifecycle integration** — only after Shadow certification.

No step implies or authorizes the next.

## 23. Final CT Documentation Inputs

`TO_INCLUDE_IN_FINAL_CT_BLOCK_DOCUMENTATION`

The following 30 inputs must later be merged into the canonical CT block documentation:

1. strict definition of Target Availability;
2. separation from Performance, Utilization, Lifecycle and Premium Replacement;
3. unidirectional architecture diagram;
4. five-table DB contract and responsibilities;
5. exact production migration ledger;
6. local V3 migration and rollback status;
7. RLS/forced-RLS and exact grants;
8. composite tenant/account/target ownership boundaries;
9. append-only evidence contract;
10. deterministic idempotency keys;
11. Identity history/current rules;
12. stable-ID `OPTION_B` decision;
13. absolute prohibition on username-as-ID and automatic rename without proof;
14. Assessment statuses and confidence policy;
15. repeat and TTL policies;
16. Availability Current ordering/version rules;
17. replay harness and 30-fixture corpus;
18. Gate 4B evidence and cleanup;
19. Gate 4C evidence, four observations and cleanup;
20. Golden Flow failure-isolation contract;
21. dynamic kill switch versus restart-bound environment flags;
22. allowlist, caps and automatic shutdown requirements;
23. capacity model with measured/assumed/unknown separation;
24. retention, purge and reconstruction runbook;
25. metrics, alerting and SLO requirements;
26. Auto Restart and Unfollow interaction matrix;
27. current baseline reconciliation procedure;
28. dormant deployment and rollback procedure;
29. global Shadow capacity/soak gate;
30. Lifecycle/Premium handover and `NEXT_STEP_AUTHORIZED=false` rule.

`TO_INCLUDE_IN_FINAL_CT_BLOCK_DOCUMENTATION_COUNT=30`.

## 24. Final Verdict

`CHECKPOINT_STATUS=GO — TARGET AVAILABILITY V1 PRE-DEPLOYMENT CHECKPOINT COMPLETED`

`DOCUMENT_CLASSIFICATION=CHECKPOINT_AND_READINESS_ONLY`

`WORKER_BASELINE_CURRENT=cfaea18b2f6b6eaef18de7e5dac855f9bf292d0d`

`BACKEND_BASELINE_CURRENT=d1de142892a13e4d24bb7fd1d7e2651f423a421b`

`DB_BASELINE_CURRENT=20260729234627_unfollow_search_outcome_and_phase_circuit_v2`

`CONCURRENT_WORK_FOUND=BACKEND_AUTO_RESTART_V3;WORKER_UNFOLLOW_SEARCH_V3;WORKER_FOLLOW_60S_CANARY`

`OVERLAPPING_FILES=NO_DIRECT_BACKEND_OVERLAP;WORKER_SHARED_RUNTIME_RUNNER_PY;WORKER_TARGET_AVAILABILITY_DISABLED_PARITY_TEST`

`MIGRATION_COLLISIONS=NONE;PROPOSED_COLUMN_COLLISIONS:0;PROPOSED_INDEX_COLLISIONS:0`

`GLOBAL_DORMANT_DEPLOYMENT_READY=true`

`GLOBAL_DORMANT_DEPLOYMENT_BLOCKERS=NONE_ARCHITECTURAL;SEPARATE_RECONCILIATION_REVIEW_BACKUP_ALLOWLIST_TEST_AND_EXPLICIT_GO_REQUIRED`

`GLOBAL_SHADOW_READINESS=PARTIALLY_READY`

`GLOBAL_SHADOW_BLOCKERS=CURRENT_BASELINE_INTEGRATION;WRITE_CAPS;RETENTION;MULTIACCOUNT_LOAD;MULTIWORKER_CONTENTION;PROJECTOR_FAILURE_ISOLATION;METRICS;ALERTING;SOAK`

`STABLE_ID_REQUIRED_BEFORE_DORMANT=false`

`STABLE_ID_REQUIRED_BEFORE_SHADOW=false_FAIL_CLOSED_OBSERVATION_ONLY`

`STABLE_ID_REQUIRED_BEFORE_LIFECYCLE=true_FOR_IDENTITY_DEPENDENT_DECISIONS`

`FAILURE_ISOLATION_STATUS=OBSERVATION_PATH_CERTIFIED;PROJECTOR_PATH_LOCAL_ONLY_AND_REQUIRES_INTEGRATION_PROOF`

`MULTITENANT_STATUS=TESTED_LOCAL;LIMITED_PRODUCTION_SCOPE_CERTIFIED;GLOBAL_NOT_OBSERVED`

`IDEMPOTENCE_STATUS=TESTED_LOCAL;LIMITED_WRITER_CERTIFIED;DDL_EXACTLY_ONCE`

`CONCURRENCY_STATUS=TESTED_LOCAL;MULTIWORKER_PRODUCTION_NOT_OBSERVED`

`CAPACITY_MODEL_STATUS=MEASURED_BASELINE_PLUS_BOUNDED_SCENARIO;GLOBAL_LOAD_NOT_CERTIFIED`

`RISKS_COUNT_BY_SEVERITY=CRITICAL:0,HIGH:8,MEDIUM:10,LOW:1`

`DEPLOYMENT_REVIEW_READY=true`

`TO_INCLUDE_IN_FINAL_CT_BLOCK_DOCUMENTATION_COUNT=30`

`CODE_CHANGED=false`

`DB_CHANGED=false`

`RUNTIME_CHANGED=false`

`FLAGS_CHANGED=false`

`RESTART_COUNT=0`

`RUN_TRIGGERED=false`

`PHONE_ACTIONS=0`

`NEXT_PHASE_RECOMMENDATION=SEPARATE_TARGET_AVAILABILITY_V1_DEPLOYMENT_REVIEW_ONLY`

`NEXT_STEP_AUTHORIZED=false`
