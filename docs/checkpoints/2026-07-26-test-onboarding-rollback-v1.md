# Release checkpoint — Test onboarding rollback v1

Status: complete; the single approved Rex transaction and both active-surface
smokes are certified.

## Release registry

- Parent frontend/backend baseline: `13e0e6cd22248751efebcdef18f19ec2c9ab916e`
- Worker unchanged: `8eec60f8301aec32597a393659357da18d38ba36`
- BotApp unchanged: `f90df0dc4e7d90ddd67898c8f7b6bfb093fdf481`
- Migration: `20260726030119_rollback_test_instagram_onboarding_v1.sql`
- RPC: `rollback_test_instagram_onboarding_v1`
- Supabase project: `zgafnshkjywfltxgbtzg`
- Rollback release commit: `18d508a2f59b856ac67377b1991965e30813838f`
- Post-enrichment tombstone projection fix: `6fdaf47`
- Production deployment: `dpl_5mfSbr3TMpyvSd6DsyvvarYD7Ara`
- Stable alias: `https://www.boostmybusinesses.com`

## Current production state and handover

The RPC and audit ACL are production-applied. The production dry-run returned
`dry_run_pass`, all guards passed, and the before/after state hash remained
`564960e433a33e4a97691386d24a399e`. The real transaction completed at
`2026-07-26T03:15:27.647369+00:00` with audit ID
`6c31ce4a-93a6-4aa6-9b9e-5c0284e0ed8a`.

The transaction archived 39 active targets, revoked one credential and its
Vault secret, released one assignment and one app instance, deactivated the
client link, removed the subscription-account link, removed the account-scoped
settings/filter and 20 non-historical verification jobs, resolved the one
login-package incident, and returned the Premium entitlement to
`entitlement_reserved` with `account_id` and `consumed_at` cleared. Historical
run/request/action/CT/checkout/session evidence remains in place.

An idempotent replay returned `already_rolled_back`. The audit table and the
commercial audit table each still contain exactly one matching event. Effective
function privileges are `anon=false`, `authenticated=false`, and
`service_role=true`.

The Client smoke shows two linked and two connected tenant accounts, no Rex row,
and the enabled `Ajouter un compte Instagram` CTA. The first BotApp smoke exposed
a projection-order bug: the canonical lifecycle was enriched after the initial
filter. Commit `6fdaf47` applies the tombstone exclusion after each enrichment.
After the production deploy and a desktop cache-only relaunch, BotApp reports
four active backend profiles globally instead of five; Rex and its tombstone are
absent, while `j_automatise_pour_toi` and `lorielebras_autom` remain visible.

Supabase advisors report one intentional informational notice (`RLS enabled, no
policy`) for the service-role-only audit table and four informational unindexed
foreign-key notices. No public policy was added: table grants remain revoked for
`public`, `anon`, and `authenticated`. The audit volume is intentionally small,
so the optional FK indexes are deferred.

Worker and BotApp binaries were not changed. No phone, ADB, scheduler, Auto
Login, run, request, or onboarding action was performed. BotApp itself was
restarted only to clear its read cache after the shared backend deployment.

`READY_TO_RESTART_ONBOARDING = YES`. The operator retains the only authority to
start the next onboarding manually.
