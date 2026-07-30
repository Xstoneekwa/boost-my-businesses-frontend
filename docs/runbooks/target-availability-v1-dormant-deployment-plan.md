# Target Availability V1 — Dormant Deployment Plan

Status: **prepared only — execution is not authorized**  
Candidate date: 2026-07-30  
Production project: `zgafnshkjywfltxgbtzg`

## Preconditions

1. Obtain a separate explicit production GO.
2. Re-fetch both official remotes and require the candidate SHAs recorded in the candidate checkpoint.
3. Re-list production Supabase migrations. The expected predecessor is
   `20260729234627_unfollow_search_outcome_and_phase_circuit_v2`; stop if a newer migration collides with the candidate.
4. Repeat the read-only collision query for all 37 columns and four indexes. Require zero collisions.
5. Confirm the production controls remain: capture OFF, writer OFF, account allowlist empty, kill switch ON,
   Availability Shadow OFF, Policy Shadow OFF, enforce OFF, Lifecycle/replacement OFF.
6. Confirm Unfollow V2 remains Shadow ON/enforce OFF and record the active Worker release/symlink.
7. Require no active requests, runs, device locks, tick locks or queue items before any optional Worker activation.

## Execution order

1. **Backup/snapshot**
   - Record the current schema migration list and structure hashes.
   - Export schema-only DDL for the five Availability tables and their grants/RLS metadata.
   - Record row counts for all five tables. Preserve the four certified Gate 4C observations.
2. **Database migration**
   - Apply only `20260730123708_ct_target_availability_identity_assessment_current_v1.sql`.
   - Do not run the documentary down migration.
   - The migration is additive: 37 nullable/defaulted columns and four indexes; no backfill, trigger, RPC or data write.
3. **Database verification**
   - Verify all five tables have RLS enabled and forced.
   - Verify `public`, `anon`, and `authenticated` have zero table grants.
   - Verify the exact `service_role` least-privilege grants and absence of DELETE/TRUNCATE/REFERENCES/TRIGGER.
   - Verify the four observation rows remain unchanged and all other Availability tables retain their pre-deploy counts.
   - Execute the read-only schema/contract smoke suite; do not insert production fixtures.
4. **Backend candidate**
   - Deploy the exact Backend candidate SHA, not a moving branch tip.
   - Do not change environment variables or feature flags.
5. **Backend verification**
   - Require build provenance to match the candidate SHA and the stable alias to return HTTP 200.
   - Run the Target Availability architecture/dormancy smokes.
   - Confirm no public route, scheduled job, runtime caller, Lifecycle action or replay command was activated.
6. **Worker candidate decision**
   - The Worker candidate differs from the current Worker production baseline only by tests.
   - Preferred dormant deployment: **do not activate a new Worker release**, because there is no runtime delta to deliver.
   - If governance nevertheless requires packaging the test-only SHA, verify the immutable release tree is byte-identical
     to the current runtime outside `tests/`; otherwise stop.
7. **Worker verification and optional restart**
   - No restart is required when the active Worker release is retained.
   - If a governance-mandated test-only release is activated, obtain a separate runtime GO and perform exactly one
     canonical restart after a zero gate; verify single wrapper/consumer, exact root, no duplicate and natural ticks only.
8. **Dormancy certification**
   - Reconfirm capture OFF, writer OFF, allowlist empty, kill switch ON and every Shadow/enforce/Lifecycle/replacement flag OFF.
   - Reconfirm no new writes in any of the five Availability tables.
   - Reconfirm Auto Restart, Scheduler, Dispatcher, Follow 60s Canary and Unfollow/Search V3 behavior/provenance.
9. **Observation period**
   - Observe application health and database error rate without enabling a producer or reader.
   - Do not interpret this dormant observation period as Shadow certification.

## Stop conditions

Stop before the next step on any baseline drift, migration collision, unexpected grant, missing FORCE RLS, new runtime caller,
flag change, row-count change, build regression, active runtime gate, or candidate SHA mismatch.

## Explicit non-actions

This plan does not authorize migration execution, deployment, Worker release activation, symlink mutation, restart, run/tick,
feature-flag change, CT mutation, email/notification, ADB or phone action.
