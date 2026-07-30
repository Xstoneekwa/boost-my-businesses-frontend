# Target Availability V1 — Gate 0 Current-Baseline Reconciliation

Date: 2026-07-30  
Status: **reconciliation and candidate review only; no production execution authorized**

This checkpoint supersedes the earlier `target-availability-v1-final-reconciliation.md` for baseline selection. It does not authorize a database migration, Backend deployment, Worker release, restart, run, tick, phone action, flag change, Shadow or enforcement.

## Certified production boundary

- The latest Mythyl request `fac5700d-cc09-4be6-8e7c-62ad047a4aa2` completed at `2026-07-30T19:30:34.929906Z`.
- The latest Mythyl run `97a40ae5-cdda-4544-8695-22e0dbece259` completed at `2026-07-30T19:30:34.020087Z`.
- At the Gate 0 boundary: active requests `0`, queued requests `0`, active runs `0`, live device locks `0`, live tick locks `0`, and no runner process.
- Canonical runtime status is valid on `/Users/admin/phonefarm-worker-releases/2ab3240-follow-60s-rex-corrected-v1`: `runtimeRootOk=true`, dispatcher `running`, `processCount=1`, `duplicateProcess=false`, queue `0`.

## Current baselines

| Layer | Requested checkpoint baseline | Live baseline used | Decision |
|---|---|---|---|
| Backend | `bb253f02c49b2c953011fd028842cd9c713dc248` | same, production deployment `dpl_AiLkm2FtxXxhteq8FwQxe8DAR9E8` | use unchanged |
| Worker | `6119ce23b0c207207dbe1b21b4ac4df217e3dbef` | `2ab324043e0ffdef99d0311eb2812726fde85bc1`, active immutable release `2ab3240-follow-60s-rex-corrected-v1` | use the later live head, as required by the Gate 0 drift rule |
| Database | `20260729234627_unfollow_search_outcome_and_phase_circuit_v2` | same | migration candidate remains absent |

Backend local/official remote/production all resolve to `bb253f0`. Worker `2ab3240` is the direct successor of `6119ce2`; its official branch/remote and immutable active release resolve to the same commit. Candidate construction therefore uses `bb253f0` and `2ab3240`, not the superseded Worker head.

## Delta audit

### Backend: `d1de142` to `bb253f0`

One commit, `bb253f0` (`fix(auto-restart): resume exact resolved incidents`), changes four Auto Restart files.

| FILE | OLD_BEHAVIOR | CURRENT_BEHAVIOR | TARGET_AVAILABILITY_OVERLAP | CONFLICT_TYPE | ACTION_REQUIRED | TEST_REQUIRED |
|---|---|---|---|---|---|---|
| `lib/instagram-dashboard/auto-restart-lineage-policy.ts` | a previous non-recoverable run prevented resume | the exact latest resolved incident may resume while all other gates remain | none; V1 domain has no Auto Restart caller | semantic baseline preservation | keep `bb253f0` version | lineage + human resume + full parity |
| `lib/instagram-dashboard/auto-restart-lineage-policy.test.ts` | older rejection contract | certifies exact resolved-incident exception | none | none | retain | included |
| `lib/instagram-dashboard/auto-restart-tick.ts` | reapplied a generic delay after resolved human authorization | does not add that obsolete second delay, while retaining live locks and eligibility gates | none | stale historical test expectation | keep current production behavior; do not revert | targeted Auto Restart + baseline full comparison |
| `lib/instagram-dashboard/auto-restart-human-resume.test.ts` | prior resume coverage | covers resolved incident resume | none | none | retain | included |

The repository-wide test `auto-restart-global-delay-contract.test.mjs` still expects the removed second delay. It fails identically on `bb253f0` and on the candidate and is classified as pre-existing test drift, not a Target Availability regression.

### Worker: `fecf91d` to live `2ab3240`

The live delta contains `6119ce2` (`fix(follow): reconcile review popup confirmation`) followed by `2ab3240` (`feat(worker): scope corrected follow 60s canary to Rex`).

| FILE | OLD_BEHAVIOR | CURRENT_BEHAVIOR | TARGET_AVAILABILITY_OVERLAP | CONFLICT_TYPE | ACTION_REQUIRED | TEST_REQUIRED |
|---|---|---|---|---|---|---|
| `instagram_navigation.py` | no bounded confirmation for the Instagram review sheet | taps the single blue Follow CTA once, waits boundedly, and resumes verification after late dismissal | navigation is historically shared, but candidate changes no runtime file | semantic preservation only | preserve byte-for-byte from `2ab3240` | review-popup, Follow, Unfollow V3, full suite |
| `follow_60s_canary.py` | previous account scope/canary proof behavior | corrected Rex scope with bounded proof reuse/fallback | none; no Availability producer | semantic preservation only | preserve byte-for-byte | Follow 60s + Golden Flow |
| `runner.py` | prior Follow 60s metadata | exports corrected canary proof metadata | run boundary only; no V1 caller | semantic preservation only | preserve byte-for-byte | runner + full suite |
| `tests/test_follow_review_popup_confirmation.py` | no review-sheet regression test | covers bounded confirmation and late disappearance | none | none | retain | included |
| `tests/test_follow_60s_canary.py` | prior canary tests | covers corrected Rex scope and fallback | none | none | retain | included |

