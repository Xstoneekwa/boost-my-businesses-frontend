-- Catalogue-only audit: isolated test DB (nxntngkhkoynljcagmkq).
-- Metadata only — confirm empty public baseline before harness apply.

BEGIN TRANSACTION READ ONLY;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

\echo '=== 1. Public applicative tables (expect missing before harness) ==='
SELECT
  required.name AS table_name,
  CASE WHEN t.table_name IS NULL THEN 'missing' ELSE 'present' END AS catalog_status
FROM (
  VALUES
    ('clients'),
    ('ig_accounts'),
    ('tenant_users'),
    ('client_users'),
    ('client_subscriptions'),
    ('client_instagram_accounts'),
    ('commercial_checkout_sessions'),
    ('client_account_entitlements'),
    ('commercial_checkout_audit_events'),
    ('commercial_plan_change_quotes'),
    ('client_credit_ledger')
) AS required(name)
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public'
 AND t.table_name = required.name
ORDER BY required.name;

\echo '=== 2. Forbidden Plan Change RPC (must be absent) ==='
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS signature,
  p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'activate_commercial_plan_change';

\echo '=== 3. auth.users catalog availability (no row reads) ==='
SELECT table_schema, table_name, 'table' AS object_kind
FROM information_schema.tables
WHERE table_schema = 'auth'
  AND table_name = 'users';

\echo '=== 4. Installed extensions (catalog) ==='
SELECT e.extname AS extension_name, n.nspname AS schema_name
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY e.extname;

\echo '=== 5. Roles available for GRANT targets (catalog) ==='
SELECT rolname AS role_name
FROM pg_roles
WHERE rolname IN ('service_role', 'anon', 'authenticated', 'postgres', 'PUBLIC')
ORDER BY rolname;

ROLLBACK;
