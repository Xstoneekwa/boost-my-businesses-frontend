-- Post-onboarding CT readiness lifecycle V1.
--
-- The 15 eligible-target minimum is an initial onboarding gate only.
-- Once onboarding_status=ready, target depletion is handled by the independent
-- low-stock lifecycle threshold (5) and must not revoke growth readiness.

begin;

alter function public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text)
  rename to confirm_instagram_login_operator_pre_post_onboarding_ct_contract_v1;

revoke all on function public.confirm_instagram_login_operator_pre_post_onboarding_ct_contract_v1(uuid,uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;

create function public.confirm_instagram_login_operator_v1(
  p_account_id uuid,
  p_operator_id uuid,
  p_assignment_id uuid default null,
  p_incident_id uuid default null,
  p_idempotency_key text default null,
  p_expected_worker_sha text default null,
  p_cause_fixed_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eligible_targets integer := 0;
  v_onboarding_status text := '';
  v_incident public.account_incidents%rowtype;
begin
  -- Preserve the certified input-validation order before applying the stricter
  -- target gate.  The delegated implementation remains authoritative for all
  -- later identity, assignment and persistence checks.
  if p_account_id is null or p_operator_id is null then
    raise exception 'operator_confirmation_identity_required' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null
     or char_length(p_idempotency_key) > 180 then
    raise exception 'operator_confirmation_idempotency_key_invalid' using errcode = '22023';
  end if;
  if p_incident_id is not null then
    select * into v_incident
    from public.account_incidents
    where id = p_incident_id
      and account_id = p_account_id
      and archived_at is null;
    if v_incident.id is null then
      raise exception 'linked_incident_not_found' using errcode = 'P0002';
    end if;
    if lower(btrim(coalesce(p_expected_worker_sha, ''))) !~ '^[0-9a-f]{40}$' then
      raise exception 'operator_confirmation_expected_worker_sha_invalid' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_cause_fixed_version, '')), '') is null
       or char_length(p_cause_fixed_version) > 160 then
      raise exception 'operator_confirmation_cause_fixed_version_invalid' using errcode = '22023';
    end if;
  end if;

  select lower(btrim(coalesce(c.onboarding_status, ''))) into v_onboarding_status
  from public.client_instagram_accounts c
  where c.account_id = p_account_id
    and c.active is true
  order by c.updated_at desc nulls last
  limit 1;

  select count(*)::integer into v_eligible_targets
  from public.ig_targets t
  where t.account_id = p_account_id
    and lower(coalesce(t.status, '')) in ('valid', 'active')
    and lower(coalesce(t.quality_status, '')) = 'eligible'
    and lower(coalesce(t.verification_status, '')) = 'found'
    and t.archived_at is null
    and t.deleted_at is null;

  if v_onboarding_status <> 'ready' and v_eligible_targets < 15 then
    return jsonb_build_object(
      'ok', false,
      'ready', false,
      'proof_created', false,
      'reason', 'insufficient_eligible_targets',
      'account_id', p_account_id,
      'eligible_targets', v_eligible_targets,
      'initial_onboarding_required_eligible_targets', 15,
      'run_started', false
    );
  end if;

  -- The preserved wrapper remains rollback-only because it contains the old
  -- post-onboarding 15-target gate. Delegate to the certified implementation
  -- immediately beneath that wrapper.
  return public.confirm_instagram_login_operator_pre_target_minimum_v1(
    p_account_id,
    p_operator_id,
    p_assignment_id,
    p_incident_id,
    p_idempotency_key,
    p_expected_worker_sha,
    p_cause_fixed_version
  ) || jsonb_build_object(
    'eligible_targets', v_eligible_targets,
    'initial_onboarding_required_eligible_targets', 15,
    'onboarding_target_gate_applied', v_onboarding_status <> 'ready',
    'post_onboarding_low_stock_threshold', 5,
    'post_onboarding_low_stock', v_onboarding_status = 'ready' and v_eligible_targets <= 5
  );
end;
$$;

revoke all on function public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text)
  to service_role;

comment on function public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text) is
  'Operator login confirmation applies the 15 eligible-target minimum only until onboarding is complete; post-onboarding depletion is handled by the independent low-stock lifecycle contract.';

alter function public.reconcile_connected_instagram_growth_readiness_v1(uuid,text)
  rename to reconcile_connected_instagram_growth_readiness_pre_post_onboarding_ct_contract_v1;

revoke all on function public.reconcile_connected_instagram_growth_readiness_pre_post_onboarding_ct_contract_v1(uuid,text)
  from public, anon, authenticated, service_role;

