# CT database local validation report

Date: 2026-07-28 (Africa/Johannesburg)

## Scope and safety boundary

This report covers the local database package for CT Premium phases 5 to 7.
No production migration, data write, CT run, Worker action, BotApp action,
notification delivery, Stripe action, or deployment was performed.

## Phase 8B security forward-fix addendum

The production Phase 8B window applied migrations `20260728132018`,
`20260728132019` and `20260728132020`, then stopped before the RPC migration
because the historical table-level `UPDATE` grant on
`client_account_notifications` made the column-level revoke ineffective.

Migration
`20260728185253_fix_client_account_notifications_global_grants_v1.sql`
removes all table and column access from `PUBLIC`, `anon` and `authenticated`,
preserves the service-role notification workflows, keeps RLS enabled and adds
no policy. Its certified SHA-256 is
`3230904571d2b278124499e37496376b48e1e2c86da016d6006de5c181ccc4a8`.

Two fresh local reconstructions applied baseline, migrations 1–3, the
forward-fix and migration 4. Both produced structural hash
`29daba6f204c673b648fe96f285d1ecf`. Direct SELECT/INSERT/UPDATE/DELETE probes
were denied for `anon` and `authenticated`; the historical service-role
insert/update/delete transaction passed and rolled back. The CT SQL contract,
security contract and concurrency workload passed.

The broad `postgres` and `supabase_admin` default table privileges in schema
`public` remain unchanged. They are the source of the original direct grants,
but changing them globally is outside this minimal forward-fix and requires a
separate inventory of all future Data API exposure contracts.

## Baseline recovery

- Production migration history observed: 169 entries.
- Local migration files observed before the cutover package: 67.
- Production versions absent locally: 151.
- Local versions absent from production: 49.
- Same-name migrations with different timestamps: 46 families.
- Selected strategy: immutable schema-only baseline at production cutover
  `20260728001632`, followed by an explicit post-cutover migration allowlist.
- The historical local migration directory is not considered replay-safe and
  must not be passed to an unreviewed raw `supabase db push`.

The schema-only production capture contains no table data (`COPY` or `INSERT`)
and no production credentials. Its SHA-256 is
`d3464b5712e19c6e1f4dd1eb2be8df740afd03c6f407faee61ece71fe74f3d6f`.

## Reconstruction evidence

Two independent fresh local PostgreSQL databases completed the bootstrap,
baseline, four post-cutover CT migrations, fixtures, SQL contract, structural
hash and concurrency workload.

Both reconstructions produced the same final structural hash:

`29daba6f204c673b648fe96f285d1ecf`

The recovered baseline matched production for the following inventories:

| Object family | Count |
| --- | ---: |
| Tables | 168 |
| Views | 18 |
| Sequences | 6 |
| Functions | 498 |
| Application functions compared definition-by-definition | 192 |
| RLS policies | 91 |
| Triggers | 79 |

All 192 application function definitions matched. Column, constraint, index,
view, trigger, and policy signatures also matched production.

## Contract validation

- SQL functional/security contract: passed twice.
- True concurrent decisions, activations and J+5 claims: passed twice.
- Baseline non-replay/allowlist contract: passed.
- CT Premium/shadow/lifecycle tests: 66 passed.
- Generated database types: deterministic across two rebuilds.
- New adapter strict TypeScript compilation: passed.
- Fail-closed adapter tests: passed.

## Global build gate

The repository-wide Next.js 16.2.1 production build passed with webpack:
application compilation, TypeScript validation, page-data collection, all 36
static pages and build-trace collection completed successfully. The build used
the dependency tree already certified on the same application baseline; the
temporary dependency link was removed after the run and introduced no
repository change.

## Verdict

- `DATABASE_BASELINE_CUTOVER_CERTIFIED`
- `CT_DATABASE_CONTRACT_IMPLEMENTED`
- `CT_DATABASE_SECURITY_CERTIFIED`
- `CT_DATABASE_TRANSACTIONAL_FLOWS_CERTIFIED`
- `CT_DATABASE_LOCAL_REBUILD_CERTIFIED`
- `CT_DATABASE_NON_REPLAY_CERTIFIED`
- `CT_DATABASE_FORWARD_FIX_CERTIFIED`
- `CT_DATABASE_GLOBAL_BUILD_CERTIFIED`
- `GO_FOR_CONTROLLED_FORWARD_FIX_DEPLOYMENT`
- `NO_PRODUCTION_CHANGE_PERFORMED`
