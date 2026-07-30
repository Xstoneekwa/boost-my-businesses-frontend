# Target Availability V1 — Final Dormant DB + Backend Deployment Plan

Status: **prepared only; execution requires a separate explicit GO**

## Immutable inputs

- Production Worker remains `fecf91dfe8e60535810cd99ad9c10d370022ab16`; no Worker release or restart is required.
- Production Backend predecessor is `d1de142892a13e4d24bb7fd1d7e2651f423a421b`.
- DB predecessor is `20260729234627_unfollow_search_outcome_and_phase_circuit_v2`.
- Only migration `20260730123708_ct_target_availability_identity_assessment_current_v1.sql` is in scope.
- Canonical DB contract is 41 additive columns and four indexes, derived from the migration SQL.
- The exact Backend candidate SHA and migration SHA-256 must match the final reconciliation report.

## Preflight and stop gates

1. Obtain a separate explicit production GO and name one database operator.
2. Fetch official remotes; require exact immutable candidate SHAs and a clean tracked tree.
3. Re-list production migrations and stop on any version newer than or colliding with the expected predecessor/candidate.
4. Derive all 41 `(table,column)` pairs and four indexes from the artifact; require zero live collisions.
5. Snapshot schema-only DDL, migration history, RLS/FORCE RLS, grants, constraints, indexes and counts for all five Availability tables.
6. Preserve the four Gate 4C observations; require the other four Availability tables to retain their current counts.
7. Require capture/writer/shadow/policy shadow/enforce/Lifecycle/replacement OFF, allowlist empty and kill switch ON.
8. Require Unfollow Shadow ON/enforce OFF and record Worker release/symlink provenance.
9. Stop on an active request, run, device lock, tick lock or queue item.

## Controlled execution

1. Apply only the exact migration checksum recorded in the final report.
2. Verify 41 columns, four indexes, every constraint, RLS and FORCE RLS.
3. Verify zero grants for `public`, `anon`, `authenticated`; verify exact least-privilege `service_role` grants and no destructive privilege.
4. Verify zero trigger/RPC/backfill/business-data mutation and unchanged table row counts.
5. Deploy only the exact Backend candidate SHA. Change no environment variable or flag.
6. Verify Vercel provenance, stable alias HTTP 200, architecture/dormancy smokes and absence of runtime caller.
7. Leave the Worker symlink and dispatcher untouched; restart count remains zero.
8. Observe health while dormant. Do not describe dormant health as Shadow certification.

## Stop conditions

Stop immediately on baseline drift, checksum mismatch, migration collision, unexpected grant, missing FORCE RLS, row-count change, new caller, flag drift, build regression, runtime activity or production write outside the one authorized migration.

This plan does not authorize its own execution. `NEXT_STEP_AUTHORIZED=false`.
