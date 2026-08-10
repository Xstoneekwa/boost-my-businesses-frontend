begin;

-- Data reconciliation is intentionally not reversed: restoring
-- proven_false_ready would discard the successful pre-gate login evidence.
-- This rollback exists to document that the migration creates no persistent
-- schema object, grant, policy, trigger, or function to remove.

commit;
