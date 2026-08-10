begin;

-- Internal orchestration and maintenance RPCs are called only by trusted
-- Backend/Worker service clients or by database triggers. Their SECURITY
-- DEFINER bodies bypass table RLS, so browser roles must never inherit EXECUTE.
revoke execute on function
  public._device_ui_lease_audit(uuid, uuid, text, text, text, uuid, uuid, text, jsonb),
  public.acquire_device_ui_lease(uuid, text, uuid, uuid, integer, text, text, text),
  public.assign_account_manual_only(uuid, uuid, uuid, text, uuid),
  public.auto_restart_bind_device_lock_to_request(uuid, text, uuid, integer),
  public.auto_restart_release_device_lock(uuid, text, uuid, text),
  public.auto_restart_renew_device_lock(uuid, text, uuid, integer),
  public.auto_restart_transfer_device_lock(uuid, uuid, text, integer),
  public.backfill_ig_target_followbacks(integer),
  public.bind_scheduled_session_preflight_request(uuid, uuid, uuid),
  public.claim_next_dm_job(uuid, text, public.dm_type),
  public.complete_scheduled_session_preflight(uuid, text, text, timestamptz, jsonb),
  public.enqueue_outreach_dm_job(uuid, text, text, uuid, public.dm_job_source, uuid, integer, jsonb),
  public.enqueue_welcome_dm_job_if_eligible(uuid, text, uuid, text, uuid, integer),
  public.evaluate_account_schedule_gate(uuid, text, text),
  public.get_active_operator_stop_suppression(uuid, timestamptz),
  public.get_valid_scheduled_session_preflight(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, timestamptz),
  public.handle_new_user(),
  public.handoff_preflight_device_lock_to_request(uuid, uuid, uuid, text, integer),
  public.mark_dm_job_running(uuid),
  public.reconcile_stale_device_ui_leases(integer),
  public.release_device_ui_lease(uuid, text, uuid, text),
  public.release_dm_job_after_dry_run(uuid, text, boolean, text, jsonb),
  public.renew_device_ui_lease(uuid, text, uuid, integer),
  public.rls_auto_enable(),
  public.sync_client_subscription_entitlements(uuid),
  public.sync_ig_account_target_followbacks(uuid),
  public.sync_ig_target_followbacks_count(uuid, boolean),
  public.upsert_account_follower_seen(uuid, text, uuid, boolean),
  public.upsert_operator_stop_suppression(uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, timestamptz, jsonb),
  public.upsert_scheduled_session_preflight(uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, timestamptz, timestamptz, text, text, timestamptz, jsonb)
from public, anon, authenticated;

grant execute on function
  public._device_ui_lease_audit(uuid, uuid, text, text, text, uuid, uuid, text, jsonb),
  public.acquire_device_ui_lease(uuid, text, uuid, uuid, integer, text, text, text),
  public.assign_account_manual_only(uuid, uuid, uuid, text, uuid),
  public.auto_restart_bind_device_lock_to_request(uuid, text, uuid, integer),
  public.auto_restart_release_device_lock(uuid, text, uuid, text),
  public.auto_restart_renew_device_lock(uuid, text, uuid, integer),
  public.auto_restart_transfer_device_lock(uuid, uuid, text, integer),
  public.backfill_ig_target_followbacks(integer),
  public.bind_scheduled_session_preflight_request(uuid, uuid, uuid),
  public.claim_next_dm_job(uuid, text, public.dm_type),
  public.complete_scheduled_session_preflight(uuid, text, text, timestamptz, jsonb),
  public.enqueue_outreach_dm_job(uuid, text, text, uuid, public.dm_job_source, uuid, integer, jsonb),
  public.enqueue_welcome_dm_job_if_eligible(uuid, text, uuid, text, uuid, integer),
  public.evaluate_account_schedule_gate(uuid, text, text),
  public.get_active_operator_stop_suppression(uuid, timestamptz),
  public.get_valid_scheduled_session_preflight(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, timestamptz),
  public.handle_new_user(),
  public.handoff_preflight_device_lock_to_request(uuid, uuid, uuid, text, integer),
  public.mark_dm_job_running(uuid),
  public.reconcile_stale_device_ui_leases(integer),
  public.release_device_ui_lease(uuid, text, uuid, text),
  public.release_dm_job_after_dry_run(uuid, text, boolean, text, jsonb),
  public.renew_device_ui_lease(uuid, text, uuid, integer),
  public.rls_auto_enable(),
  public.sync_client_subscription_entitlements(uuid),
  public.sync_ig_account_target_followbacks(uuid),
  public.sync_ig_target_followbacks_count(uuid, boolean),
  public.upsert_account_follower_seen(uuid, text, uuid, boolean),
  public.upsert_operator_stop_suppression(uuid, uuid, timestamptz, timestamptz, uuid, uuid, text, timestamptz, jsonb),
  public.upsert_scheduled_session_preflight(uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, timestamptz, timestamptz, text, text, timestamptz, jsonb)
to service_role;

commit;
