# Target Availability V1 — Dormant Deployment Candidate Review

Date: 2026-07-30  
Status: candidate construction and review only  
Production mutation authorized: **no**

## 1. Executive Summary

Target Availability V1 has been reconciled onto the current Backend and Worker baselines as a dormant candidate. The Backend
adds a pure deterministic Identity/Assessment/Current domain, replay tooling, an additive migration and documentation. The Worker
candidate adds tests only; its runtime tree remains identical to the selected production Worker baseline. Static call-graph tests
prove that the new V1 domain has no application or Lifecycle runtime caller and cannot access a persistence client or production table.

The production database was audited read-only and not changed. A PostgreSQL 17 instance rebuilt the CT schema locally, applied the
candidate forward migration, passed security/contracts, rolled the V3 additions back, preserved all five foundation tables, then
reapplied the migration and passed the contract again.

## 2. Current Baselines

| Repository/layer | Local/remote/production baseline | Branch or migration | Status |
|---|---|---|---|
| Backend | `d1de142892a13e4d24bb7fd1d7e2651f423a421b` | `fix/unfollow-search-click-autorestart-v3-20260730` | official remote aligned; production deployment `dpl_3Dih83u6YEvQg7RPgGFpUJRrrLRf`, READY on stable alias |
| Worker | `cfaea18b2f6b6eaef18de7e5dac855f9bf292d0d` | `codex/follow-60s-loriele-canary-v1` | local/official remote/active release aligned |
| Database | `20260729234627` | `unfollow_search_outcome_and_phase_circuit_v2` | latest production migration re-listed during review |

Official remotes: `Xstoneekwa/boost-my-businesses-frontend.git` and `Xstoneekwa/instagram-worker-python.git`.

## 3. Source Branches

- Official checkpoint: `docs/target-availability-v1-predeployment-20260730` at `1ea7f694e2ab5c0192145afa8c63c6e4bff20f31`.
- Certified source: `feat/target-availability-identity-assessment-current-v1-20260730` at
  `f214f84b27dde5d32026010575231be3adaf25d1`.
- Backend candidate: `feat/target-availability-v1-dormant-candidate-20260730` from `d1de142`.
- Worker candidate: `feat/target-availability-v1-dormant-candidate-20260730` from `cfaea18` in the Worker repository.

## 4. Commit Reconciliation

| Source commit | Classification | Candidate result |
|---|---|---|
| `f686262` Identity Resolution | reapply | `a2311ea` |
| `ef6d6b9` Assessment Engine | reapply | `34d17e5` |
| `95fead5` Availability Current | reapply | `b768f8f` |
| `418513d` Replay/fixtures | reapply | `4ac1557` |
| `78eff65` DB contract | reapply | `10c3b40` |
| `42fdbd0` Replay command | reapply | `0492055` |
| `25d5949` Documentation | reapply, documentary | `6a08de0` |
| `f214f84` Cleanup | reapply | `2faa341` |

No commit was already present, obsolete or skipped. Each commit was audited against `d1de142` before sequential application;
no direct file overlap or Git conflict existed. Two current-baseline certification commits add static dormancy and bounded capacity tests.

## 5. Worker Reconciliation

No source runtime component was reapplied to Worker. Current Gate 4B/4C observation instrumentation already exists in the selected
baseline. The candidate adds only `tests/test_target_availability_v1_dormant_candidate.py`, proving controls default OFF, writer cannot
bypass capture/allowlist, no Identity/Assessment/Current table producer exists, and all candidate deltas are test-only.

`runner.py`, `instagram_navigation.py`, `account_session_orchestrator.py`, `supabase_client.py`, dispatcher, Auto Restart, Unfollow/Search
V3 and Follow 60s Canary are unchanged from `cfaea18`.

## 6. Backend Reconciliation

The source adds only `lib/target-availability/**`, the explicit replay script, the candidate migration/rollback/tests and documentation.
It creates no public/private route, scheduled job, cron, lifecycle action or startup hook. Static tests scan `app/` and `lib/` and reject
any runtime caller of Identity, Assessment, Current or Replay. The domain also rejects React, Next, Supabase, Lifecycle, Premium,
business-action vocabulary and production table access.

