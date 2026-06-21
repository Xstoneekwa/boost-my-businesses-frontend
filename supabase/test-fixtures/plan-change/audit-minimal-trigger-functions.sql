-- Minimal trigger function audit (source DB zgafnshkjywfltxgbtzg).
-- Catalogue-only: presence, signature, SECURITY DEFINER flag only.

BEGIN TRANSACTION READ ONLY;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

\echo '=== Required minimal trigger functions ==='
WITH required(name) AS (
  VALUES ('set_updated_at'), ('validate_client_subscription_type')
)
SELECT
  required.name AS function_name,
  CASE WHEN p.proname IS NOT NULL THEN 'present' ELSE 'missing' END AS catalog_status,
  pg_get_function_identity_arguments(p.oid) AS signature,
  p.prosecdef AS security_definer
FROM required
LEFT JOIN pg_proc p ON p.proname = required.name
LEFT JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public';

\echo '=== Excluded scheduler trigger (must remain out of harness) ==='
SELECT
  tg.tgname AS trigger_name,
  tbl.relname AS table_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS signature,
  p.prosecdef AS security_definer,
  CASE
    WHEN tg.tgtype & 2 = 2 THEN 'BEFORE'
    WHEN tg.tgtype & 64 = 64 THEN 'INSTEAD OF'
    ELSE 'AFTER'
  END AS trigger_timing
FROM pg_trigger tg
JOIN pg_class tbl ON tbl.oid = tg.tgrelid
JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
JOIN pg_proc p ON p.oid = tg.tgfoid
WHERE ns.nspname = 'public'
  AND tbl.relname = 'ig_accounts'
  AND tg.tgname = 'ig_accounts_release_schedule_capacity_on_admin_lifecycle'
  AND NOT tg.tgisinternal;

ROLLBACK;
