-- PSQL ONLY — not compatible with Supabase SQL Editor (\echo meta-commands).
-- Minimal baseline contract audit (source DB zgafnshkjywfltxgbtzg).
-- Run via psql from your terminal, OR copy each SELECT block individually into SQL Editor.
-- Catalogue-only, read-only. Compact metadata per table: columns, constraints, indexes, RLS, triggers, deps.
-- Forbidden: row reads, SELECT *, function/policy bodies, mutating SQL.

BEGIN TRANSACTION READ ONLY;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

\echo '=== 0. Scope tables (10 public baseline tables) ==='
WITH scope(name) AS (
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
)
SELECT
  scope.name AS table_name,
  CASE WHEN t.table_name IS NOT NULL THEN 'present' ELSE 'missing' END AS catalog_status
FROM scope
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public'
 AND t.table_name = scope.name
ORDER BY scope.name;

\echo '=== 1. Columns (name, type, nullable, identity, default present) ==='
WITH scope(name) AS (
  VALUES
    ('clients'), ('ig_devices'), ('ig_accounts'), ('tenant_users'), ('client_users'),
    ('client_subscriptions'), ('client_instagram_accounts'), ('commercial_checkout_sessions'),
    ('client_account_entitlements'), ('commercial_checkout_audit_events')
)
SELECT
  c.table_name,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.is_identity,
  c.identity_generation,
  c.column_default IS NOT NULL AS has_default
FROM information_schema.columns c
JOIN scope s ON s.name = c.table_name
WHERE c.table_schema = 'public'
ORDER BY c.table_name, c.ordinal_position;

\echo '=== 2. Constraints (name, category, columns — no expression bodies) ==='
WITH scope(name) AS (
  VALUES
    ('clients'), ('ig_devices'), ('ig_accounts'), ('tenant_users'), ('client_users'),
    ('client_subscriptions'), ('client_instagram_accounts'), ('commercial_checkout_sessions'),
    ('client_account_entitlements'), ('commercial_checkout_audit_events')
)
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS column_names,
  ccu.table_schema AS foreign_schema,
  ccu.table_name AS foreign_table
FROM information_schema.table_constraints tc
JOIN scope s ON s.name = tc.table_name
LEFT JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
LEFT JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_type = 'FOREIGN KEY'
 AND tc.constraint_name = ccu.constraint_name
 AND tc.table_schema = ccu.table_schema
WHERE tc.table_schema = 'public'
GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type, ccu.table_schema, ccu.table_name
ORDER BY tc.table_name, tc.constraint_name;

\echo '=== 3. Indexes (name, unique, method, columns — no indexdef) ==='
WITH scope(name) AS (
  VALUES
    ('clients'), ('ig_devices'), ('ig_accounts'), ('tenant_users'), ('client_users'),
    ('client_subscriptions'), ('client_instagram_accounts'), ('commercial_checkout_sessions'),
    ('client_account_entitlements'), ('commercial_checkout_audit_events')
)
SELECT
  tbl.relname AS table_name,
  idx.relname AS index_name,
  ix.indisunique AS is_unique,
  am.amname AS index_method,
  array_agg(att.attname ORDER BY keys.ord) AS column_names
FROM pg_index ix
JOIN pg_class idx ON idx.oid = ix.indexrelid
JOIN pg_class tbl ON tbl.oid = ix.indrelid
JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
JOIN pg_am am ON am.oid = idx.relam
JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS keys(attnum, ord) ON keys.attnum > 0
JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = keys.attnum
JOIN scope s ON s.name = tbl.relname
WHERE ns.nspname = 'public'
GROUP BY tbl.relname, idx.relname, ix.indisunique, am.amname
ORDER BY tbl.relname, idx.relname;

\echo '=== 4. RLS enabled + policy names/types only ==='
WITH scope(name) AS (
  VALUES
    ('clients'), ('ig_devices'), ('ig_accounts'), ('tenant_users'), ('client_users'),
    ('client_subscriptions'), ('client_instagram_accounts'), ('commercial_checkout_sessions'),
    ('client_account_entitlements'), ('commercial_checkout_audit_events')
)
SELECT
  ns.nspname AS schema_name,
  tbl.relname AS table_name,
  tbl.relrowsecurity AS rls_enabled,
  pol.polname AS policy_name,
  pol.polcmd AS policy_cmd
