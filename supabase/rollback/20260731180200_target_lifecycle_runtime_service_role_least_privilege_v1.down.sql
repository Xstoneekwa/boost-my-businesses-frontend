begin;

-- Restore the privilege state created by the preceding Lifecycle runtime
-- migration. Use only when rolling back the complete Lifecycle deployment.
revoke all on table
  public.ct_target_lifecycle_runtime_state,
  public.ct_target_lifecycle_processing_checkpoints,
  public.ct_target_lifecycle_pipeline_metrics,
  public.ct_target_lifecycle_alert_events,
  public.ct_target_lifecycle_cap_counters,
  public.ct_target_lifecycle_pipeline_leases
from service_role;

grant all privileges on table
  public.ct_target_lifecycle_runtime_state,
  public.ct_target_lifecycle_processing_checkpoints,
  public.ct_target_lifecycle_pipeline_metrics,
  public.ct_target_lifecycle_alert_events,
  public.ct_target_lifecycle_cap_counters,
  public.ct_target_lifecycle_pipeline_leases
to service_role;

commit;
