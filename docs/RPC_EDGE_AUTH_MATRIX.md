# RPC and Edge Authentication Matrix

> Static authorization inventory plus live deployment metadata, verified
> read-only on **2026-07-14**. This is not a penetration test. A grant or
> `SECURITY DEFINER` marker alone does not prove exploitability, but every
> unproven boundary is explicitly flagged.

## Edge Functions

All listed production functions were active with platform `verify_jwt=false` at
the snapshot. Authentication is therefore enforced inside function code and
must remain fail-closed.

| Function | Version | Accepted caller proved by static inspection | Internal controls | Status |
|---|---:|---|---|---|
| `outreach-enqueue` | 14 | internal bearer or client JWT verified through Supabase Auth | service-role internal path; source and metadata allowlists | Static audit only |
| `instagram-credentials` | 16 | internal bearer or client JWT verified through Supabase Auth | Vault write-only pattern; ownership validation | Static audit only |
| `dashboard-actions` | 10 | internal bearer or client JWT verified through Supabase Auth | owned-account/client scope | Static audit only |
| `instagram-account-status` | 7 | internal bearer only | rejects missing/invalid internal token | Static audit only |
| `admin-dashboard` | 15 | internal bearer only | no client JWT path documented | Static audit only |

Negative authentication tests were not executed. Verdict for bypass resistance:
**NOT PHYSICALLY VALIDATED**.

`verify_jwt=false` is not itself an authorization failure when custom verification
is complete, but it makes each code path part of the security perimeter.

## Service-only RPC boundary

Static grants show `anon=false`, `authenticated=false`, `service_role=true` for
the privileged groups below:

- account run request create/claim/complete/cancel transitions;
- commercial plan-change and Stripe webhook claim/fulfillment transitions;
- incident/action upserts and canonical Operator Review transition;
- Instagram credential submission and other internal worker transitions.

Representative current function: `review_operator_dashboard_action`. Live
migration entry: `20260713231003_operator_review_canonical_transition`;
controlled Git source:
`supabase/migrations/20260714003000_operator_review_canonical_transition.sql`.

Status: grant boundary **PROVED STATICALLY**; negative runtime tests
**NOT PERFORMED**.

## Publicly executable `SECURITY DEFINER` inventory requiring audit

The following functions had execute grants for both `anon` and `authenticated`
and were marked `SECURITY DEFINER` in the live catalog:

- `auto_restart_acquire_device_lock`
- `auto_restart_bind_device_lock`
- `auto_restart_release_device_lock`
- `auto_restart_renew_device_lock`
- `auto_restart_transfer_device_lock`
- `complete_scheduled_session_preflight`
- `evaluate_account_schedule_gate`
- `get_valid_scheduled_session_preflight`
- `upsert_scheduled_session_preflight`

A static search of their live definitions found no explicit `auth.uid()`, JWT
claim, `service_role` or `current_user` authorization marker. This does **not**
prove that a call is exploitable: arguments, ownership joins, RLS interaction
and surrounding API exposure still require review. Current classification:
**AUDIT REQUIRED / NOT PROVEN SAFE**.

No RPC was invoked to test this boundary during the documentation task.

## Required audit method

1. Reconstruct the exact overload/signature and effective grants from the live
   catalog.
2. Read the complete function body and every called function.
3. Prove tenant/account/device ownership and caller identity for each mutation.
4. Test anonymous, wrong-tenant, authenticated-owner and service-role cases in
   an isolated non-production environment.
5. Revoke unnecessary grants or add explicit checks only in a separately
   authorized code/DB task.
6. Re-run regression tests for scheduler, preflight and device locks before any
   migration is applied.

## Source locations

- Edge sources: worker repository path `supabase/functions/`
- RPC migrations: `supabase/migrations/`
- Latest production migration entry at snapshot:
  `20260713231003_operator_review_canonical_transition`
- Corresponding current source file:
  `supabase/migrations/20260714003000_operator_review_canonical_transition.sql`
- Scheduler contract: [botapp-scheduler-runtime-contract.md](botapp-scheduler-runtime-contract.md)

Secrets, bearer values, JWTs, private URLs and customer records are excluded.
