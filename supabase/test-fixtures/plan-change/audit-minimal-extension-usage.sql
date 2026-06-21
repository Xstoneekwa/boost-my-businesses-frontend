-- Extension/type usage audit for minimal 10-table scope (source DB zgafnshkjywfltxgbtzg).
-- Only extensions/types referenced by scope tables, constraints and indexes.
-- Do not infer requirements from globally installed extensions alone.

BEGIN TRANSACTION READ ONLY;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

\echo '=== Installed extensions (catalog inventory — not auto-required) ==='
SELECT e.extname AS extension_name, n.nspname AS schema_name
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY e.extname;

\echo '=== User-defined types used by scope table columns ==='
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
ORDER BY c.udt_name, c.table_name;

\echo '=== Extension dependencies via column/index types in scope ==='
WITH scope(name) AS (
  VALUES
    ('clients'), ('ig_devices'), ('ig_accounts'), ('tenant_users'), ('client_users'),
    ('client_subscriptions'), ('client_instagram_accounts'), ('commercial_checkout_sessions'),
    ('client_account_entitlements'), ('commercial_checkout_audit_events')
),
scope_types(type_oid) AS (
  SELECT DISTINCT t.oid
  FROM information_schema.columns c
  JOIN scope s ON s.name = c.table_name
  JOIN pg_type t ON t.typname = c.udt_name
  JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = c.udt_schema
  WHERE c.table_schema = 'public'
  UNION
  SELECT DISTINCT t.oid
  FROM pg_index ix
  JOIN pg_class tbl ON tbl.oid = ix.indrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  JOIN scope s ON s.name = tbl.relname
  JOIN pg_class idx ON idx.oid = ix.indexrelid
  JOIN pg_am am ON am.oid = idx.relam
  JOIN pg_type t ON t.oid = am.typoid
  WHERE ns.nspname = 'public'
)
SELECT DISTINCT
  e.extname AS extension_name,
  d.classid::regclass AS dependent_class,
  d.objid::regclass AS dependent_object
FROM pg_depend d
JOIN pg_extension e ON e.oid = d.refobjid
JOIN scope_types st ON st.type_oid = d.objid
ORDER BY e.extname;

\echo '=== Operator class / index method usage in scope (no indexdef) ==='
WITH scope(name) AS (
  VALUES
    ('clients'), ('ig_devices'), ('ig_accounts'), ('tenant_users'), ('client_users'),
    ('client_subscriptions'), ('client_instagram_accounts'), ('commercial_checkout_sessions'),
    ('client_account_entitlements'), ('commercial_checkout_audit_events')
)
SELECT DISTINCT
  tbl.relname AS table_name,
  idx.relname AS index_name,
  am.amname AS index_method
FROM pg_index ix
JOIN pg_class idx ON idx.oid = ix.indexrelid
JOIN pg_class tbl ON tbl.oid = ix.indrelid
JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
JOIN pg_am am ON am.oid = idx.relam
JOIN scope s ON s.name = tbl.relname
WHERE ns.nspname = 'public'
ORDER BY tbl.relname, idx.relname;

ROLLBACK;
