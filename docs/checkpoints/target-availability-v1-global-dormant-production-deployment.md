# Target Availability V1 — Global Dormant Production Deployment

Date: 2026-07-30  
Canonical production completion boundary: `2026-07-30T20:54:53Z`  
Status: **canonical DB + Backend deployment completed; Target Availability remains globally dormant**

This checkpoint records the explicitly authorized DB + Backend deployment only. It authorizes no Worker change, producer, Shadow, enforcement, run, tick or phone action.

## 1. Baselines finales

| Layer | Before | After |
|---|---|---|
| Backend | `bb253f02c49b2c953011fd028842cd9c713dc248`, Vercel `dpl_AiLkm2FtxXxhteq8FwQxe8DAR9E8` | `5ecfb1aefb03bc992e306f2d8871328959f65209`, Vercel `dpl_59fEFAqBv6P5pSv4UrtD7wD6CP6Q` |
| Stable aliases | `www.boostmybusinesses.com`, `boostmybusinesses.com` | same aliases, canonical deployment `READY` |
| Database | latest migration `20260729234627_unfollow_search_outcome_and_phase_circuit_v2` | `20260730123708_ct_target_availability_identity_assessment_current_v1` applied once |
| Worker | `2ab324043e0ffdef99d0311eb2812726fde85bc1` | unchanged |
| Worker release | `/Users/admin/phonefarm-worker-releases/2ab3240-follow-60s-rex-corrected-v1` | unchanged |
| Dispatcher | PID `64199`, one healthy process | PID `64199`, one healthy process; restart count `0` |

The Backend candidate worktree was clean, local HEAD equalled the official remote, and the deployed source boundary was exactly `5ecfb1a`. The test-only Worker candidate `f02182d6b78fc2cfcb597ed517972d260004fbfd` was not released or activated.

## 2. Gate zéro dynamique

At `2026-07-30T20:46:18.261871Z`, immediately before the canonical deployment sequence:

- active requests `0`;
- active runs `0`;
- live device locks `0`;
- live tick locks `0`;
- runner process absent;
- dispatcher healthy, `runtimeRootOk=true`, `processCount=1`, `duplicateProcess=false`, queue `0`;
- no concurrent Vercel build or migration was found;
- candidate migration, 41 columns and four indexes were absent before execution.

The expected Backend and Worker baselines matched; no automatic reconciliation was performed.

## 3. Fenêtre sûre

The migration transaction started only after a second read-only concurrency gate at `2026-07-30T20:42:07.691351Z` showed requests/runs/device locks/tick locks `0`, concurrent DDL `0`, and no lock on the Availability relations. The gate remained empty at the final checks. No run was stopped and no runtime action was taken.

## 4. Snapshot dynamique

Pre-migration snapshot at `2026-07-30T20:39:18.978177Z`:

- observations `4`;
- Identity History `0`;
- Identity Current `0`;
- Assessments `0`;
- Availability Current `0`;
- dynamic `ig_interacted_users` baseline `1294`;
- RLS enabled `4/4`, FORCE RLS `4/4` on the four evolved stores;
- untrusted table grants `0`;
- schema snapshot SHA-256 `a3cbac11e2791f79b6cc5267c26444d0e037078924935f87de9c79c46802fba7`;
- data snapshot SHA-256 `85a38e9d8214b2e7887020cf39d41d3132b13b875e9a63e5a20bb65d3616fba0`.

The normalized four-observation dump has the same pre/post SHA-256, `20ad2b8e6832798f1c1aea4e37917600eea45b4f265666409716e8d9d9cf54aa`. This is the authoritative fingerprint comparison; the JSON-row diagnostic hash used a different serialization and is not compared across methods.

## 5. Migration

- Applied artifact: `supabase/migrations/20260730123708_ct_target_availability_identity_assessment_current_v1.sql`.
- Expected and actual SHA-256: `5330306df42b3be207999e189d26a5cf10cb6815d2aafaae4ec1440ebb603288`.
- Execution: one transaction with `ON_ERROR_STOP`, bounded lock/statement timeouts, pre/post exactly-once assertions, and one migration-history insert.
- Result: `COMMIT` successful; history count `1`; stored statement digest and idempotency key both match the canonical hash.
- Backfill `0`; business rows created `0`; legacy rows created by migration `0`; runtime trigger created `0`; RPC created `0`.

No SQL fragment, forward-fix, replay or production fixture was executed.

## 6. Contrat des 41 colonnes

Post-migration catalog certification:

- canonical additive columns `41/41`;
- canonical indexes `4/4`, all ready and valid;
- new V3 check constraints `27`, unvalidated `0`;
- all five Availability tables: constraints `102`, invalid `0`; foreign keys `29`, invalid `0`.

The four indexes are the documented partial indexes for Identity History last observation, Identity Current staleness, Assessment validity and Availability Current staleness.

## 7. Sécurité DB

- RLS enabled `4/4` and FORCE RLS `4/4` on all evolved stores.
- `public`, `anon`, `authenticated`: zero table grants.
- `service_role`: exact minimal set retained:
  - Identity History: `SELECT`, `INSERT`;
  - Identity Current: `SELECT`, `INSERT`, `UPDATE`;
  - Assessments: `SELECT`, `INSERT`;
  - Availability Current: `SELECT`, `INSERT`, `UPDATE`.
- Existing append-only triggers remain present where previously defined; the migration added none.
- No secret was written to the checkpoint or repository.

## 8. Backend

