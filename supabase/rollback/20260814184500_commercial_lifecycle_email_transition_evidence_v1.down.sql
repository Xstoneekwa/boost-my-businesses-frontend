drop trigger if exists commercial_lifecycle_email_transition_evidence_v1
  on public.commercial_account_lifecycle_operations;

drop function if exists public.project_commercial_lifecycle_email_transition_evidence_v1();

drop index if exists public.ig_action_logs_commercial_lifecycle_operation_evidence_uidx;

-- Intentionally preserve any audit evidence emitted while the trigger was active.
