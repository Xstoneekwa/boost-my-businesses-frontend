-- Emergency rollback: restore the pre-fix overview projection.
-- This intentionally re-applies the canonical function body from
-- 20260724180000_incident_overview_retention_v1.sql.
\ir ../migrations/20260724180000_incident_overview_retention_v1.sql
