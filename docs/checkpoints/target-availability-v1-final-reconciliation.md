# Target Availability V1 — Final Reconciliation Checkpoint

> Superseded for baseline selection by `docs/checkpoints/target-availability-v1-gate0-current-baseline-reconciliation.md`.

Date: 2026-07-30  
Status: **candidate review only; production deployment not authorized**

## Frozen production baselines

- Backend: `d1de142892a13e4d24bb7fd1d7e2651f423a421b`.
- Worker: `fecf91dfe8e60535810cd99ad9c10d370022ab16`, immutable active release `fecf91d-follow-60s-loriele-complete-v1`.
- DB predecessor: `20260729234627_unfollow_search_outcome_and_phase_circuit_v2`.
- Target Availability: capture/writer/shadow/policy shadow/enforce OFF, allowlist empty, kill switch ON.
- Unfollow V2: Shadow ON, enforce OFF, legacy authority retained.

## Worker baseline reconciliation: `cfaea18` to `fecf91d`

The delta is one commit, `fecf91dfe8e60535810cd99ad9c10d370022ab16` (`perf(follow): complete Loriele 60s canary`), with 479 insertions and 3 deletions. No Target Availability runtime file is changed by the candidate; its only delta from `fecf91d` is a dormant compatibility test.

| File/surface | CFAEA18 behavior | FECF91D behavior | Target Availability overlap | Conflict | Action required | Required test |
|---|---|---|---|---|---|---|
| `follow_60s_canary.py` | initial Follow 60s canary controls/probe | adds bounded proof-optimization statistics and safe metadata guards | none; Availability flags and writer untouched | none | preserve exact file | Follow 60s + full suite |
| `instagram_navigation.py` | baseline Search/Follow navigation | adds short-lived, account-scoped proof reuse and bounded fallback telemetry | shared navigation execution path, but candidate has no runtime edit | semantic-risk only | preserve exact file | Follow runtime, Unfollow V3, Golden Flow |
| `runner.py` | baseline persisted-run accounting | exports guarded Follow 60s proof metadata | run boundary only; no Availability producer/caller | semantic-risk only | preserve exact file | runner + disabled parity + full suite |
| `tests/test_follow_60s_canary.py` | prior canary coverage | adds 121 lines covering optimized/fallback behavior | none | none | retain | targeted Follow 60s suite |
| Orchestrators | Gate 4B/4C tenant scope and Golden Flow | unchanged | direct historical Gate overlap | none | preserve byte-for-byte | Gate scope/disabled parity |
| `supabase_client.py` | Gate ownership and observation writer | unchanged | direct historical Gate overlap | none | preserve byte-for-byte | Availability writer/tenant tests |
| Dispatcher/Scheduler/Auto Restart | active canonical behavior | unchanged | operational only | none | no candidate edit or restart | Auto Restart/dispatcher suites |
| Flags/configuration | Availability fail-closed; Follow canary controls | no Availability flag change | exact safety boundary | none | keep defaults and runtime env unchanged | dormancy contract |

The Follow 60s optimization remains bounded and fallback-preserving. It does not weaken tenant scope, writer gating, kill-switch precedence or unavailable-path parity. `WORKER_RUNTIME_DELTA_REQUIRED=false`.

## Canonical database contract

The SQL artifact contains 41 unique `ADD COLUMN` clauses:

- Identity History: 7;
- Identity Current: 8;
- Availability Assessments: 14;
- Availability Current: 12.

The former 37 count omitted `engine_version`, `policy_version`, `engine_revision`, and `policy_revision` from the explicit PostgreSQL test list even though all four were introduced with the other fields in `10c3b40`. They are consumed by `current-projection.ts`; the revisions prevent stale engine/policy regression. All four are required, so no SQL column is removed.

The exhaustive canonical audit is `docs/contracts/target-availability-v1-db-column-contract.md`. Migration version and content stay `20260730123708`; the checksum must be recalculated and recorded after certification even though the SQL content is unchanged.

## Candidate boundaries

- Backend adds only the pure Identity/Assessment/Current/replay domain, migration/rollback/contracts and documentation.
- Static architecture tests prohibit runtime callers, database clients, routes, cron/start hooks, Lifecycle actions and CT mutations.
- Worker candidate adds only `tests/test_target_availability_v1_dormant_candidate.py` on top of `fecf91d`.
- No production migration, deploy, release, symlink change, restart, run, tick, phone action, ADB action or flag change is part of this checkpoint.

## Certification results before push verdict

1. Worker targeted compatibility: 319/319 green. Complete candidate: 2,226/2,226 green. Because the only candidate delta is three tests, the runtime-equivalent `fecf91d` baseline is 2,223/2,223 with zero failure.
2. Backend engine: 27/27; architecture/dormancy: 6/6; CT aggregate: 122/122; static DB contract: 6/6.
3. Backend full baseline: 2,376 pass / 71 pre-existing failures. Candidate: 2,415 pass / the exact same 71 normalized failure titles. New regressions: zero.
4. Next.js 16.2.1 webpack production build, integrated TypeScript validation and static generation: green. Standalone TypeScript: identical 181 historical test diagnostics on baseline/candidate, none under `lib/target-availability`.
5. PostgreSQL 17 reconstruction, forward, contract, rollback, zero-column check, reapply, security and cross-tenant contracts: green. Structure hash: `ffa7cc29ec8cf3f0ea123ba6387c046f`.
6. Official remote tips, active release and production DB/Backend provenance must remain unchanged through final push verification.
7. Final immutable candidate SHAs are recorded only after commit and push verification.

`NEXT_STEP_AUTHORIZED=false`.
