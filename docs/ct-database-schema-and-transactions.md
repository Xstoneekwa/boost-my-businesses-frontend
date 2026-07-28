# CT database schema and transactions

## Universal contexts

- Evaluation: append-only observations plus a permanently unique consumed-profile projection keyed by tenant/account/target/normalized username. Outcomes never multiply `uniqueProfilesEvaluated`.
- Performance: append-only observations and window aggregates with SAST business date, follows, followbacks, FBR and reliability. FBR is independent from lifecycle utilization.
- Lifecycle: append-only assessments plus a current pointer. Statuses are healthy, watch, replacement recommended/pending, exhausted, archived, stale or insufficient. No automatic archive exists.

## Premium contexts

Immutable criteria snapshots feed idempotent proposal batches. Proposals distinguish candidate, replacement candidate and activated target. Decisions and domain events remain auditable; J+5 claims only pending proposals. Replacement activation creates the new `ig_targets` row and a ready link but leaves the old target unchanged.

## Critical transactions

- Record evaluation: validate Premium account/target, insert idempotent event, then upsert unique profile in one transaction.
- Recompute lifecycle: lock target, count unique profiles, insert immutable assessment, update current pointer.
- Create batch: resolve active ownership and Premium entitlement, insert snapshot/batch/proposals/event atomically.
- Decide: row-lock proposal; first canonical transition wins; retry of same decision is idempotent.
- Timeout: `FOR UPDATE SKIP LOCKED`; claim one expired batch; only pending proposals become auto-accepted. Rejected proposals never change.
- Activate: row-lock proposal; revalidate account, entitlement, blacklist, eligibility and duplicate; insert target; attach target; emit event. Any error rolls back all steps.
- Commercial transition: freeze/cancel batch and invalidate only still-pending proposals.

## Security

All new tables have RLS. `PUBLIC`, `anon` and `authenticated` receive no direct CT table access. Mutations are service-role RPCs with fixed empty search paths, active account ownership/entitlement validation and account-scoped composite foreign keys. The application adapters are fail-closed and unmounted.

## Product gates

Onboarding still requires 15 valid CTs. Low-stock remains `<= 5`. The DB does not bypass either gate. Growth/Pro lifecycle facts prepare future manual-target notifications; automatic proposals and replacement remain Premium-only.
