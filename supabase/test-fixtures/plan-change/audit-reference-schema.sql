-- Catalogue-only audit: canonical reference DB (zgafnshkjywfltxgbtzg).
-- Metadata only — pg_catalog / information_schema / pg_policies. No row reads, no SQL bodies.

BEGIN TRANSACTION READ ONLY;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

\echo '=== 1. Required baseline/checkout tables (catalog presence) ==='
SELECT
  required.name AS table_name,
  CASE WHEN t.table_name IS NOT NULL THEN 'present' ELSE 'missing' END AS catalog_status
FROM (
  VALUES
    ('clients'),
    ('ig_devices'),
    ('ig_accounts'),
    ('tenant_users'),
    ('client_users'),
    ('client_subscriptions'),
    ('client_instagram_accounts'),
    ('commercial_checkout_sessions'),
    ('client_account_entitlements'),
    ('commercial_checkout_audit_events')
) AS required(name)
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public'
 AND t.table_name = required.name
ORDER BY required.name;

\echo '=== 2. Forbidden Plan Change objects (must be absent) ==='
SELECT
  forbidden.name AS object_name,
  forbidden.kind AS expected_kind,
  CASE
    WHEN forbidden.kind = 'table' AND t.table_name IS NOT NULL THEN 'present'
    WHEN forbidden.kind = 'function' AND p.proname IS NOT NULL THEN 'present'
    ELSE 'absent'
  END AS catalog_status
FROM (
  VALUES
    ('commercial_plan_change_quotes', 'table'),
    ('client_credit_ledger', 'table'),
    ('activate_commercial_plan_change', 'function')
) AS forbidden(name, kind)
LEFT JOIN information_schema.tables t
  ON forbidden.kind = 'table'
 AND t.table_schema = 'public'
 AND t.table_name = forbidden.name
LEFT JOIN pg_proc p
  ON forbidden.kind = 'function'
 AND p.pronamespace = 'public'::regnamespace
 AND p.proname = forbidden.name
ORDER BY forbidden.name;

\echo '=== 3. Installed extensions (catalog) ==='
SELECT e.extname AS extension_name, n.nspname AS schema_name
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY e.extname;

\echo '=== 4. External schema catalog objects (auth) ==='
SELECT table_schema, table_name, 'table' AS object_kind
FROM information_schema.tables
WHERE table_schema = 'auth'
  AND table_name IN ('users', 'identities', 'sessions')
ORDER BY table_name;

\echo '=== 5. Public enums and composite types (catalog) ==='
SELECT n.nspname AS schema_name, t.typname AS type_name, t.typtype AS type_kind
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typtype IN ('e', 'c')
ORDER BY t.typname;

\echo '=== 6. Public functions (signatures + security definer flag) ==='
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS signature,
  p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;

\echo '=== 7. Public triggers (catalog) ==='
SELECT tg.tgname AS trigger_name, c.relname AS table_name
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT tg.tgisinternal
ORDER BY c.relname, tg.tgname;

\echo '=== 8. Roles cited on public objects (catalog grants) ==='
SELECT DISTINCT grantee AS role_name
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
ORDER BY grantee;

\echo '=== 9. RLS enabled + policy names (metadata only) ==='
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  pol.polname AS policy_name,
  pol.polcmd AS policy_cmd
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy pol ON pol.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname, pol.polname;

\echo '=== 10. Foreign-key dependencies outside public (catalog) ==='
SELECT DISTINCT
  ccu.table_schema AS foreign_schema,
  ccu.table_name AS foreign_table,
  tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND ccu.table_schema <> 'public'
ORDER BY foreign_schema, foreign_table, tc.constraint_name;

ROLLBACK;
