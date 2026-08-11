begin;

-- Explicit, idempotent operator reset for a failed or incomplete Instagram
-- login attempt. This only resets login proof/projections. Commercial state,
-- entitlement, package settings, warmup, Vault secret, targets, protection
-- lists, assignment, app instance and schedule are deliberately untouched.
create or replace function public.reset_client_instagram_login_to_preconnect_v1(
  p_account_id uuid,
  p_reason text default 'operator_requested_fresh_login',
  p_actor_type text default 'ops',
  p_external_request_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.client_instagram_accounts%rowtype;
  v_reason text := lower(coalesce(nullif(trim(p_reason), ''), 'operator_requested_fresh_login'));
  v_actor_type text := lower(coalesce(nullif(trim(p_actor_type), ''), 'ops'));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_now timestamptz := now();
  v_actions_dismissed integer := 0;
  v_incidents_resolved integer := 0;
  v_incidents_archived integer := 0;
begin
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;
  if v_actor_type not in ('admin', 'assistant', 'ops', 'internal', 'system', 'backend') then
    raise exception 'invalid_reset_actor_type' using errcode = '22023';
  end if;
  if jsonb_typeof(v_metadata) is distinct from 'object' then
    raise exception 'metadata_must_be_object' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_metadata) as k(key)
    where lower(k.key) in (
      'password', 'secret', 'secret_ref', 'raw_secret', 'token', 'cookie',
      'webhook', 'webhook_url', 'vault', 'service_role', 'authorization',
      'bearer', 'raw_xml', 'xml', 'screenshot', 'device_udid', 'adb_serial'
    )
  ) then
    raise exception 'metadata_contains_forbidden_key' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'client_instagram_login_preconnect_reset:' || p_account_id::text,
    0
  ));

  select * into v_link
  from public.client_instagram_accounts
  where account_id = p_account_id
    and active is true
  for update;

  if v_link.id is null then
    raise exception 'client_instagram_account_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.account_run_requests r
    where r.account_id = p_account_id
      and r.status in ('pending', 'queued', 'claimed', 'starting', 'processing', 'running')
  ) or exists (
    select 1 from public.ig_runs r
    where r.account_id = p_account_id
      and r.status in ('pending', 'queued', 'processing', 'running')
  ) then
    raise exception 'account_runtime_active' using errcode = '55000';
  end if;

  update public.client_instagram_accounts
  set onboarding_status = 'configured',
      provisioning_status = 'login_pending',
      login_status = 'pending',
      login_identity_proof_status = 'required_unverified',
      login_identity_detected_username = null,
      login_identity_profile_opened = null,
      login_identity_username_match = null,
      login_identity_verified_at = null,
      login_identity_source_run_id = null,
      login_identity_failure_reason = null,
      login_identity_verification_source = null,
      login_identity_verification_method = null,
      login_identity_verified_by = null,
      login_identity_verified_account_id = null,
      login_identity_verified_device_id = null,
      login_identity_verified_app_instance_id = null,
      login_identity_verified_assignment_id = null,
      login_identity_login_lineage = '{}'::jsonb,
      login_state_source_at = v_now,
      login_state_version = greatest(coalesce(login_state_version, 1), 1) + 1,
      login_state_invalidation_reason = 'other_explicit_canonical_invalidation',
      updated_at = v_now
  where account_id = p_account_id;

  update public.account_credentials
  set reauth_required = true,
      reauth_reason = 'awaiting_login_verification',
      updated_by_actor_type = case
        when v_actor_type in ('admin', 'system', 'backend') then v_actor_type
        else 'system'
      end,
      updated_at = v_now
  where account_id = p_account_id
    and provider = 'instagram'
    and status = 'active';

  update public.ig_accounts
  set status = 'inactive',
      updated_at = v_now
  where id = p_account_id;

  update public.ig_account_settings
  set account_status = 'inactive',
      current_run_status = 'idle',
      updated_at = v_now
  where account_id = p_account_id;

  update public.account_incidents
  set status = 'resolved',
      resolved_at = v_now,
      resolution_reason = 'login_attempt_reset_to_preconnect',
      resolution_note = left('Superseded by an explicit canonical pre-login reset: ' || v_reason, 500),
      lifecycle_version = coalesce(lifecycle_version, 0) + 1,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'login_attempt_superseded', true,
        'login_preconnect_reset_at', v_now,
        'login_preconnect_reset_reason', v_reason
      ),
      updated_at = v_now
  where account_id = p_account_id
    and status in ('open', 'acknowledged', 'investigating')
    and resolved_at is null
    and archived_at is null
    and incident_type in (
      'email_verification_code_required',
      'login_verification_code_required',
      'sms_verification_code_required',
      'whatsapp_verification_code_required',
      'authenticator_verification_code_required',
      'auto_login_identity_mismatch',
      'login_identity_mismatch',
      'login_package_mismatch'
    );
  get diagnostics v_incidents_resolved = row_count;

  -- account_login_required is an Auto Restart-eligible incident family.
  -- Archive the superseded attempt without transitioning status to resolved,
  -- so this reset can never arm an incident resume authorization.
  update public.account_incidents
  set archived_at = coalesce(archived_at, v_now),
      resolution_reason = coalesce(resolution_reason, 'login_attempt_reset_to_preconnect'),
      resolution_note = coalesce(
        resolution_note,
        left('Superseded by an explicit canonical pre-login reset: ' || v_reason, 500)
      ),
      lifecycle_version = coalesce(lifecycle_version, 0) + 1,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'login_attempt_superseded', true,
        'login_preconnect_reset_at', v_now,
        'login_preconnect_reset_reason', v_reason,
        'auto_resume_armed', false
      ),
      updated_at = v_now
  where account_id = p_account_id
    and status in ('open', 'acknowledged', 'investigating')
    and resolved_at is null
    and archived_at is null
    and incident_type = 'account_login_required';
  get diagnostics v_incidents_archived = row_count;
  v_incidents_resolved := v_incidents_resolved + v_incidents_archived;

  update public.account_dashboard_actions
  set status = 'dismissed',
      blocking_campaign = false,
      requires_client_action = false,
      dismissed_at = coalesce(dismissed_at, v_now),
      metadata_safe = coalesce(metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'login_attempt_superseded', true,
        'login_preconnect_reset_at', v_now,
        'login_preconnect_reset_reason', v_reason
      ),
      updated_at = v_now
  where account_id = p_account_id
    and status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
    and action_type in (
      'enter_email_verification_code',
      'enter_sms_verification_code',
      'enter_whatsapp_verification_code',
      'enter_authenticator_verification_code',
      'login_verification_required'
    );
  get diagnostics v_actions_dismissed = row_count;

  insert into public.ig_action_logs (
    account_id, run_id, target_username, action_type, status, message, payload, created_at
  ) values (
    p_account_id,
    null,
    null,
    'client_instagram_login_reset_to_preconnect',
    'success',
    'Instagram login proof and projections reset to canonical pre-login state.',
    jsonb_build_object(
      'reason', v_reason,
      'actor_type', v_actor_type,
      'external_request_id', nullif(trim(coalesce(p_external_request_id, '')), ''),
      'previous_login_status', v_link.login_status,
      'previous_provisioning_status', v_link.provisioning_status,
      'previous_onboarding_status', v_link.onboarding_status,
      'previous_proof_status', v_link.login_identity_proof_status,
      'new_login_status', 'pending',
      'new_provisioning_status', 'login_pending',
      'new_onboarding_status', 'configured',
      'new_proof_status', 'required_unverified',
      'actions_dismissed', v_actions_dismissed,
      'incidents_resolved', v_incidents_resolved,
      'runtime_started', false,
      'schedule_changed', false,
      'assignment_changed', false,
      'package_changed', false,
      'settings_changed', false,
      'credentials_secret_changed', false
    ) || v_metadata,
    v_now
  );

  return jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'reason', v_reason,
    'login_status', 'pending',
    'provisioning_status', 'login_pending',
    'onboarding_status', 'configured',
    'login_identity_proof_status', 'required_unverified',
    'reauth_required', true,
    'reauth_reason', 'awaiting_login_verification',
    'actions_dismissed', v_actions_dismissed,
    'incidents_resolved', v_incidents_resolved,
    'runtime_started', false,
    'commercial_state_changed', false,
    'assignment_changed', false,
    'schedule_changed', false,
    'vault_secret_changed', false
  );
end;
$$;

revoke all on function public.reset_client_instagram_login_to_preconnect_v1(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.reset_client_instagram_login_to_preconnect_v1(uuid, text, text, text, jsonb)
  to service_role;

comment on function public.reset_client_instagram_login_to_preconnect_v1(uuid, text, text, text, jsonb) is
  'Service-role-only, idempotent reset of login proof and operational projections to canonical pre-login state. Preserves commercial state, Vault credentials, targets, protection lists, assignment and schedule; never starts runtime.';

commit;
