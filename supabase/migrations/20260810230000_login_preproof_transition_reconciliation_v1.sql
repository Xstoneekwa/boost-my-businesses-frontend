begin;

-- The strict identity gate was introduced after some login-provisioning runs
-- had already published connected/ready successfully. Those pre-gate runs did
-- not persist the later own-profile proof fields, so the one-time gate audit
-- classified the accounts as proven_false_ready even though the login itself
-- had completed successfully. Preserve that historical limitation explicitly;
-- do not manufacture a verified identity proof. The ready-identity trigger is
-- disabled only inside this transaction for the narrowly selected historical
-- rows, then restored before commit. Any error rolls the whole transaction
-- back, including the trigger state.
alter table public.client_instagram_accounts
  disable trigger enforce_client_instagram_ready_identity_v1;

with eligible as (
  select distinct cia.account_id
  from public.client_instagram_accounts cia
  join public.ig_accounts ia
    on ia.id = cia.account_id
  join public.ig_runs r
    on r.id = cia.login_identity_source_run_id
   and r.account_id = cia.account_id
  join public.account_run_requests rr
    on rr.run_id = r.id
   and rr.account_id = r.account_id
  where cia.active is true
    and cia.login_identity_proof_status = 'proven_false_ready'
    and cia.login_identity_failure_reason = 'login_identity_not_verified'
    and cia.login_identity_profile_opened is false
    and cia.login_identity_username_match is false
    and cia.login_state_invalidation_reason is null
    and lower(coalesce(ia.admin_lifecycle_status, '')) = 'active'
    and ia.archived_at is null
    and ia.trashed_at is null
    and rr.requested_run_type = 'login_provisioning'
    and rr.status = 'completed'
    and rr.error_code is null
    and rr.source_surface = 'instagram_client_connect'
    and rr.metadata_safe ->> 'mode' = 'login_preflight_now'
    and rr.created_at < timestamptz '2026-08-10 11:19:19+00'
    and r.status = 'completed'
    and r.error_message is null
    and coalesce((r.performance_summary ->> 'exit_code')::integer, 0) = 0
    and exists (
      select 1
      from public.account_credentials ac
      where ac.account_id = cia.account_id
        and ac.provider = 'instagram'
        and ac.status in ('active', 'configured')
        and coalesce(ac.reauth_required, false) is false
    )
)
update public.client_instagram_accounts cia
set login_status = 'connected',
    provisioning_status = 'ready',
    onboarding_status = 'ready',
    login_identity_proof_status = 'historical_model_missing',
    login_identity_failure_reason = null,
    login_identity_verified_at = null,
    login_identity_verification_source = null,
    login_identity_verification_method = null,
    login_identity_verified_by = null,
    login_identity_verified_account_id = null,
    login_identity_verified_device_id = null,
    login_identity_verified_app_instance_id = null,
    login_identity_verified_assignment_id = null,
    login_identity_login_lineage = coalesce(cia.login_identity_login_lineage, '{}'::jsonb)
      || jsonb_build_object(
        'transition_reconciliation', 'pre_identity_gate_successful_login',
        'source_run_id', cia.login_identity_source_run_id
      ),
    login_state_source_at = now(),
    login_state_version = cia.login_state_version + 1,
    updated_at = now()
from eligible e
where cia.account_id = e.account_id;

alter table public.client_instagram_accounts
  enable trigger enforce_client_instagram_ready_identity_v1;

-- This migration is deliberately a narrow historical reconciliation. Future
-- login runs remain governed by the strict Worker proof contract and cannot
-- become connected without an exact own-profile identity match.

commit;
