begin;

-- The runtime tables are mutated only through SECURITY DEFINER RPCs. Keep the
-- direct service_role surface read-only and fail closed for browser roles.
revoke all on table
  public.ct_target_lifecycle_runtime_state,
  public.ct_target_lifecycle_processing_checkpoints,
  public.ct_target_lifecycle_pipeline_metrics,
  public.ct_target_lifecycle_alert_events,
  public.ct_target_lifecycle_cap_counters,
  public.ct_target_lifecycle_pipeline_leases
from public, anon, authenticated, service_role;

grant select on table
  public.ct_target_lifecycle_runtime_state,
  public.ct_target_lifecycle_processing_checkpoints,
  public.ct_target_lifecycle_pipeline_metrics,
  public.ct_target_lifecycle_alert_events,
  public.ct_target_lifecycle_cap_counters,
  public.ct_target_lifecycle_pipeline_leases
to service_role;

commit;
