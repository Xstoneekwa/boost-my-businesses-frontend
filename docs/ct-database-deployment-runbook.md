# CT database deployment runbook

## Preconditions

- Approved maintenance window and named reviewer.
- Production migration list re-read and cutover `20260728001632` present.
- Baseline files absent from the deployment plan.
- Only the four manifest-listed post-cutover migrations pending.
- Schema-only backup and rollback decision owner recorded.
- No active conflicting database migration.

## Dry review

Compare filenames and SHA-256 values, inspect SQL, verify duplicate active target count is zero, and run the complete two-rebuild local gate. Confirm all CT runtime flags remain disabled and no route imports `supabase-adapters.ts`.

## Controlled future apply

This repository package does not authorize application. A future approved task must apply one migration at a time, then verify tables, constraints, indexes, RLS, effective privileges and RPC signatures. Stop before any runtime activation.

## Post-apply checks

Run read-only catalog assertions. Do not create real batches, notifications, emails or targets. Runtime rollout is a separate change after shadow evidence and explicit approval.

## Stop conditions

Unknown pending history, baseline proposed as pending, existing duplicates, failed DDL, privilege drift, cross-account access, unexpected trigger activity or any need to repair production history.