`account_session_orchestrator.py`, `supabase_client.py`, dispatcher, session resume, tenant resolution, identity guard, Auto Restart and Unfollow V3 receive no candidate runtime edit. `WORKER_RUNTIME_DELTA_REQUIRED=false`.

## Candidate reconstruction

- Backend worktree: `/Users/admin/Projects/boost-target-availability-v1-dormant-candidate-bb253f0`.
- Backend branch: `feat/target-availability-v1-dormant-candidate-bb253f0-20260730`.
- Worker worktree: `/Users/admin/Projects/instagram-worker-target-availability-v1-dormant-candidate-2ab3240`.
- Worker branch: `feat/target-availability-v1-dormant-candidate-2ab3240-20260730`.
- The Backend V1 stack was replayed additively without Git conflict on `bb253f0`.
- The Worker candidate adds only `tests/test_target_availability_v1_dormant_candidate.py` on `2ab3240`; no release or restart is needed for any future dormant DB/Backend review.

## Canonical database contract

- Artifact: `20260730123708_ct_target_availability_identity_assessment_current_v1.sql`.
- SHA-256: `5330306df42b3be207999e189d26a5cf10cb6815d2aafaae4ec1440ebb603288`.
- Contract: 41 additive columns, four indexes, zero backfill, zero trigger, zero RPC, zero runtime caller.
- Production audit: migration absent, 0/41 column collisions, 0/4 index collisions.
- Live Availability counts at audit time: observations `4`; identity history `0`; identity current `0`; assessments `0`; availability current `0`.
- The live legacy `ig_interacted_users` count was `1294` at audit time. It is evidence only; all future preflight snapshots must be recomputed dynamically and never used as a hard-coded gate.
- All four new target tables retain RLS and FORCE RLS. `public`, `anon`, and `authenticated` have no table grant. `service_role` receives only the documented `SELECT/INSERT` or `SELECT/INSERT/UPDATE` set.

No newer production migration conflicts with the unique `20260730123708` version. The SQL content and canonical hash remain unchanged.

## Dormancy and compatibility proof

- Production Target Availability state observed: capture OFF, writer OFF, allowlist empty, Availability Shadow OFF, Policy Shadow OFF, kill switch present. Identity/Assessment/Current producers and projectors are absent.
- Static architecture tests reject any application, route, cron, build/start, Lifecycle, replacement, Supabase-client or production-table caller of the new V1 domain.
- The Worker candidate is tests-only and defaults fail closed; writer cannot bypass capture or the exact account allowlist.
- Unfollow Resume V2 remains Shadow ON, enforce OFF, and legacy-authoritative. No Unfollow enforcement is introduced.
- Gate 4B/4C scope, review-popup resume, session resume, Follow 60s, Unfollow V3, Auto Restart and Golden Flow are preserved by baseline-first reconstruction and full-suite parity.

## Certification results

### Worker

- Targeted compatibility pack: `220/220` green, including Availability, Gate 4B/4C, tenant resolution, review-popup resume, session resume, Follow 60s, Unfollow V3, Auto Restart, dispatcher and runner paths.
- Dormant candidate tests: `3/3` green.
- Complete candidate suite: `2242/2242` green in `277.664s`.
- Because the only candidate delta is three tests, all `2239` baseline tests remain green; baseline failures `0`, candidate regressions `0`.

### Backend

- Identity/Assessment/Current/Replay: `27/27` green.
- Architecture/dormancy/static DB contract: `12/12` green.
- Complete baseline: `2450` tests, `2378` pass, `72` pre-existing failures.
- Complete candidate: `2489` tests, `2417` pass, the same `72` failures. All `71` normalized `not ok` titles are identical; new regressions `0`.
- Next.js 16.2.1 webpack production build, TypeScript and 36-page static generation: green.

### Database, local PostgreSQL 17 only

- Full CT rebuild, fixtures, contracts, cross-tenant and security forward-fix: green.
- Forward migration: columns `52 -> 93` and candidate indexes `0 -> 4`.
- Documentary rollback: columns `93 -> 52`, candidate indexes `4 -> 0`, table rows unchanged.
- Reapply: columns `52 -> 93`, indexes `0 -> 4`, contract/security green again.
- Structure hash after reapply: `ffa7cc29ec8cf3f0ea123ba6387c046f`.

The PostgreSQL instance was temporary and local, and was stopped after certification. Production DB was never written.

## Gate 0 decision

| Decision | Verdict |
|---|---|
| Reconciliation on current live baselines | GO |
| Candidate construction and push | GO |
| Worker runtime delta/release/restart | NOT REQUIRED / NOT AUTHORIZED |
| Production migration or Backend deployment | NOT AUTHORIZED; separate explicit GO required |
| Shadow, enforcement, Lifecycle or replacement | NO-GO |

Final Gate 0 verdict: **GO — TARGET AVAILABILITY V1 GATE 0 RECONCILIATION COMPLETED**, subject to final clean-tree and immutable remote-SHA verification recorded in the task report. `NEXT_STEP_AUTHORIZED=false`.