## 7. Database Migration Review

Candidate: `supabase/migrations/20260730123708_ct_target_availability_identity_assessment_current_v1.sql`.

- Version is not present in production; its timestamp is later than the current production predecessor.
- Live read-only audit: 0/37 candidate column collisions and 0/4 candidate index collisions.
- All five foundation tables exist; all have RLS enabled and forced.
- Live grants exist only for `postgres` and `service_role`; public/anon/authenticated have none.
- Current counts remain observations=4 and identity history/current, assessments/current=0.
- Migration is additive, zero-backfill, zero-trigger, zero-RPC, zero-business-data and contains no SECURITY DEFINER function.
- Exact service-role grants are re-established after revoking all roles; destructive service-role privileges are absent.

## 8. Overlap Resolution

| File/surface | Baseline behavior | Target change | Concurrent change | Strategy | Required proof |
|---|---|---|---|---|---|
| `runner.py` | Unfollow V3 + Follow 60s | none | Follow 60s canary | preserve byte-for-byte | Worker full/Golden Flow |
| `instagram_navigation.py` | Search V3 + Follow 60s | none | both concurrent lines | preserve byte-for-byte | Unfollow/Follow suites |
| `account_session_orchestrator.py` | Gate hooks + tenant fail-closed | none | Gate 4B/4C | preserve byte-for-byte | disabled parity, scope tests |
| `supabase_client.py` | Gate ownership/Worker DB | none | Gate/Unfollow | preserve byte-for-byte | Worker full suite |
| Auto Restart Backend files | V3 canonical lineage | none | `d1de142` | baseline first, no target edits | baseline-equal failures + targeted tests |
| `package.json` | baseline scripts | adds explicit replay/test scripts | no conflicting current edit | additive manual commands only | dormancy test, build |
| `supabase/migrations` | latest production `20260729234627` | adds `20260730123708` | registry shared | later unique timestamp; no applied migration edit | live collision + local rebuild |

No Git conflict was found. Semantic overlaps were resolved by selecting the newest baseline and leaving shared runtime files untouched.
During final certification, the source Follow 60s worktree acquired uncommitted changes in `follow_60s_canary.py` and
`instagram_navigation.py` from an unidentified concurrent task. They are not present in the official remote or active release,
were not copied into this candidate, and remain outside this task. A future deployment review must rebase/retest if that work is activated.

## 9. Dormancy Proof

- Target Availability controls default false and require an exact UUID account allowlist.
- Kill switch wins; malformed/absent flags fail closed.
- New V1 engine files have no runtime caller outside explicit local replay/tests.
- New domain code has no database client, table access, UI import, lifecycle action or side effect.
- Replay is an explicit operator script and is absent from build/start/dev/install hooks.
- Worker candidate is test-only; current production runtime behavior is unchanged.

## 10. Security and Tenancy

RLS/FORCE RLS, explicit role revocation, exact service-role grants, strict tenant/account/target scope checks and cross-scope rejection
are covered statically and in the reconstructed database. Same usernames in different tenant/account scopes never aggregate. Current
projection uses deterministic ordering and compare-and-swap semantics; older engine/policy revisions fail closed.

Reference: Supabase RLS and API hardening guidance:
<https://supabase.com/docs/guides/database/postgres/row-level-security> and
<https://supabase.com/docs/guides/api/securing-your-api>.

## 11. Tests

- Worker baseline full suite: 2,219/2,219 green; Worker candidate full suite: 2,222/2,222 green.
- Worker targeted Availability suite: 74/74 green.
- Backend engine tests: 27/27 green; architecture/dormancy: 6/6 green; CT V2.1 aggregate: 122/122 green;
  migration static contract: 4/4 green.
- Backend baseline full runner: 2,091 passing reporter entries and 142 pre-existing failure entries. Candidate: 2,128 passing
  and the exact same normalized 142-entry failure set. No candidate regression was added.