create function public.reconcile_connected_instagram_growth_readiness_v1(
  p_account_id uuid,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.ig_accounts%rowtype;
  v_settings public.ig_account_settings%rowtype;
  v_client public.client_instagram_accounts%rowtype;
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_now timestamptz := now();
  v_eligible_targets integer := 0;
  v_actions_resolved integer := 0;
  v_incidents_resolved integer := 0;
  v_changed boolean := false;
begin
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;
  if v_source not in ('identity_success', 'login_request_terminal', 'login_blocker_terminal', 'migration_backfill') then
    raise exception 'post_connection_readiness_source_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'post_connection_growth_readiness:' || p_account_id::text,
    0
  ));

  select * into v_account
  from public.ig_accounts
  where id = p_account_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'account_not_found');
  end if;
  if v_account.archived_at is not null or v_account.trashed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'account_archived_or_trashed');
  end if;
  if lower(coalesce(v_account.admin_lifecycle_status, '')) <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'admin_lifecycle_not_active');
  end if;

  select * into v_client
  from public.client_instagram_accounts
  where account_id = p_account_id
    and active is true
  for update;
  if not found
     or lower(coalesce(v_client.login_status, '')) <> 'connected'
     or lower(coalesce(v_client.provisioning_status, '')) <> 'ready'
     or lower(coalesce(v_client.onboarding_status, '')) <> 'ready'
     or lower(coalesce(v_client.login_identity_proof_status, '')) <> 'verified'
     or coalesce(v_client.login_identity_profile_opened, false) is not true
     or coalesce(v_client.login_identity_username_match, false) is not true
     or v_client.login_identity_verified_at is null
     or nullif(btrim(coalesce(v_client.login_state_invalidation_reason, '')), '') is not null then
    return jsonb_build_object('ok', false, 'reason', 'exact_login_identity_not_ready');
  end if;

  if exists (
    select 1 from public.account_run_requests r
    where r.account_id = p_account_id
      and r.status in ('pending', 'queued', 'claimed', 'starting', 'processing', 'running', 'in_progress', 'active')
  ) or exists (
    select 1 from public.ig_runs r
    where r.account_id = p_account_id
      and r.status in ('pending', 'queued', 'claimed', 'starting', 'processing', 'running', 'in_progress', 'active')
  ) or exists (
    select 1 from public.auto_restart_device_locks l
    where l.account_id = p_account_id
      and l.lease_expires_at > v_now
  ) then
    return jsonb_build_object('ok', false, 'reason', 'account_runtime_active');
  end if;

  select count(*)::integer into v_eligible_targets
  from public.ig_targets t
  where t.account_id = p_account_id
    and lower(coalesce(t.status, '')) in ('valid', 'active')
    and lower(coalesce(t.quality_status, '')) = 'eligible'
    and lower(coalesce(t.verification_status, '')) = 'found'
    and t.archived_at is null
    and t.deleted_at is null;

  select * into v_settings
  from public.ig_account_settings
  where account_id = p_account_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'account_settings_missing');
  end if;

  if not exists (
    select 1 from public.account_credentials c
    where c.account_id = p_account_id
      and c.provider = 'instagram'
      and c.status in ('active', 'configured')
      and coalesce(c.reauth_required, false) is false
      and nullif(btrim(coalesce(c.secret_ref, '')), '') is not null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'active_credentials_required');
  end if;

  if not exists (
    select 1
    from public.account_assignments a
    join public.phone_app_instances i
      on i.id = a.app_instance_id
     and i.current_account_id = p_account_id
     and i.status in ('occupied', 'assigned', 'active')
    join public.phone_devices d
      on d.id = a.device_id
     and d.status in ('available', 'online', 'active', 'busy')
    where a.account_id = p_account_id
      and a.status in ('reserved', 'active')
      and a.schedule_mode in ('manual_only', 'scheduled')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'runtime_assignment_not_ready');
  end if;

  if exists (
    select 1 from public.instagram_account_restriction_holds h
    where h.account_id = p_account_id
      and h.status in ('active', 'verification_required')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'restriction_hold_active');
  end if;

  -- Exact identity success supersedes only older login-specific failures.
  -- Business, restriction, security, and social incidents remain fail-closed.
  -- Resolve the incident first. Its existing AFTER trigger synchronizes linked
  -- operator-review actions exactly once. Resolving actions first would invoke
  -- the legacy BEFORE trigger, update the incident, and then attempt to update
  -- the same action tuple again inside the originating command.
  update public.account_incidents i
  set status = 'resolved',
      resolved_at = coalesce(i.resolved_at, v_now),
      resolution_reason = coalesce(i.resolution_reason, 'superseded_by_exact_identity_success'),
      resolution_note = coalesce(i.resolution_note, 'A later exact assigned-account identity proof completed successfully.'),
      action_required = null,
      updated_at = v_now,
      metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
        'superseded_by_exact_identity_success', true,
        'identity_verified_at', v_client.login_identity_verified_at,
        'reconciliation_source', v_source,
        'blocking_campaign', false,
        'operator_review_required', false,
        'login_block_active', false
      )
  where i.account_id = p_account_id
    and i.created_at <= v_client.login_identity_verified_at
    and i.status in ('open', 'acknowledged', 'investigating')
    and i.resolved_at is null
    and i.archived_at is null
    and coalesce(i.legal_hold, false) is false
    and i.incident_type in (
      'auto_login_failed',
      'auto_login_identity_mismatch',
      'login_identity_mismatch',
      'login_package_mismatch',
      'instagram_login_verification_required',
      'login_verification_required'
    );
  get diagnostics v_incidents_resolved = row_count;

  update public.account_dashboard_actions a
  set status = 'resolved',
      blocking_campaign = false,
      requires_client_action = false,
      resolved_at = coalesce(a.resolved_at, v_now),
      updated_at = v_now,
      metadata_safe = coalesce(a.metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'superseded_by_exact_identity_success', true,
        'identity_verified_at', v_client.login_identity_verified_at,
        'reconciliation_source', v_source
      )
  where a.account_id = p_account_id
    and a.created_at <= v_client.login_identity_verified_at
    and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
    and (
      a.action_type in (
        'review_login_failure',
        'review_login_package_mismatch',
        'submit_instagram_verification_code',
        'instagram_verification_required',
        'login_preflight_scheduled'
      )
      or (
        a.action_type = 'operator_review_required'
        and exists (
          select 1 from public.account_incidents i
          where i.id = a.incident_id
            and i.incident_type in (
              'auto_login_failed',
              'auto_login_identity_mismatch',
              'login_identity_mismatch',
              'login_package_mismatch',
              'instagram_login_verification_required',
              'login_verification_required'
            )
        )
      )
    );
  get diagnostics v_actions_resolved = row_count;

  if exists (
    select 1 from public.account_dashboard_actions a
    where a.account_id = p_account_id
      and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
      and (
        coalesce(a.blocking_campaign, false)
        or a.action_type in ('operator_review_required', 'review_auto_restart_hard_stop')
        or a.status = 'pending_verification'
      )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'blocking_dashboard_action_active');
  end if;

  if exists (
    select 1 from public.account_incidents i
    where i.account_id = p_account_id
      and i.status in ('open', 'acknowledged', 'investigating')
      and i.resolved_at is null
      and i.archived_at is null
      and (
        nullif(btrim(coalesce(i.action_required, '')), '') is not null
        or lower(coalesce(i.severity, '')) = 'critical'
        or coalesce(i.metadata ->> 'blocking_campaign', 'false') = 'true'
        or coalesce(i.metadata ->> 'operator_review_required', 'false') = 'true'
        or coalesce(i.metadata ->> 'login_block_active', 'false') = 'true'
        or coalesce(i.metadata ->> 'social_block_active', 'false') = 'true'
      )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'blocking_incident_active');
  end if;

  if lower(coalesce(v_account.status, '')) <> 'active' then
    update public.ig_accounts
    set status = 'active', updated_at = v_now
    where id = p_account_id;
    v_changed := true;
  end if;
  if lower(coalesce(v_settings.account_status, '')) <> 'active'
     or lower(coalesce(v_settings.current_run_status, '')) <> 'idle' then
    update public.ig_account_settings
    set account_status = 'active',
        current_run_status = 'idle',
        updated_at = v_now
    where account_id = p_account_id;
    v_changed := true;
  end if;

  if v_changed or v_actions_resolved > 0 or v_incidents_resolved > 0 then
    insert into public.ig_action_logs (
      account_id, run_id, target_username, action_type, status, message, payload, created_at
    ) values (
      p_account_id,
      null,
      null,
      'post_connection_growth_readiness_reconciled',
      'success',
      'Exact Instagram identity success reconciled canonical growth readiness.',
      jsonb_build_object(
        'source', v_source,
        'eligible_targets', v_eligible_targets,
        'initial_onboarding_required_eligible_targets', 15,
        'onboarding_target_gate_applied', false,
        'post_onboarding_low_stock_threshold', 5,
        'post_onboarding_low_stock', v_eligible_targets <= 5,
        'actions_resolved', v_actions_resolved,
        'incidents_resolved', v_incidents_resolved,
        'account_status_changed', v_changed,
        'runtime_started', false,
        'schedule_changed', false,
        'package_changed', false,
        'target_changed', false
      ),
      v_now
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', case
      when v_changed or v_actions_resolved > 0 or v_incidents_resolved > 0
        then 'post_connection_growth_readiness_reconciled'
      else 'already_converged'
    end,
    'changed', v_changed,
    'account_id', p_account_id,
    'eligible_targets', v_eligible_targets,
    'initial_onboarding_required_eligible_targets', 15,
    'onboarding_target_gate_applied', false,
    'post_onboarding_low_stock_threshold', 5,
    'post_onboarding_low_stock', v_eligible_targets <= 5,
    'actions_resolved', v_actions_resolved,
    'incidents_resolved', v_incidents_resolved,
    'account_status', 'active',
    'settings_account_status', 'active',
    'current_run_status', 'idle'
  );
end;
$$;

revoke all on function public.reconcile_connected_instagram_growth_readiness_v1(uuid,text)
  from public, anon, authenticated;
grant execute on function public.reconcile_connected_instagram_growth_readiness_v1(uuid,text)
  to service_role;

comment on function public.reconcile_connected_instagram_growth_readiness_v1(uuid,text) is
  'Fail-closed post-login reconciliation. Requires exact current identity, no active runtime, and canonical assignment/credentials; onboarding is already complete, so CT depletion is lifecycle state and never revokes growth readiness.';


commit;
