-- Emergency rollback for Target Lifecycle V1 global Shadow.
-- Existing lifecycle assessment/current rows are retained. The rollback removes
-- only the runtime contract, projections metadata and scheduler-facing RPCs.

drop function if exists public.deactivate_target_lifecycle_global_shadow_v1(text);
drop function if exists public.activate_target_lifecycle_global_shadow_v1(bigint,text);
drop function if exists public.trigger_target_lifecycle_auto_kill_v1(text,text,jsonb);
drop function if exists public.record_target_lifecycle_pipeline_metric_v1(text,jsonb,numeric,numeric,numeric,numeric,bigint,bigint);
drop function if exists public.advance_target_lifecycle_scan_cursor_v1(bigint,uuid,boolean);
drop function if exists public.persist_target_lifecycle_shadow_v1(jsonb,text);
drop function if exists public.release_target_lifecycle_pipeline_lease_v1(uuid);
drop function if exists public.claim_target_lifecycle_pipeline_lease_v1(text,text,integer,integer);
drop function if exists public.claim_target_lifecycle_assessment_capacity_v1(uuid,uuid,integer,integer,text);
drop function if exists public.list_target_lifecycle_work_v1(uuid,integer);

drop trigger if exists ct_target_lifecycle_pipeline_metrics_append_only on public.ct_target_lifecycle_pipeline_metrics;
drop table if exists public.ct_target_lifecycle_pipeline_leases;
drop table if exists public.ct_target_lifecycle_cap_counters;
drop table if exists public.ct_target_lifecycle_alert_events;
drop table if exists public.ct_target_lifecycle_pipeline_metrics;
drop table if exists public.ct_target_lifecycle_processing_checkpoints;
drop table if exists public.ct_target_lifecycle_runtime_state;

alter table public.ct_target_lifecycle_current
  drop column if exists policy_revision,
  drop column if exists engine_revision,
  drop column if exists policy_version,
  drop column if exists engine_version,
  drop column if exists source_max_observed_at,
  drop column if exists status;

alter table public.ct_target_lifecycle_assessments
  drop constraint if exists ct_target_lifecycle_assessments_versions_v1_check,
  drop constraint if exists ct_target_lifecycle_assessments_recommendation_v1_check,
  drop constraint if exists ct_target_lifecycle_assessments_shadow_only_v1_check,
  drop constraint if exists ct_target_lifecycle_assessments_domains_v1_check,
  drop column if exists processor_release,
  drop column if exists mutation_executed,
  drop column if exists business_action_allowed,
  drop column if exists enforcement_allowed,
  drop column if exists explanation_safe,
  drop column if exists policy_revision,
  drop column if exists engine_revision,
  drop column if exists policy_version,
  drop column if exists rule_version,
  drop column if exists engine_version,
  drop column if exists valid_until,
  drop column if exists recommended_action,
  drop column if exists missing_evidence,
  drop column if exists source_max_observed_at,
  drop column if exists source_availability_assessment_id,
  drop column if exists source_fingerprint,
  drop column if exists identity_status,
  drop column if exists utilization_status,
  drop column if exists performance_status,
  drop column if exists availability_status;

-- Preserve the safer least-privilege grants introduced by the forward migration.
-- RLS remains enabled and forced; rolling back runtime must never weaken access.
