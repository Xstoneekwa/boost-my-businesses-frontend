# CT database deployment runbook

## Preconditions

- Approved maintenance window and named reviewer.
- Production migration list re-read and cutover `20260728001632` present.
- Baseline files absent from the deployment plan.
- Only the manifest-listed post-cutover migrations are eligible for an approved window.
- Schema-only backup and rollback decision owner recorded.
- No active conflicting database migration.

## Dry review

Compare filenames and SHA-256 values, inspect SQL, verify duplicate active target count is zero, and run the complete two-rebuild local gate. Confirm all CT runtime flags remain disabled and no route imports `supabase-adapters.ts`.

## Controlled future apply

This repository package does not authorize application. A future approved task must apply one migration at a time, then verify tables, constraints, indexes, RLS, effective privileges and RPC signatures. Stop before any runtime activation.

## Phase 8B forward-fix order

Production already records migrations `20260728132018`, `20260728132019` and
`20260728132020`. The remaining approved order is intentionally:

1. `20260728185253_fix_client_account_notifications_global_grants_v1.sql`;
2. `20260728132021_ct_system_transactional_rpcs_v1.sql`.

The forward-fix must run first even though its version sorts after the original
RPC migration. Apply both separately with `--include-all`, never with a global
`db push`, and verify the first migration before making the RPC migration
eligible.

The forward-fix revokes all table privileges on
`public.client_account_notifications` from `PUBLIC`, `anon` and
`authenticated`, preserves `service_role`, keeps RLS enabled and creates no
policy. Production default privileges remain a separately documented platform
debt because changing them would affect every future table in `public`.

## Post-apply checks

Run read-only catalog assertions. Do not create real batches, notifications, emails or targets. Runtime rollout is a separate change after shadow evidence and explicit approval.

## Stop conditions

Unknown pending history, baseline proposed as pending, existing duplicates, failed DDL, privilege drift, cross-account access, unexpected trigger activity or any need to repair production history.
