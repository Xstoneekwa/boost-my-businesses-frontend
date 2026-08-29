begin;

-- Canonical service-role-only reset for one Instagram Auto Login workflow.
-- The function is intentionally generic: account identity, commercial state,
-- assignment, targets, credential history and terminal runtime history are
-- preserved. Only retry/proof projections from superseded login attempts move.
create or replace function public.reset_client_instagram_auto_login_workflow_v2(
  p_account_id uuid,
  p_reason text default 'operator_requested_fresh_auto_login',
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
  v_reason text := lower(coalesce(nullif(trim(p_reason), ''), 'operator_requested_fresh_auto_login'));
  v_actor_type text := lower(coalesce(nullif(trim(p_actor_type), ''), 'ops'));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_now timestamptz := now();
  v_active_credential_id uuid;
  v_active_credential_version integer;
  v_projection_rows integer := 0;
  v_actions_dismissed integer := 0;
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
    'client_instagram_auto_login_workflow_reset_v2:' || p_account_id::text,
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
      and r.status in ('pending', 'queued', 'starting', 'processing', 'running', 'in_progress', 'active')
  ) then
    raise exception 'account_runtime_active' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.auto_restart_device_locks l
    where l.account_id = p_account_id
      and l.lease_expires_at > v_now
  ) then
    raise exception 'account_device_lock_active' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.auto_restart_tick_locks l
    where l.status = 'started'
      and l.tick_completed_at is null
  ) then
    raise exception 'auto_restart_tick_active' using errcode = '55000';
  end if;

  select c.id, c.credentials_version
  into v_active_credential_id, v_active_credential_version
  from public.account_credentials c
  where c.account_id = p_account_id
    and c.provider = 'instagram'
    and c.status = 'active'
  order by c.credentials_version desc
  limit 1
  for update;

  if v_active_credential_id is null or (
    select count(*) from public.account_credentials c
    where c.account_id = p_account_id
      and c.provider = 'instagram'
      and c.status = 'active'
  ) <> 1 then
    raise exception 'active_instagram_credential_singleton_required' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.account_incidents i
    where i.account_id = p_account_id
      and i.status in ('open', 'acknowledged', 'investigating')
      and i.resolved_at is null
      and i.archived_at is null
      and coalesce(i.legal_hold, false) is true
      and i.incident_type in (
        'auto_login_failed',
        'account_login_required',
        'auto_login_identity_mismatch',
        'login_identity_mismatch',
        'login_package_mismatch',
        'instagram_login_verification_required',
        'login_verification_required',
        'email_verification_code_required',
        'sms_verification_code_required',
        'whatsapp_verification_code_required',
        'authenticator_verification_code_required'
      )
  ) then
    raise exception 'login_incident_legal_hold_active' using errcode = '55000';
  end if;

  -- These two actions may only be retired when their originating attempt is
  -- terminal. A linked incident/run is preferred; temporal containment is the
  -- compatibility proof for historical actions that predate explicit run_id.
  if exists (
    select 1
    from public.account_dashboard_actions a
    where a.account_id = p_account_id
      and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
      and a.action_type in ('update_instagram_password', 'review_login_package_mismatch')
      and not (
        exists (
          select 1
          from public.account_incidents i
          join public.ig_runs r on r.id = i.run_id
          where i.id = a.incident_id
            and r.account_id = p_account_id
            and r.status in ('completed', 'failed', 'cancelled', 'canceled', 'blocked', 'rejected', 'timed_out', 'expired')
            and r.finished_at is not null
        )
        or exists (
          select 1
          from public.ig_runs r
          where r.account_id = p_account_id
            and r.status in ('completed', 'failed', 'cancelled', 'canceled', 'blocked', 'rejected', 'timed_out', 'expired')
            and r.finished_at is not null
            and r.started_at <= a.created_at
            and r.finished_at >= a.created_at
        )
        or exists (
          select 1
          from public.account_run_requests q
          where q.account_id = p_account_id
            and q.status in ('completed', 'failed', 'cancelled', 'canceled', 'blocked', 'rejected', 'timed_out', 'expired')
            and q.completed_at is not null
            and q.created_at <= a.created_at
            and q.completed_at >= a.created_at
        )
      )
  ) then
    raise exception 'login_action_terminal_attempt_not_proven' using errcode = '55000';
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
  where account_id = p_account_id
    and (
      onboarding_status is distinct from 'configured'
      or provisioning_status is distinct from 'login_pending'
      or login_status is distinct from 'pending'
      or login_identity_proof_status is distinct from 'required_unverified'
      or login_identity_detected_username is not null
      or login_identity_profile_opened is not null
      or login_identity_username_match is not null
      or login_identity_verified_at is not null
      or login_identity_source_run_id is not null
      or login_identity_login_lineage is distinct from '{}'::jsonb
    );
  get diagnostics v_projection_rows = row_count;

  update public.account_credentials
  set reauth_required = true,
      reauth_reason = 'awaiting_login_verification',
      updated_by_actor_type = case
        when v_actor_type in ('admin', 'system', 'backend') then v_actor_type
        else 'system'
      end,
      updated_at = v_now
  where id = v_active_credential_id
    and (
      reauth_required is distinct from true
      or reauth_reason is distinct from 'awaiting_login_verification'
    );

  update public.ig_accounts
  set status = 'inactive', updated_at = v_now
  where id = p_account_id
    and status is distinct from 'inactive';

  update public.ig_account_settings
  set account_status = 'inactive', current_run_status = 'idle', updated_at = v_now
  where account_id = p_account_id
    and (
      account_status is distinct from 'inactive'
      or current_run_status is distinct from 'idle'
    );

  update public.account_incidents i
  set archived_at = coalesce(i.archived_at, v_now),
      resolution_reason = coalesce(i.resolution_reason, 'login_attempt_superseded_by_preconnect_reset'),
      resolution_note = coalesce(i.resolution_note, left('Superseded by canonical Auto Login workflow reset V2: ' || v_reason, 500)),
      lifecycle_version = coalesce(i.lifecycle_version, 0) + 1,
      action_required = null,
      metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
        'login_attempt_superseded', true,
        'auto_login_reset_contract', 'v2',
        'auto_login_reset_at', v_now,
        'auto_login_reset_reason', v_reason,
        'authentication_success', false,
        'auto_resume_armed', false,
        'blocking_campaign', false
      ),
      updated_at = v_now
  where i.account_id = p_account_id
    and i.status in ('open', 'acknowledged', 'investigating')
    and i.resolved_at is null
    and i.archived_at is null
    and coalesce(i.legal_hold, false) is false
    and i.incident_type in (
      'auto_login_failed',
      'account_login_required',
      'auto_login_identity_mismatch',
      'login_identity_mismatch',
      'login_package_mismatch',
      'instagram_login_verification_required',
      'login_verification_required',
      'email_verification_code_required',
      'sms_verification_code_required',
      'whatsapp_verification_code_required',
      'authenticator_verification_code_required'
    );
  get diagnostics v_incidents_archived = row_count;

  update public.account_dashboard_actions a
  set status = 'dismissed',
      blocking_campaign = false,
      requires_client_action = false,
      dismissed_at = coalesce(a.dismissed_at, v_now),
      metadata_safe = coalesce(a.metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'login_attempt_superseded', true,
        'auto_login_reset_contract', 'v2',
        'auto_login_reset_at', v_now,
        'auto_login_reset_reason', v_reason,
        'authentication_success', false,
        'password_verification_result', case
          when a.action_type = 'update_instagram_password' then 'not_verified_reset_to_preconnect'
          else null
        end
      ),
      updated_at = v_now
  where a.account_id = p_account_id
    and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
    and a.action_type in (
      'update_instagram_password',
      'review_login_package_mismatch',
      'review_login_failure',
      'login_preflight_scheduled',
      'enter_email_verification_code',
      'enter_sms_verification_code',
      'enter_whatsapp_verification_code',
      'enter_authenticator_verification_code',
      'login_verification_required',
      'submit_instagram_verification_code',
      'instagram_verification_required'
    );
  get diagnostics v_actions_dismissed = row_count;

  if v_active_credential_id is distinct from (
    select c.id from public.account_credentials c
    where c.account_id = p_account_id and c.provider = 'instagram' and c.status = 'active'
    order by c.credentials_version desc limit 1
  ) or (
    select count(*) from public.account_credentials c
    where c.account_id = p_account_id and c.provider = 'instagram' and c.status = 'active'
  ) <> 1 then
    raise exception 'active_instagram_credential_changed_during_reset' using errcode = '40001';
  end if;

  insert into public.ig_action_logs (
    account_id, run_id, target_username, action_type, status, message, payload, created_at
  ) values (
    p_account_id,
    null,
    null,
    'client_instagram_auto_login_workflow_reset_v2',
    'success',
    'Auto Login workflow reset to canonical pre-login state without authentication success.',
    jsonb_build_object(
      'reason', v_reason,
      'actor_type', v_actor_type,
      'external_request_id', nullif(trim(coalesce(p_external_request_id, '')), ''),
      'reset_contract', 'v2',
      'state_changed', (v_projection_rows + v_actions_dismissed + v_incidents_archived) > 0,
      'active_credential_id', v_active_credential_id,
      'active_credential_version', v_active_credential_version,
      'actions_dismissed', v_actions_dismissed,
      'incidents_archived', v_incidents_archived,
      'authentication_success', false,
      'runtime_started', false,
      'run_request_created', false,
      'tick_created', false,
      'schedule_changed', false,
      'assignment_changed', false,
      'package_changed', false,
      'entitlement_changed', false,
      'targets_changed', false,
      'credential_history_changed', false,
      'vault_secret_changed', false
    ) || v_metadata,
    v_now
  );

  return jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'reset_contract', 'v2',
    'state_changed', (v_projection_rows + v_actions_dismissed + v_incidents_archived) > 0,
    'login_status', 'pending',
    'provisioning_status', 'login_pending',
    'onboarding_status', 'configured',
    'login_identity_proof_status', 'required_unverified',
    'active_credential_id', v_active_credential_id,
    'active_credential_version', v_active_credential_version,
    'active_credential_count', 1,
    'reauth_required', true,
    'reauth_reason', 'awaiting_login_verification',
    'actions_dismissed', v_actions_dismissed,
    'incidents_archived', v_incidents_archived,
    'authentication_success', false,
    'runtime_started', false,
    'run_request_created', false,
    'tick_created', false,
    'commercial_state_changed', false,
    'assignment_changed', false,
    'package_changed', false,
    'entitlement_changed', false,
    'targets_changed', false,
    'credential_history_changed', false,
    'schedule_changed', false,
    'vault_secret_changed', false
  );
end;
$$;

revoke all on function public.reset_client_instagram_auto_login_workflow_v2(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.reset_client_instagram_auto_login_workflow_v2(uuid, text, text, text, jsonb)
  to service_role;

comment on function public.reset_client_instagram_auto_login_workflow_v2(uuid, text, text, text, jsonb) is
  'Service-role-only, atomic and idempotent Auto Login workflow reset. Archives superseded login failures/actions without inventing authentication success; preserves account, commercial state, assignments, targets, credential history and terminal runtime history; never starts runtime.';

commit;
