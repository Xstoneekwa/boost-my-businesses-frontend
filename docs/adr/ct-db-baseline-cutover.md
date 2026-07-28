# ADR — CT database baseline cutover

## Status

Accepted for local deployment-package preparation. No production change is authorized by this ADR.

## Context

At capture time, Supabase production recorded 169 migrations. The repository contained 67 SQL migration files: 151 production versions were absent locally, 49 local versions were absent from production, and 46 same-name families used different timestamps. Historical Git sources therefore cannot recreate the observed database without assumptions.

## Decision

Adopt a canonical schema baseline at cutover `20260728001632`, immediately after `restrict_dm_counter_table_to_service_role_v1`. The normalized schema-only capture is `supabase/baseline/20260728001632_public_schema.sql`; its manifest and hashes are authoritative for bootstrap.

The baseline is bootstrap-only and non-replayable on an existing project. Production already contains it implicitly. All future migrations must have a unique version greater than the cutover.

## Alternatives

- Reconstruct all historical migrations: rejected because sources and applied timestamps diverge and replay can execute obsolete stateful assumptions.
- Continue with the local migration directory: rejected because it is not the production history.
- Baseline cutover: selected because it preserves current structure exactly and creates a deterministic future chain.

## Consequences

- Existing production: never run the compatibility file or baseline; manually review only post-cutover migrations.
- New environment: provision Supabase platform schemas/extensions, apply baseline once, register the cutover, then apply post-cutover migrations.
- Plain PostgreSQL CI: apply `0000_local_platform_compatibility.sql`, baseline, then post-cutover migrations.
- Developers: detect state; never auto-repair migration history.
- Historical replay before cutover is intentionally unsupported. The old SQL directory remains evidence, not a rebuild recipe.

## Rollback

Bootstrap rollback is environment disposal. Post-cutover rollback is forward-only and contract-specific; see `docs/ct-database-rollback-runbook.md`. No automatic downgrade or migration-history repair is permitted.
