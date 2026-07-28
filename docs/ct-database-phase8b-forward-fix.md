# CT database Phase 8B forward-fix

## Incident

Migration `20260728132020` attempted to revoke UPDATE on five CT notification
columns from `PUBLIC`, `anon` and `authenticated`. Production still exposed a
table-level `ALL` ACL to `anon` and `authenticated`, so Postgres continued to
calculate UPDATE as allowed at the table and column privilege layer.

RLS was enabled and the table had no policies, so no row access was observed.
The grant contract nevertheless failed and migration 4 was correctly blocked.

## Provenance and dependencies

The table is owned by `postgres`. Its direct ACL was generated from the
existing `postgres` default table privileges for schema `public`, which grant
all table privileges to `anon`, `authenticated` and `service_role` when a table
is created. No relevant inherited parent-role grant was found.

All application readers and writers use `createSupabaseClient()` on the server,
which requires `SUPABASE_SERVICE_ROLE_KEY`. No browser, Worker, BotApp, anon or
authenticated direct mutation of `client_account_notifications` is required.

## Compensating contract

`20260728185253_fix_client_account_notifications_global_grants_v1.sql`:

- revokes all table privileges from `PUBLIC`, `anon` and `authenticated`;
- preserves all existing service-role privileges;
- leaves the owner, rows, columns, constraints and indexes unchanged;
- requires RLS to remain enabled;
- creates no policy;
- verifies effective table and column privileges inside the migration;
- aborts atomically if any forbidden privilege remains.

The global default privileges are not changed. This keeps the forward-fix
object-scoped and prevents accidental access changes on unrelated tables.

## Certified allowlist

| Order | Migration | SHA-256 |
| ---: | --- | --- |
| 1 | `20260728132018_ct_target_evaluation_performance_lifecycle_v1.sql` | `93844f97c75b92af6249c987b41d84f4fd22417e1701dc006a87d296b5337aea` |
| 2 | `20260728132019_ct_premium_proposals_and_action_contracts_v1.sql` | `99c3e48eceab24b1646a2053254a3337c05079080b3ac09a3a5d933243250517` |
| 3 | `20260728132020_ct_system_rls_and_grants_v1.sql` | `dd4b108c99c7809fd20b6448be6899d5a3a036b817e3fd647de7fb3077ff4e8f` |
| 4 | `20260728185253_fix_client_account_notifications_global_grants_v1.sql` | `3230904571d2b278124499e37496376b48e1e2c86da016d6006de5c181ccc4a8` |
| 5 | `20260728132021_ct_system_transactional_rpcs_v1.sql` | `1470a0a2aba80c69f4f6c2e6c4f5e9059839ac8e03b1ab8d57f21a35f58439f8` |

Production application order for the two remaining files is forward-fix first,
then the original RPC migration with `--include-all`. No history repair or
baseline replay is permitted.