FROM pg_class tbl
JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
JOIN scope s ON s.name = tbl.relname
LEFT JOIN pg_policy pol ON pol.polrelid = tbl.oid
WHERE ns.nspname = 'public'
  AND tbl.relkind = 'r'
ORDER BY tbl.relname, pol.polname;

\echo '=== 5. Triggers in minimal scope (name, table, timing, function signature) ==='
WITH scope(name) AS (
  VALUES
    ('clients'), ('ig_devices'), ('ig_accounts'), ('tenant_users'), ('client_users'),
    ('client_subscriptions'), ('client_instagram_accounts'), ('commercial_checkout_sessions'),
    ('client_account_entitlements'), ('commercial_checkout_audit_events')
),
allowed_functions(name) AS (
  VALUES ('set_updated_at'), ('validate_client_subscription_type')
)
SELECT
  tbl.relname AS table_name,
  tg.tgname AS trigger_name,
  CASE
    WHEN tg.tgtype & 2 = 2 THEN 'BEFORE'
    WHEN tg.tgtype & 64 = 64 THEN 'INSTEAD OF'
    ELSE 'AFTER'
  END AS trigger_timing,
  CASE
    WHEN tg.tgtype & 4 = 4 THEN 'INSERT'
    WHEN tg.tgtype & 8 = 8 THEN 'DELETE'
    WHEN tg.tgtype & 16 = 16 THEN 'UPDATE'
    ELSE 'OTHER'
  END AS trigger_event,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS function_signature,
  p.prosecdef AS security_definer,
  CASE WHEN af.name IS NOT NULL THEN 'in_scope' ELSE 'out_of_scope' END AS scope_status
FROM pg_trigger tg
JOIN pg_class tbl ON tbl.oid = tg.tgrelid
JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
JOIN pg_proc p ON p.oid = tg.tgfoid
JOIN scope s ON s.name = tbl.relname
LEFT JOIN allowed_functions af ON af.name = p.proname
WHERE ns.nspname = 'public'
  AND NOT tg.tgisinternal
ORDER BY tbl.relname, tg.tgname;

\echo '=== 6. External auth dependencies (catalog only) ==='
WITH scope(name) AS (
  VALUES
    ('clients'), ('ig_devices'), ('ig_accounts'), ('tenant_users'), ('client_users'),
    ('client_subscriptions'), ('client_instagram_accounts'), ('commercial_checkout_sessions'),
    ('client_account_entitlements'), ('commercial_checkout_audit_events')
)
SELECT DISTINCT
  tc.table_name,
  ccu.table_schema AS foreign_schema,
  ccu.table_name AS foreign_table
FROM information_schema.table_constraints tc
JOIN scope s ON s.name = tc.table_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
 AND tc.table_schema = ccu.table_schema
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_schema <> 'public'
ORDER BY tc.table_name, foreign_schema, foreign_table;

\echo '=== 7. Custom types referenced by scope tables ==='
WITH scope(name) AS (
  VALUES
    ('clients'), ('ig_devices'), ('ig_accounts'), ('tenant_users'), ('client_users'),
    ('client_subscriptions'), ('client_instagram_accounts'), ('commercial_checkout_sessions'),
    ('client_account_entitlements'), ('commercial_checkout_audit_events')
)
SELECT DISTINCT
  c.table_name,
  c.column_name,
  c.udt_schema,
  c.udt_name,
  t.typtype AS type_kind
FROM information_schema.columns c
JOIN scope s ON s.name = c.table_name
JOIN pg_type t ON t.typname = c.udt_name
JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = c.udt_schema
WHERE c.table_schema = 'public'
  AND c.data_type = 'USER-DEFINED'
ORDER BY c.table_name, c.column_name;

\echo '=== 8. Roles/grants metadata on scope tables ==='
WITH scope(name) AS (
  VALUES
    ('clients'), ('ig_devices'), ('ig_accounts'), ('tenant_users'), ('client_users'),
    ('client_subscriptions'), ('client_instagram_accounts'), ('commercial_checkout_sessions'),
    ('client_account_entitlements'), ('commercial_checkout_audit_events')
)
SELECT DISTINCT
  g.table_name,
  g.grantee AS role_name,
  g.privilege_type
FROM information_schema.role_table_grants g
JOIN scope s ON s.name = g.table_name
WHERE g.table_schema = 'public'
ORDER BY g.table_name, g.grantee, g.privilege_type;

ROLLBACK;