- Standalone TypeScript reports the exact same 181 pre-existing test-file diagnostics on baseline and candidate, with no
  Target Availability diagnostic. The production Next.js webpack build is green and includes TypeScript/build validation.
- PostgreSQL local rebuild/security/forward/rollback/reapply contracts: green; structure hash `ffa7cc29ec8cf3f0ea123ba6387c046f`.

## 12. Capacity Review

The local replay covers 100, 1,000 and 10,000 observations, deterministic retries, duplicates, out-of-order input, concurrency,
multi-tenant/account isolation and same usernames in different scopes. The 10,000-observation double replay completed locally in
approximately 1.2–1.5 seconds without invariant violations. A separate portfolio simulation covers 5 accounts, 106 CT, 54 synthetic
runs over seven days and two tenants, producing 106 isolated Identity/Assessment/Current projections with no invariant violation.
These are local simulations, not production throughput evidence.

## 13. Deployment Plan

See `docs/runbooks/target-availability-v1-dormant-deployment-plan.md`. The preferred dormant rollout applies the additive DB migration,
deploys the exact Backend SHA and leaves Worker release/runtime unchanged because the Worker candidate is test-only. No account-by-account
rollout is needed while everything remains dormant.

## 14. Rollback Plan

See `docs/runbooks/target-availability-v1-dormant-rollback-plan.md`. Prefer forward-fix for the additive DB contract; the documentary down
migration is allowed only under a separate explicit GO before producers/readers exist. Four Gate observations are always preserved.

## 15. Global Shadow Gaps

| Item | Readiness | Dormant blocker | Global Shadow blocker |
|---|---|---:|---:|
| Strict scope, idempotence, ordering, concurrency | ready locally | no | no |
| Write caps/batch limits for all accounts | partial (pilot writer bounded) | no | yes |
| Retention/compaction policy | absent | no | yes |
| Metrics and per-tenant cardinality dashboards | partial | no | yes |
| Alerting and automatic stop thresholds | absent | no | yes |
| Dynamic kill switch | ready for existing observation path; unconnected to V1 producers | no | yes |
| Multi-worker projector isolation | simulated only | no | yes |
| Failure recovery/checkpointing | deterministic replay ready; production projector absent | no | yes |
| Production latency/load/soak | unobserved | no | yes |
| Global producer/projector wiring | intentionally absent | no | yes |

## 16. Risks

- A future operator could mistakenly enable producers before Shadow safeguards exist; controls and kill switch must remain prerequisites.
- Additive columns are safe dormant, but destructive down migration becomes unsafe after producers exist.
- Local capacity results do not establish production database latency or multi-worker soak behavior.
- The repository-wide Backend test harness contains pre-existing path-alias/fixture/environment failures; candidate readiness relies on
  exact normalized baseline parity plus fully green targeted and build checks, not on claiming those failures are fixed.
- Concurrent uncommitted Follow 60s work is not part of the current production baseline; any later activation invalidates the frozen
  Worker baseline and requires a fresh reconciliation before dormant deployment.

## 17. GO/NO-GO Matrix

| Decision | Verdict | Reason |
|---|---|---|
| Construct/push dormant candidate | GO, subject to final push verification | additive, no runtime callers, baseline parity |
| Future dormant DB + Backend deployment | ready for a separate explicit GO | plans, rollback and security contract prepared |
| Activate Worker V1 producer | NO-GO | no producer is included or authorized |
| Global Shadow | NO-GO | caps, retention, metrics, alerting, auto-stop and soak remain open |
| Lifecycle/replacement/enforcement | NO-GO | explicitly out of scope and disabled |

## 18. Final Verdict

**GO — TARGET AVAILABILITY V1 DORMANT DEPLOYMENT CANDIDATE READY**, subject only to immutable-SHA push verification in the
final task report. Global dormant deployment readiness is true; Global Shadow readiness is false. This document grants no deployment,
migration, restart, run, flag or Shadow authorization. `NEXT_STEP_AUTHORIZED=false`.