- Deployed SHA: `5ecfb1aefb03bc992e306f2d8871328959f65209` from a clean worktree whose local and remote heads matched.
- Canonical project: `boost-my-businesses-ai-frontend-vercel`.
- Deployment: `dpl_59fEFAqBv6P5pSv4UrtD7wD6CP6Q`, `READY`, production alias `www.boostmybusinesses.com`.
- Root smoke: HTTP `200`.
- Anonymous private-route smokes: `/api/instagram-dashboard/targets`, `/api/instagram-dashboard/auto-restart/overview`, and `/api/instagram-client/workspace` each returned HTTP `401`.
- Vercel build: Next.js 16.2.1 compilation, TypeScript and 36-page static generation green.
- Target Availability domain/writer suite: `31/31` green.
- engine suite: `27/27` green; architecture/dormancy suite: `6/6` green.
- Static caller scan and architecture tests found no application, route, cron, build/start, Lifecycle, Premium, persistence-client or production-table caller of `lib/target-availability/**`.

The deployment tool initially auto-linked the isolated worktree to a newly created non-canonical Vercel project. That isolated deployment is `dpl_7oT8pd3ie9C1WbpoApCoE4wLML3V`; it received no Boost custom/client alias and never replaced canonical production. The worktree was then explicitly pinned to the canonical project before `dpl_59f...`. Permanent deletion of the isolated project was not executed because destructive cleanup requires a separate explicit authorization.

## 9. Dormance

Final controls remained:

- capture `OFF`;
- writer `OFF`;
- allowlist empty;
- kill switch `ON` and present;
- memory probe inherited `ON` but inert because capture is off;
- Identity producer absent/off;
- Assessment producer absent/off;
- Current projector absent/off;
- Availability Shadow `OFF`;
- Policy Shadow `OFF`;
- enforcement `OFF`;
- Lifecycle `OFF`;
- replacement `OFF`.

No flag was changed during the task.

## 10. Worker préservé

The Worker SHA, immutable release, symlink and dispatcher PID are unchanged. There was no Worker checkout consolidation, release creation, symlink edit, dispatcher pause/resume/restart, manual run, manual tick, ADB command or phone action. Final dispatcher state: healthy, queue `0`, `runtimeRootOk=true`, `processCount=1`, `duplicateProcess=false`.

Followers Resume V2 remains Shadow `ON`, enforce `OFF`, with legacy authority preserved. Auto Restart, review-popup resume, session resume, Follow 60s and Unfollow behavior were not edited by this deployment.

## 11. Observation post-déploiement

Checks at `2026-07-30T20:52:28Z` and `2026-07-30T20:54:17Z` both showed:

- observations `4`;
- Identity History `0`;
- Identity Current `0`;
- Assessments `0`;
- Availability Current `0`;
- `ig_interacted_users` `1294`;
- requests/runs/device locks/tick locks `0`;
- no Vercel error log for the canonical deployment;
- canonical root HTTP `200`;
- Worker PID `64199` healthy and unchanged.

Therefore new DB writes attributable to deployment are limited to the one authorized schema-migration history row and schema DDL. No Availability or legacy business row was written.

## 12. Rollback readiness

Rollback was not triggered. The predecessor deployment `dpl_AiLkm2FtxXxhteq8FwQxe8DAR9E8` remains identified, and the documentary down artifact is present. Pre-migration schema/data backups are preserved under `/private/tmp` for comparison. Any future down migration remains destructive and requires a separate explicit approval; forward-fix remains preferred after any reader or producer exists.

## 13. Gaps avant Shadow global

Global Shadow remains blocked pending a separate authorization and certification of:

- explicit read-only runtime adapters/callers;
- global Worker observation coverage and bounded budgets;
- population-wide tenant/account/target scope validation;
- duplicate, partial and sensitive-payload rejection evidence;
- performance/latency and capacity evidence under real natural runs;
- operational monitoring, kill-switch rehearsal and rollback gates;
- policy calibration without Lifecycle, replacement, notification or enforcement.

This dormant deployment is not Shadow evidence.

## 14. Inputs pour le gros checkpoint et la documentation finale du bloc CT

Use these immutable references:

- predecessor Backend `bb253f02c49b2c953011fd028842cd9c713dc248`;
- deployed Backend `5ecfb1aefb03bc992e306f2d8871328959f65209`;
- canonical deployment `dpl_59fEFAqBv6P5pSv4UrtD7wD6CP6Q`;
- migration `20260730123708_ct_target_availability_identity_assessment_current_v1`;
- migration hash `5330306df42b3be207999e189d26a5cf10cb6815d2aafaae4ec1440ebb603288`;
- dynamic legacy baseline/final `1294/1294`;
- Availability row counts `4/0/0/0/0` before and after;
- Worker `2ab324043e0ffdef99d0311eb2812726fde85bc1`, release `2ab3240-follow-60s-rex-corrected-v1`, dispatcher PID `64199`, restart count `0`;
- normalized observation fingerprint `20ad2b8e6832798f1c1aea4e37917600eea45b4f265666409716e8d9d9cf54aa`;
- backup hashes and exact security grants recorded above.

The isolated non-canonical Vercel project cleanup must be tracked separately if explicitly authorized; it does not authorize or block any Target Availability runtime phase.

## 15. Verdict

**GO — TARGET AVAILABILITY V1 GLOBAL DORMANT DEPLOYMENT COMPLETED**

Canonical production DB and Backend are deployed and certified. Target Availability remains fully dormant; Worker/runtime and flags are unchanged. Global Shadow is not authorized. `NEXT_STEP_AUTHORIZED=false`.
