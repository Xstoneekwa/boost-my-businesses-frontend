# CT Resume 003500 production deployment checkpoint

Date: 2026-07-31  
Project: `zgafnshkjywfltxgbtzg` (`boost-my-businesses-ai`, PostgreSQL 17.6.1)  
Source migration: `20260731003500_target_followers_resume_commit_provenance_v4.sql`  
Supabase registry version: `20260731151702`  
Production outcome: deployed exactly once and certified  
Next step authorization: false

## Scope and boundaries

This window applied only the canonical CT Resume V4 provenance migration. It did
not apply the Follow 60 migration `20260731131850`, the Target Lifecycle
migration `20260731133000`, or any other pending migration. It did not deploy
Backend or Worker code, switch a Worker release, restart the dispatcher, change
flags, trigger a run or tick, or touch a phone.

## Production baselines

- Backend production: `b14d4f9b7775f591e04ec7f8978cb50834588b87`.
- Worker active: `703c6aa8817a1154843727b5acee536e28a8764d`.
- Worker release: `/Users/admin/phonefarm-worker-releases/703c6aa-jautomatise-follow60-rpc-perf-v2`.
- Runtime processes at the gate: wrapper PID 36019, consumer PID 36048, no
  `runner.py` process.
- Previous production DB head: `20260730221713_ct_target_availability_global_shadow_runtime_v1`.
- Target Availability remained Global Shadow with capture, writer, identity,
  assessment, current projector and shadow enabled; enforcement, policy shadow,
  Lifecycle, replacement, notifications and archiving remained disabled.

## Follow 60 restitution and conflict origin

The Follow 60 source work completed before the DB window:

- Worker candidate `fd79ee71d3d297c33ac80de5bc10e17023ce2216`, parent
  `703c6aa8817a1154843727b5acee536e28a8764d`, pushed and clean.
- Backend candidate `27ae70806dfc10524631fd4278a035b63cca6f51`, parent
  `b14d4f9b7775f591e04ec7f8978cb50834588b87`, pushed and clean.
- Follow 60 migration `20260731131850_follow_60s_midcanary_stage_barrier_v1.sql`
  remained unapplied.
- No Follow 60 deploy, release, restart, run, tick or phone action occurred.

The earlier requirement that 003500 remain absent was a temporary coordination
gate. It prevented a broad migration command from replaying pending migrations
while Follow 60 was still under construction. It was not referenced by the
Follow 60 runtime or migration, and was not a permanent product requirement.

The compatibility test proves the domains are disjoint:

- 003500 does not create, alter or mutate Follow 60 canary controls or
  interaction-event objects.
- 131850 does not create, alter or mutate CT Resume checkpoints, checkpoint
  events or the V4 commit RPC.
- Shared `account_run_requests` and `ig_runs` rows are read-only lineage inputs
  for V4; 003500 does not update or delete them.
- Canonical order is 003500, then 131850, then 133000.

## Auto Restart tests

The two reported failures were not assertions about migration 003500. Both were
static tests that still expected `validateActiveModePrerequisites` to be called
directly from the settings route after validation had been moved into the
canonical settings helper.

### Test 1

- File: `tests/auto-restart-foundation.test.mjs`.
- Test: `settings route probes foundation`.
- Previous expectation: direct route reference to
  `validateActiveModePrerequisites`.
- Actual runtime contract: route calls `validateAutoRestartPatch`; the helper
  calls `validateActiveModePrerequisites` and checks
  `INSTAGRAM_AUTO_RESTART_TICK_TOKEN`.
- Change: assert the full route-to-helper chain and token prerequisite.
- Security invariant: preserved and made more precise.

### Test 2

- File: `tests/auto-restart-scheduled-eligibility.test.mjs`.
- Test: `settings route persists schedule-based settings without pilot field`.
- Previous expectation: direct route reference to
  `validateActiveModePrerequisites`.
- Actual runtime contract and change: identical canonical route-to-helper chain
  proof, while retaining the no-pilot-field assertions.
- Security invariant: preserved and made more precise.

The two corrected files pass 15/15. The broader Auto Restart run passes 113/114;
the sole remaining failure is the pre-existing Node alias harness for
`@/app` in `auto-restart-two-silent-retries.test.ts`, unrelated to this patch or
003500.

## Pre-deployment tests

- CT Resume static migration contract: 10/10.
- CT Resume + Follow 60 compatibility: 4/4.
- Combined CT/Follow/Auto Restart/Follow counters: 37/37.
- Auto Restart broad suite: 113/114 with the one pre-existing alias-harness
  failure documented above.
