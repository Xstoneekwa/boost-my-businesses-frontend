# CT database local validation report

Date: 2026-07-28 (Africa/Johannesburg)

## Scope and safety boundary

This report covers the local database package for CT Premium phases 5 to 7.
No production migration, data write, CT run, Worker action, BotApp action,
notification delivery, Stripe action, or deployment was performed.

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

## Remaining gate

The repository-wide Next.js build compiled the application code successfully
with webpack, then failed during route validation because the pre-existing file
`app/api/instagram-client/notifications/route.ts` exports
`buildClientNotificationsUnavailablePatchResponse`, which Next.js does not
permit as a route-module export. The file is outside this CT database change
set and was not modified.

Accordingly, the database-specific gates are certified, but the branch must
not be pushed or deployed under the requested all-critical-gates-green policy
until the unrelated repository build baseline is repaired and the full build
is rerun.

## Verdict

- `DATABASE_BASELINE_CUTOVER_CERTIFIED`
- `CT_DATABASE_CONTRACT_IMPLEMENTED`
- `CT_DATABASE_SECURITY_CERTIFIED`
- `CT_DATABASE_TRANSACTIONAL_FLOWS_CERTIFIED`
- `CT_DATABASE_LOCAL_REBUILD_CERTIFIED`
- `CT_DATABASE_NON_REPLAY_CERTIFIED`
- `CT_DATABASE_VALIDATION_BLOCKED`
- `NO_GO_FOR_PRODUCTION_DEPLOYMENT`
- `NO_PRODUCTION_CHANGE_PERFORMED`
