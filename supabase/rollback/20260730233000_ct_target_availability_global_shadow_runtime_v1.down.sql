-- Roll back only the additive Target Availability global Shadow runtime layer.
-- Existing observations, identity, assessments and current-state V1 tables are
-- intentionally preserved.

revoke all on function public.persist_target_availability_pipeline_v1(uuid,jsonb,text) from service_role;
revoke all on function public.trigger_target_availability_auto_kill_v1(text,text,jsonb) from service_role;
revoke all on function public.release_target_availability_pipeline_lease_v1(uuid) from service_role;
revoke all on function public.claim_target_availability_pipeline_lease_v1(text,text,integer,integer) from service_role;
revoke all on function public.claim_target_availability_observation_capacity_v1(uuid,uuid,integer,integer,integer) from service_role;
revoke all on function public.claim_target_availability_projection_capacity_v1(uuid,uuid,integer,integer,integer,integer,integer,integer) from service_role;

drop function if exists public.persist_target_availability_pipeline_v1(uuid,jsonb,text);
drop function if exists public.trigger_target_availability_auto_kill_v1(text,text,jsonb);
drop function if exists public.release_target_availability_pipeline_lease_v1(uuid);
drop function if exists public.claim_target_availability_pipeline_lease_v1(text,text,integer,integer);
drop function if exists public.claim_target_availability_observation_capacity_v1(uuid,uuid,integer,integer,integer);
drop function if exists public.claim_target_availability_projection_capacity_v1(uuid,uuid,integer,integer,integer,integer,integer,integer);

drop trigger if exists ct_target_availability_pipeline_metrics_append_only
  on public.ct_target_availability_pipeline_metrics;

drop table if exists public.ct_target_availability_pipeline_leases;
drop table if exists public.ct_target_availability_cap_counters;
drop table if exists public.ct_target_availability_alert_events;
drop table if exists public.ct_target_availability_pipeline_metrics;
drop table if exists public.ct_target_availability_processing_checkpoints;
drop table if exists public.ct_target_availability_runtime_state;