- CT Resume Worker targeted tests on the certified CT source: 197/197.
- Follow 60 Worker full suite before its final atomic micro-fix: 2302/2302.
- Follow 60 Worker targeted suite after that micro-fix: 91/91.
- Follow 60 Backend targeted tests: 8/8; Next production build green.
- Follow 60 Backend global suite: 222/224; only the same two pre-existing static
  Auto Restart expectations, both corrected in this closure branch.
- Local PostgreSQL 17 transaction scenario: passed, including lineage,
  provenance, CAS, lease, monotonic depth, grants and atomic event rollback.
- Local rollback: V4 count 1 to 0; checkpoint default remained 3.
- Local reapply: V4 count 0 to 1; default 3; PUBLIC, anon and authenticated
  execute false; service_role execute true.

## Safe production window

JIT gate at `2026-07-31T15:15:56.865285Z`:

- active requests: 0;
- active runs: 0;
- live device locks: 0;
- live tick locks: 0;
- concurrent DDL sessions: 0;
- queue: stable/empty;
- dispatcher: one wrapper and one consumer, no runner.

## Database before and after

| Measure | Before | After |
| --- | ---: | ---: |
| Registered migration | absent | `20260731151702` exactly once |
| V4 RPC count | 0 | 1 |
| Checkpoint default | 2 | 3 |
| Checkpoint rows | 32 | 32 |
| Checkpoint rows at V3 | 32 | 32 |
| Non-V3 checkpoint rows | 0 | 0 |
| Checkpoint event rows | 102 | 102 |
| Backfilled rows | n/a | 0 |
| Indexes on the two stores | 9 | 9 |
| Constraints on the two stores | 26 | 26 |

The migration changed only the future default and added the V4 RPC. Existing
checkpoint and event rows were not rewritten.

## Database security

- Both CT Resume tables: RLS enabled.
- FORCE RLS: false before and after, unchanged.
- Policies: none, intentionally fail-closed for client roles.
- Table grants: no anon or authenticated grants; service_role has SELECT only.
- V4 function: unique exact signature, owner `postgres`, `SECURITY DEFINER`,
  empty `search_path`.
- Function execute: PUBLIC false, anon false, authenticated false,
  service_role true.
- Invalid-input smoke returned `{ok:false, reason:"invalid_commit_input"}` and
  left row counts unchanged.
- Security advisor changes attributable to 003500: none. The two relevant INFO
  notices (`rls_enabled_no_policy`) are the intentional fail-closed baseline.
- Performance advisor changes attributable to 003500: none. The two relevant
  INFO notices are pre-existing unused-index observations.

## Runtime non-regression

After the apply, natural Auto Restart ticks continued with HTTP 200,
`evaluated_count=5`, `eligible_count=0`, `enqueued_count=0`. No task-triggered
tick or run occurred. Requests, runs and locks remained zero. No double request,
double run, retry loop or dispatcher restart was observed.

The active Worker still uses the V3 contract, so the new V4 RPC is additive and
dormant until a separately authorized Worker integration. Review Popup Resume,
Session Resume, Follow 60, scheduler, dispatcher, Golden Flow and Target
Availability therefore retained their current runtime behavior.

## Target Lifecycle readiness

- Candidate: `4bd574dd32a4e5d20125b8ee2bd80ed6e57d6143`, clean.
- Migration hash:
  `eecec3689d9515f84eb4913e4826f616bace7be82328c201c4998d1ca08326df`,
  unchanged.
- Migration 133000 contains no CT Resume table or RPC reference.
- DB ordering prerequisite is now satisfied: 003500 is registered before
  133000.
- Migration 133000 remains absent and Lifecycle remains OFF.

`LIFECYCLE_133000_DB_ORDER_READY=true` means only that a separate, explicit GO
may now review and apply 133000. It is not authorization to do so.

## Closure branch commits

- `20590d9`: reconcile the two static Auto Restart tests with the canonical
  validation chain.
- `57382d8`: preserve the exact canonical 003500 migration, rollback and tests
  on the Follow 60 Backend successor.
- `6149677`: add the explicit CT Resume / Follow 60 / Lifecycle order and domain
  isolation test.

Production code changed: no.  
Production DB changed: yes, 003500 only.  
Runtime changed: no.  
Flags changed: no.  
Production rollback executed: no.  
Local rollback/reapply executed: yes.  
Next step authorized: false.
