-- Qualification-only schema closure for fields already present in current
-- production. It deliberately precedes the exact captured function below.
alter table public.client_instagram_accounts
  add column if not exists capacity_status text not null default 'occupied',
  add column if not exists capacity_released_at timestamptz,
  add column if not exists capacity_release_reason text,
  add column if not exists capacity_release_operation_id uuid;

CREATE OR REPLACE FUNCTION public.rollback_test_instagram_onboarding_v1(p_account_id uuid, p_tenant_id uuid, p_entitlement_id uuid, p_expected_username text, p_expected_checkout_id uuid, p_expected_package text, p_reason text, p_request_id text, p_idempotency_key text, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_now timestamptz := now();
  v_expected_username text := lower(btrim(coalesce(p_expected_username, '')));
  v_expected_package text := lower(btrim(coalesce(p_expected_package, '')));
  v_reason text := lower(btrim(coalesce(p_reason, '')));
  v_request_id text := btrim(coalesce(p_request_id, ''));
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_idempotency_hash text;
  v_fingerprint text;
  v_existing_audit public.test_instagram_onboarding_rollbacks%rowtype;
  v_account public.ig_accounts%rowtype;
  v_link public.client_instagram_accounts%rowtype;
  v_entitlement public.client_account_entitlements%rowtype;
  v_checkout public.commercial_checkout_sessions%rowtype;
  v_onboarding_session public.client_instagram_onboarding_sessions%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_instance public.phone_app_instances%rowtype;
  v_heartbeat public.device_heartbeats%rowtype;
  v_audit_id uuid := gen_random_uuid();
  v_tombstone_username text;
  v_actor_role text := coalesce(auth.role(), 'unknown');
  v_active_requests integer := 0;
  v_active_runs integer := 0;
  v_active_locks integer := 0;
  v_active_auto_login integer := 0;
  v_active_dependencies integer := 0;
  v_other_tenant_accounts integer := 0;
  v_existing_reserved integer := 0;
  v_matching_onboarding_sessions integer := 0;
  v_stripe_attempts integer := 0;
  v_live_stripe_attempts integer := 0;
  v_test_stripe_subscriptions integer := 0;
  v_live_stripe_subscriptions integer := 0;
  v_nonterminal_test_stripe_subscriptions integer := 0;
  v_assignment_count integer := 0;
  v_counts jsonb := '{}'::jsonb;
  v_planned jsonb := '{}'::jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_credential_result jsonb := '{}'::jsonb;
  v_release_result jsonb := '{}'::jsonb;
  v_rows integer := 0;
  v_count integer := 0;
  v_previous_version bigint;
  v_new_version bigint;
  v_kind text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  if p_account_id is null or p_tenant_id is null or p_entitlement_id is null
     or p_expected_checkout_id is null or v_expected_username = ''
     or v_expected_package = '' or v_reason = '' or v_request_id = ''
     or v_idempotency_key = '' or p_dry_run is null then
    return jsonb_build_object('ok', false, 'reason', 'required_parameter_missing', 'dry_run', p_dry_run);
  end if;
  if v_request_id !~ '^[A-Za-z0-9._:-]{1,120}$' then
    return jsonb_build_object('ok', false, 'reason', 'request_id_invalid', 'dry_run', p_dry_run);
  end if;
  if v_idempotency_key !~ '^[A-Za-z0-9._:-]{8,200}$' then
    return jsonb_build_object('ok', false, 'reason', 'idempotency_key_invalid', 'dry_run', p_dry_run);
  end if;
  if v_reason !~ '^[a-z0-9_:-]{3,120}$' then
    return jsonb_build_object('ok', false, 'reason', 'rollback_reason_invalid', 'dry_run', p_dry_run);
  end if;

  v_idempotency_hash := encode(digest(v_idempotency_key, 'sha256'), 'hex');
  v_fingerprint := encode(digest(concat_ws('|',
    p_account_id::text, p_tenant_id::text, p_entitlement_id::text,
    v_expected_username, p_expected_checkout_id::text, v_expected_package,
    v_reason, v_request_id
  ), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('rollback_test_instagram_onboarding_v1:' || p_account_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('rollback_test_instagram_onboarding_v1:' || v_idempotency_hash, 0));

  select * into v_existing_audit
  from public.test_instagram_onboarding_rollbacks
  where idempotency_key_hash = v_idempotency_hash;
  if found then
    if v_existing_audit.input_fingerprint <> v_fingerprint then
      return jsonb_build_object(
        'ok', false,
        'reason', 'idempotency_fingerprint_mismatch',
        'dry_run', p_dry_run,
        'idempotency_key_prefix', left(v_idempotency_hash, 12)
      );
    end if;
    return jsonb_build_object(
      'ok', true,
      'reason', 'already_rolled_back',
      'dry_run', false,
      'account_id', v_existing_audit.account_id,
      'tenant_id', v_existing_audit.tenant_id,
      'entitlement_id', v_existing_audit.entitlement_id,
      'audit_id', v_existing_audit.id,
      'records_changed', v_existing_audit.records_changed,
      'completed_at', v_existing_audit.completed_at
    );
  end if;

  select * into v_account from public.ig_accounts where id = p_account_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'account_not_found', 'dry_run', p_dry_run);
  end if;
  if lower(btrim(v_account.username)) <> v_expected_username then
    return jsonb_build_object('ok', false, 'reason', 'username_mismatch', 'dry_run', p_dry_run);
  end if;
  if v_account.admin_lifecycle_status <> 'active'
     or v_account.status = 'rolled_back_test_onboarding' then
    return jsonb_build_object('ok', false, 'reason', 'account_not_active_for_rollback', 'dry_run', p_dry_run);
  end if;

  select * into v_link
  from public.client_instagram_accounts
  where account_id = p_account_id and client_id = p_tenant_id and active = true
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'tenant_or_active_ownership_mismatch', 'dry_run', p_dry_run);
  end if;
  if v_link.capacity_status <> 'occupied' then
    return jsonb_build_object('ok', false, 'reason', 'target_capacity_not_occupied', 'dry_run', p_dry_run);
  end if;

  select * into v_entitlement
  from public.client_account_entitlements
  where id = p_entitlement_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'entitlement_not_found', 'dry_run', p_dry_run);
  end if;
  if v_entitlement.client_id <> p_tenant_id
     or v_entitlement.account_id is distinct from p_account_id
     or v_entitlement.status <> 'entitlement_consumed' then
    return jsonb_build_object('ok', false, 'reason', 'entitlement_ownership_or_status_mismatch', 'dry_run', p_dry_run);
  end if;
  if lower(coalesce(v_entitlement.commercial_package_code, '')) <> v_expected_package
     or lower(coalesce(v_entitlement.plan_key, '')) <> v_expected_package then
    return jsonb_build_object('ok', false, 'reason', 'package_mismatch', 'dry_run', p_dry_run);
  end if;
  if v_entitlement.checkout_session_id <> p_expected_checkout_id then
    return jsonb_build_object('ok', false, 'reason', 'checkout_mismatch', 'dry_run', p_dry_run);
  end if;

  select * into v_checkout
  from public.commercial_checkout_sessions
  where id = p_expected_checkout_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'checkout_not_found', 'dry_run', p_dry_run);
  end if;
  if v_checkout.client_id is distinct from p_tenant_id
     or lower(coalesce(v_checkout.plan_key, '')) <> v_expected_package then
    return jsonb_build_object('ok', false, 'reason', 'checkout_tenant_or_package_mismatch', 'dry_run', p_dry_run);
  end if;

  select count(*), count(*) filter (where a.livemode is true)
    into v_stripe_attempts, v_live_stripe_attempts
  from public.commercial_stripe_checkout_attempts a
  where a.commercial_checkout_session_id = p_expected_checkout_id;
  if v_live_stripe_attempts <> 0 then
    return jsonb_build_object('ok', false, 'reason', 'live_stripe_chain_forbidden', 'dry_run', p_dry_run);
  end if;
  if v_checkout.status <> 'checkout_activated_test' and v_stripe_attempts = 0 then
    return jsonb_build_object('ok', false, 'reason', 'checkout_not_proven_test', 'dry_run', p_dry_run);
  end if;

  select
    count(*) filter (where s.livemode is false),
    count(*) filter (where s.livemode is true),
    count(*) filter (
      where s.livemode is false
        and lower(coalesce(s.status, '')) not in ('canceled', 'cancelled', 'ended', 'incomplete_expired')
    )
  into v_test_stripe_subscriptions, v_live_stripe_subscriptions, v_nonterminal_test_stripe_subscriptions
  from public.commercial_stripe_subscriptions s
  where s.account_id = p_account_id
     or s.client_account_entitlement_id = p_entitlement_id
     or s.commercial_checkout_session_id = p_expected_checkout_id;
  if v_live_stripe_subscriptions <> 0 then
    return jsonb_build_object('ok', false, 'reason', 'live_stripe_subscription_forbidden', 'dry_run', p_dry_run);
  end if;
  if v_nonterminal_test_stripe_subscriptions <> 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'stripe_test_subscription_requires_canonical_cancel',
      'dry_run', p_dry_run,
      'count', v_nonterminal_test_stripe_subscriptions
    );
  end if;

  select count(*) into v_matching_onboarding_sessions
  from public.client_instagram_onboarding_sessions s
  where s.account_id = p_account_id
    and s.client_id = p_tenant_id
    and s.entitlement_id = p_entitlement_id
    and lower(btrim(s.requested_username)) = v_expected_username
    and lower(btrim(s.package_code)) = v_expected_package;
  if v_matching_onboarding_sessions <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'onboarding_session_identity_mismatch', 'dry_run', p_dry_run, 'count', v_matching_onboarding_sessions);
  end if;
  select * into v_onboarding_session
  from public.client_instagram_onboarding_sessions s
  where s.account_id = p_account_id
    and s.client_id = p_tenant_id
    and s.entitlement_id = p_entitlement_id
    and lower(btrim(s.requested_username)) = v_expected_username
    and lower(btrim(s.package_code)) = v_expected_package
  for update;

  select count(*) into v_existing_reserved
  from public.client_account_entitlements e
  where e.client_id = p_tenant_id and e.status = 'entitlement_reserved' and e.id <> p_entitlement_id;
  select count(*) into v_other_tenant_accounts
  from public.client_instagram_accounts cia
  where cia.client_id = p_tenant_id and cia.active = true and cia.account_id <> p_account_id;

  select count(*) into v_assignment_count
  from public.account_assignments aa
  where aa.account_id = p_account_id and aa.status in ('pending', 'reserved', 'active');
  if v_assignment_count <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'open_assignment_count_mismatch', 'dry_run', p_dry_run, 'count', v_assignment_count);
  end if;
  select * into v_assignment
  from public.account_assignments aa
  where aa.account_id = p_account_id and aa.status in ('pending', 'reserved', 'active')
  for update;
  if v_assignment.app_instance_id is null then
    return jsonb_build_object('ok', false, 'reason', 'assignment_app_instance_missing', 'dry_run', p_dry_run);
  end if;
  select * into v_instance from public.phone_app_instances where id = v_assignment.app_instance_id for update;
  if not found or v_instance.current_account_id is distinct from p_account_id or v_instance.status <> 'occupied' then
    return jsonb_build_object('ok', false, 'reason', 'assignment_instance_occupant_mismatch', 'dry_run', p_dry_run);
  end if;
  select * into v_heartbeat from public.device_heartbeats where device_id = v_assignment.device_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'device_heartbeat_missing', 'dry_run', p_dry_run);
  end if;
  if v_heartbeat.current_account_id is not null
     or v_heartbeat.current_assignment_id is not null
     or v_heartbeat.current_clone_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'device_runtime_occupancy_active', 'dry_run', p_dry_run);
  end if;

  select count(*) into v_active_requests
  from public.account_run_requests r
  where r.account_id = p_account_id
    and r.status in ('pending', 'queued', 'claimed', 'starting', 'running', 'in_progress');
  select count(*) into v_active_auto_login
  from public.account_run_requests r
  where r.account_id = p_account_id
    and lower(r.requested_run_type) like '%login%'
    and r.status in ('pending', 'queued', 'claimed', 'starting', 'running', 'in_progress');
  select count(*) into v_active_runs
  from public.ig_runs r
  where r.account_id = p_account_id
    and r.status in ('pending', 'queued', 'starting', 'running', 'in_progress', 'active');
  select count(*) into v_active_locks
  from public.auto_restart_device_locks l
  where (l.account_id = p_account_id or l.device_id = v_assignment.device_id or l.app_instance_id = v_assignment.app_instance_id)
    and l.lease_expires_at > v_now
    and l.release_reason is null;
  if v_active_requests <> 0 then
    return jsonb_build_object('ok', false, 'reason', 'active_request_guard', 'dry_run', p_dry_run, 'count', v_active_requests);
  end if;
  if v_active_runs <> 0 then
    return jsonb_build_object('ok', false, 'reason', 'active_run_guard', 'dry_run', p_dry_run, 'count', v_active_runs);
  end if;
  if v_active_locks <> 0 then
    return jsonb_build_object('ok', false, 'reason', 'active_lock_guard', 'dry_run', p_dry_run, 'count', v_active_locks);
  end if;
  if v_active_auto_login <> 0 then
    return jsonb_build_object('ok', false, 'reason', 'active_auto_login_guard', 'dry_run', p_dry_run, 'count', v_active_auto_login);
  end if;

  select
    (select count(*) from public.live_view_sessions s where s.account_id = p_account_id and s.status in ('pending', 'starting', 'active', 'running'))
    + (select count(*) from public.ig_dm_jobs j where j.account_id = p_account_id and j.status::text in ('claimed', 'processing', 'running', 'in_progress', 'sending'))
    + (select count(*) from public.ig_social_profile_snapshot_jobs j where j.account_id = p_account_id and j.status in ('claimed', 'processing', 'running', 'in_progress'))
    + (select count(*) from public.ct_target_verification_jobs j where j.account_id = p_account_id and j.status = 'processing')
    + (select count(*) from public.credential_update_requests r where r.account_id = p_account_id and r.status in ('pending', 'active', 'processing'))
    + (select count(*) from public.account_verification_code_submissions s where s.account_id = p_account_id and s.status in ('pending', 'active', 'processing'))
    + (select count(*) from public.incident_resume_authorizations a where a.account_id = p_account_id and a.status in ('armed', 'active', 'pending'))
    + (select count(*) from public.scheduled_session_preflights s where s.account_id = p_account_id and s.status in ('pending', 'claimed', 'running', 'active'))
  into v_active_dependencies;
  if v_active_dependencies <> 0 then
    return jsonb_build_object('ok', false, 'reason', 'active_dependent_entity_guard', 'dry_run', p_dry_run, 'count', v_active_dependencies);
  end if;

  v_counts := jsonb_build_object(
    'credential_records', (select count(*) from public.account_credentials c where c.account_id = p_account_id and c.provider = 'instagram'),
    'ownership_client_links', (select count(*) from public.client_instagram_accounts c where c.account_id = p_account_id and c.active = true),
    'subscription_account_links', (select count(*) from public.client_subscription_accounts c where c.account_id = p_account_id and c.status = 'active'),
    'settings_rows',
      (select count(*) from public.ig_account_settings s where s.account_id = p_account_id)
      + (select count(*) from public.ig_account_dm_settings s where s.account_id = p_account_id)
      + (select count(*) from public.ig_account_unfollow_settings s where s.account_id = p_account_id)
      + (select count(*) from public.ig_account_follow_settings s where s.account_id = p_account_id)
      + (select count(*) from public.account_follow_source_settings s where s.account_id = p_account_id)
      + (select count(*) from public.account_warmup_settings s where s.account_id = p_account_id),
    'filters_rows', (select count(*) from public.ig_account_filters s where s.account_id = p_account_id),
    'targets_total', (select count(*) from public.ig_targets t where t.account_id = p_account_id),
    'targets_active', (select count(*) from public.ig_targets t where t.account_id = p_account_id and t.archived_at is null and t.deleted_at is null),
    'ct_audit_events_historical', (select count(*) from public.ct_target_audit_events e where e.account_id = p_account_id),
    'verification_jobs_total', (select count(*) from public.ct_target_verification_jobs j where j.account_id = p_account_id),
    'verification_jobs_nonhistorical', (select count(*) from public.ct_target_verification_jobs j where j.account_id = p_account_id and j.status in ('pending', 'processing', 'retry_scheduled')),
    'protection_entries_total', (select count(*) from public.account_protection_list_entries e where e.account_id = p_account_id),
    'protection_entries_active', (select count(*) from public.account_protection_list_entries e where e.account_id = p_account_id and e.active),
    'protection_versions_historical', (select count(*) from public.account_protection_list_versions e where e.account_id = p_account_id),
    'protection_events_historical', (select count(*) from public.account_protection_list_events e where e.account_id = p_account_id),
    'onboarding_sessions_total', (select count(*) from public.client_instagram_onboarding_sessions s where s.account_id = p_account_id),
    'onboarding_sessions_active', (select count(*) from public.client_instagram_onboarding_sessions s where s.account_id = p_account_id and s.status in ('creating', 'active')),
    'dashboard_actions_nonhistorical', (select count(*) from public.account_dashboard_actions a where a.account_id = p_account_id and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')),
    'historical_requests', (select count(*) from public.account_run_requests r where r.account_id = p_account_id),
    'historical_runs', (select count(*) from public.ig_runs r where r.account_id = p_account_id),
    'historical_action_logs', (select count(*) from public.ig_action_logs l where l.account_id = p_account_id),
    'historical_incidents', (select count(*) from public.account_incidents i where i.account_id = p_account_id),
    'matching_onboarding_sessions', v_matching_onboarding_sessions,
    'tenant_reserved_entitlements_untouched', v_existing_reserved,
    'test_stripe_checkout_attempts', v_stripe_attempts,
    'test_stripe_subscriptions_terminal', v_test_stripe_subscriptions,
    'active_requests', v_active_requests,
    'active_runs', v_active_runs,
    'active_locks', v_active_locks,
    'active_auto_login', v_active_auto_login,
    'other_tenant_accounts', v_other_tenant_accounts
  );
  v_planned := jsonb_build_object(
    'ig_accounts', 1,
    'client_instagram_accounts', 1,
    'client_subscription_accounts', (select count(*) from public.client_subscription_accounts c where c.account_id = p_account_id and c.status = 'active'),
    'account_commercial_packages', (select count(*) from public.account_commercial_packages c where c.account_id = p_account_id and c.status = 'active'),
    'account_credentials', (select count(*) from public.account_credentials c where c.account_id = p_account_id and c.provider = 'instagram' and c.status <> 'revoked'),
    'account_assignments', 1,
    'phone_app_instances', 1,
    'client_capacity_occupancies_released_terminal', 1,
    'commercial_checkout_sessions_terminalized', 1,
    'commercial_stripe_subscriptions_preserved_terminal', v_test_stripe_subscriptions,
    'settings_deleted', v_counts->'settings_rows',
    'filters_deleted', v_counts->'filters_rows',
    'targets_archived', v_counts->'targets_active',
    'verification_jobs_deleted', v_counts->'verification_jobs_nonhistorical',
    'protection_entries_disabled', v_counts->'protection_entries_active',
    'onboarding_sessions_abandoned', v_counts->'onboarding_sessions_active',
    'dashboard_actions_resolved', v_counts->'dashboard_actions_nonhistorical',
    'client_account_entitlements_cancelled', 1,
    'account_incidents_resolved', (select count(*) from public.account_incidents i where i.account_id = p_account_id and i.status <> 'resolved'),
    'test_instagram_onboarding_rollbacks', 1,
    'commercial_checkout_audit_events', 1
  );
  v_before := jsonb_build_object(
    'account_status', v_account.status,
    'admin_lifecycle_status', v_account.admin_lifecycle_status,
    'username', v_account.username,
    'entitlement_status', v_entitlement.status,
    'checkout_status', v_checkout.status,
    'assignment_status', v_assignment.status,
    'app_instance_status', v_instance.status,
    'client_link_active', v_link.active,
    'capacity_status', v_link.capacity_status
  );

  if p_dry_run then
    return jsonb_build_object(
      'ok', true,
      'reason', 'dry_run_pass',
      'dry_run', true,
      'account_id', p_account_id,
      'tenant_id', p_tenant_id,
      'entitlement_id', p_entitlement_id,
      'onboarding_session_id', v_onboarding_session.id,
      'assignment_id', v_assignment.id,
      'app_instance_id', v_instance.id,
      'idempotency_key_prefix', left(v_idempotency_hash, 12),
      'guards', jsonb_build_object(
        'account_exact', true, 'username_exact', true, 'tenant_exact', true,
        'entitlement_exact', true, 'checkout_test_exact', true, 'package_exact', true,
        'onboarding_session_exact', true, 'target_capacity_exact', true,
        'zero_live_stripe_attempts', true, 'zero_live_stripe_subscriptions', true,
        'test_stripe_subscriptions_terminal', true,
        'entitlement_consumed_by_account', true, 'zero_active_requests', true,
        'zero_active_runs', true, 'zero_active_locks', true, 'zero_auto_login', true,
        'device_idle', true, 'assignment_occupant_exact', true,
        'zero_active_dependencies', true, 'unrelated_accounts_identity_excluded', true,
        'other_tenant_account_count_assumption_removed', true,
        'incident_existence_not_required', true,
        'idempotency_fingerprint_available', true
      ),
      'counts', v_counts,
      'historical_rows_preserved', jsonb_build_object(
        'requests', v_counts->'historical_requests', 'runs', v_counts->'historical_runs',
        'action_logs', v_counts->'historical_action_logs', 'incidents', v_counts->'historical_incidents',
        'ct_audit_events', v_counts->'ct_audit_events_historical',
        'protection_events', v_counts->'protection_events_historical'
      ),
      'planned_mutations', v_planned
    );
  end if;

  begin
    v_credential_result := public.revoke_instagram_account_credentials(
      p_account_id, 'instagram', 'test_onboarding_rollback', v_request_id
    );
    if coalesce((v_credential_result->>'ok')::boolean, false) is not true
       or coalesce(v_credential_result->>'vault_cleanup_status', '') not in ('neutralized', 'not_found', 'not_applicable', 'partial_neutralized') then
      raise exception 'credential_or_vault_revoke_failed';
    end if;

    v_release_result := public.release_account_schedule_capacity(
      p_account_id, 'test_onboarding_rollback', 'test_onboarding_rollback_v2', auth.uid()
    );
    if coalesce((v_release_result->>'ok')::boolean, false) is not true then
      raise exception 'assignment_release_failed';
    end if;
    if exists (select 1 from public.account_assignments a where a.id = v_assignment.id and a.status in ('pending', 'reserved', 'active')) then
      raise exception 'assignment_still_open_after_release';
    end if;
    if exists (select 1 from public.phone_app_instances i where i.id = v_instance.id and (i.status <> 'available' or i.current_account_id is not null)) then
      raise exception 'app_instance_still_occupied_after_release';
    end if;
    if coalesce((v_release_result->>'released_count')::integer, 0) <> 1 then
      raise exception 'capacity_release_delta_not_one';
    end if;
    if coalesce((v_release_result->>'app_instances_released_count')::integer, 0) <> 1 then
      raise exception 'app_instance_release_delta_not_one';
    end if;

    update public.client_subscription_accounts
       set status = 'removed', updated_at = v_now
     where account_id = p_account_id and status = 'active';
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('client_subscription_accounts_removed', v_rows);

    update public.account_commercial_packages
       set status = 'rolled_back_test_onboarding', ends_at = coalesce(ends_at, v_now), updated_at = v_now,
           metadata_safe = coalesce(metadata_safe, '{}'::jsonb) || jsonb_build_object('rollback_request_id', v_request_id, 'source', 'test_onboarding_rollback_v2')
     where account_id = p_account_id and status = 'active';
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('account_commercial_packages_rolled_back', v_rows);

    update public.account_commercial_addons
       set status = 'rolled_back_test_onboarding', ends_at = coalesce(ends_at, v_now), updated_at = v_now,
           metadata_safe = coalesce(metadata_safe, '{}'::jsonb) || jsonb_build_object('rollback_request_id', v_request_id, 'source', 'test_onboarding_rollback_v2')
     where account_id = p_account_id and status = 'active';
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('account_commercial_addons_rolled_back', v_rows);

    delete from public.ig_account_settings where account_id = p_account_id;
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('ig_account_settings_deleted', v_rows);
    delete from public.ig_account_dm_settings where account_id = p_account_id;
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('ig_account_dm_settings_deleted', v_rows);
    delete from public.ig_account_unfollow_settings where account_id = p_account_id;
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('ig_account_unfollow_settings_deleted', v_rows);
    delete from public.ig_account_follow_settings where account_id = p_account_id;
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('ig_account_follow_settings_deleted', v_rows);
    delete from public.account_follow_source_settings where account_id = p_account_id;
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('account_follow_source_settings_deleted', v_rows);
    delete from public.account_warmup_settings where account_id = p_account_id;
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('account_warmup_settings_deleted', v_rows);
    delete from public.ig_account_filters where account_id = p_account_id;
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('ig_account_filters_deleted', v_rows);

    update public.ig_dm_templates set active = false, updated_at = v_now
     where account_id = p_account_id and active = true;
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('ig_dm_templates_disabled', v_rows);
    update public.client_entitlements set active = false, updated_at = v_now
     where account_id = p_account_id and active = true;
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('client_entitlements_disabled', v_rows);

    update public.ig_targets
       set status = 'archived', archived_at = coalesce(archived_at, v_now),
           archive_reason = 'test_onboarding_rollback', updated_at = v_now,
           metadata_safe = coalesce(metadata_safe, '{}'::jsonb) || jsonb_build_object('rollback_request_id', v_request_id, 'source', 'test_onboarding_rollback_v2')
     where account_id = p_account_id and archived_at is null and deleted_at is null;
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('ig_targets_archived', v_rows);

    delete from public.ct_target_verification_jobs
     where account_id = p_account_id and status in ('pending', 'processing', 'retry_scheduled');
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('ct_target_verification_jobs_deleted', v_rows);

    for v_kind in
      select distinct e.list_kind from public.account_protection_list_entries e
      where e.account_id = p_account_id and e.active = true
    loop
      select coalesce(v.version, 0) into v_previous_version
      from public.account_protection_list_versions v
      where v.account_id = p_account_id and v.list_kind = v_kind
      for update;
      v_previous_version := coalesce(v_previous_version, 0);
      v_new_version := v_previous_version + 1;
      insert into public.account_protection_list_versions(account_id, list_kind, version, updated_at)
      values (p_account_id, v_kind, v_new_version, v_now)
      on conflict (account_id, list_kind) do update set version = excluded.version, updated_at = excluded.updated_at;
      update public.account_protection_list_entries
         set active = false, version = v_new_version, updated_at = v_now, updated_by_auth_user_id = auth.uid()
       where account_id = p_account_id and list_kind = v_kind and active = true;
      get diagnostics v_rows = row_count;
      v_count := v_count + v_rows;
      insert into public.account_protection_list_events(
        account_id, list_kind, normalized_username, action, source_surface,
        actor_auth_user_id, request_id, idempotency_key, previous_version,
        new_version, metadata_safe, created_at
      ) values (
        p_account_id, v_kind, null, 'clear', 'test_onboarding_rollback_v2',
        auth.uid(), v_request_id, left(v_idempotency_hash, 64), v_previous_version,
        v_new_version, jsonb_build_object('entries_disabled', v_rows, 'reason', v_reason), v_now
      );
    end loop;
    v_changed := v_changed || jsonb_build_object('protection_entries_disabled', v_count);

    update public.client_instagram_onboarding_sessions
       set status = 'abandoned', abandoned_at = coalesce(abandoned_at, v_now),
           lease_owner = null, lease_expires_at = null,
           failure_reason = 'test_onboarding_rollback', updated_at = v_now
     where account_id = p_account_id and status in ('creating', 'active');
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('onboarding_sessions_abandoned', v_rows);

    update public.account_dashboard_actions
       set status = 'resolved', resolved_at = coalesce(resolved_at, v_now), updated_at = v_now,
           metadata_safe = coalesce(metadata_safe, '{}'::jsonb) || jsonb_build_object('resolution_reason', 'test_onboarding_rollback', 'rollback_request_id', v_request_id)
     where account_id = p_account_id and status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted');
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('dashboard_actions_resolved', v_rows);
    update public.client_account_notifications
       set status = 'resolved', resolved_at = coalesce(resolved_at, v_now)
     where account_id = p_account_id and status = 'active';
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('client_notifications_resolved', v_rows);


    insert into public.commercial_account_lifecycle_operations(
      id, account_id, entitlement_id, operation_type, idempotency_key,
      state, reason, actor_type, actor_id, source_surface, metadata_safe,
      created_at, updated_at
    ) values (
      v_audit_id, p_account_id, p_entitlement_id, 'cancel',
      'test-onboarding-rollback-v2:' || v_idempotency_hash,
      'completed', v_reason, v_actor_role, auth.uid(),
      'test_onboarding_rollback_v2',
      jsonb_build_object(
        'request_id', v_request_id,
        'checkout_id', p_expected_checkout_id,
        'capacity_release_delta', coalesce((v_release_result->>'released_count')::integer, 0),
        'source', 'test_onboarding_rollback_v2'
      ),
      v_now, v_now
    );
    v_changed := v_changed || jsonb_build_object('commercial_account_lifecycle_operations_inserted', 1);

    update public.client_instagram_accounts
       set active = false,
           onboarding_status = 'blocked', provisioning_status = 'paused', login_status = 'logged_out',
           capacity_status = 'released_terminal',
           capacity_released_at = v_now,
           capacity_release_reason = 'test_onboarding_rollback',
           capacity_release_operation_id = v_audit_id,
           onboarding_rollback_at = v_now, onboarding_rollback_id = v_audit_id, updated_at = v_now
     where id = v_link.id and active = true;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'client_link_tombstone_failed'; end if;
    v_changed := v_changed || jsonb_build_object('client_instagram_accounts_tombstoned', v_rows);

    update public.client_account_entitlements
       set status = 'entitlement_cancelled', updated_at = v_now,
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
             'rollback_reason', v_reason, 'rolled_back_account_id', p_account_id,
             'rolled_back_at', v_now, 'rollback_request_id', v_request_id,
             'source', 'test_onboarding_rollback_v2', 'reusable', false
           )
     where id = p_entitlement_id and status = 'entitlement_consumed' and account_id = p_account_id;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'entitlement_cancel_failed'; end if;
    v_changed := v_changed || jsonb_build_object('client_account_entitlements_cancelled', v_rows);

    update public.commercial_checkout_sessions
       set status = 'checkout_cancelled',
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
             'rollback_reason', v_reason,
             'rolled_back_account_id', p_account_id,
             'rolled_back_at', v_now,
             'rollback_request_id', v_request_id,
             'source', 'test_onboarding_rollback_v2',
             'terminal_non_reusable', true
           ),
           updated_at = v_now
     where id = p_expected_checkout_id
       and client_id = p_tenant_id
       and status <> 'checkout_cancelled';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'test_checkout_terminalization_failed'; end if;
    v_changed := v_changed || jsonb_build_object('commercial_checkout_sessions_terminalized', v_rows);

    update public.account_incidents
       set status = 'resolved', resolved_at = coalesce(resolved_at, v_now),
           resolution_reason = 'test_onboarding_rollback',
           resolution_note = 'Preserved and resolved by the transactionally audited generic Test onboarding rollback.',
           updated_at = v_now
     where account_id = p_account_id and status <> 'resolved';
    get diagnostics v_rows = row_count;
    v_changed := v_changed || jsonb_build_object('account_incidents_resolved', v_rows);

    v_tombstone_username := 'rb_test_' || left(replace(p_account_id::text, '-', ''), 20);
    update public.ig_accounts
       set username = v_tombstone_username,
           status = 'rolled_back_test_onboarding', admin_lifecycle_status = 'cancelled',
           email = null, password = null, device_id = null,
           username_verification_status = 'unknown',
           username_verification_reason = 'test_onboarding_rollback',
           updated_at = v_now
     where id = p_account_id and lower(btrim(username)) = v_expected_username;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'account_tombstone_failed'; end if;
    v_changed := v_changed || jsonb_build_object('ig_accounts_tombstoned', v_rows);

    v_changed := v_changed || jsonb_build_object(
      'account_credentials_revoked', coalesce((v_credential_result->>'credentials_revoked')::integer, 0),
      'account_assignments_released', coalesce((v_release_result->>'released_count')::integer, 0),
      'phone_app_instances_released', coalesce((v_release_result->>'app_instances_released_count')::integer, 0)
    );
    v_after := jsonb_build_object(
      'account_status', 'rolled_back_test_onboarding',
      'admin_lifecycle_status', 'cancelled',
      'username', v_tombstone_username,
      'entitlement_status', 'entitlement_cancelled',
      'checkout_status', 'checkout_cancelled',
      'assignment_status', 'released',
      'app_instance_status', 'available',
      'client_link_active', false,
      'capacity_status', 'released_terminal',
      'vault_cleanup_status', v_credential_result->>'vault_cleanup_status'
    );

    insert into public.commercial_checkout_audit_events(
      checkout_session_id, entitlement_id, event_type, actor_email, client_id, payload, created_at
    ) values (
      p_expected_checkout_id, p_entitlement_id, 'test_instagram_onboarding_rolled_back', null, p_tenant_id,
      jsonb_build_object(
        'account_id', p_account_id, 'request_id', v_request_id,
        'reason', v_reason, 'source', 'test_onboarding_rollback_v2',
        'audit_id', v_audit_id
      ), v_now
    );
    v_changed := v_changed || jsonb_build_object('commercial_checkout_audit_events_inserted', 1);

    insert into public.test_instagram_onboarding_rollbacks(
      id, account_id, tenant_id, entitlement_id, checkout_id,
      expected_username, expected_package, request_id, idempotency_key_hash,
      idempotency_key_prefix, input_fingerprint, reason, actor_id, actor_role,
      counts_before, records_changed, before_status, after_status, result,
      created_at, completed_at
    ) values (
      v_audit_id, p_account_id, p_tenant_id, p_entitlement_id, p_expected_checkout_id,
      v_expected_username, v_expected_package, v_request_id, v_idempotency_hash,
      left(v_idempotency_hash, 12), v_fingerprint, v_reason, auth.uid(), v_actor_role,
      v_counts, v_changed, v_before, v_after, 'completed', v_now, v_now
    );
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'reason', 'transaction_failed',
      'error_code', sqlstate,
      'error_safe', left(sqlerrm, 160),
      'dry_run', false,
      'account_id', p_account_id
    );
  end;

  return jsonb_build_object(
    'ok', true,
    'reason', 'rolled_back',
    'dry_run', false,
    'account_id', p_account_id,
    'tenant_id', p_tenant_id,
    'entitlement_id', p_entitlement_id,
    'onboarding_session_id', v_onboarding_session.id,
    'assignment_id', v_assignment.id,
    'app_instance_id', v_instance.id,
    'audit_id', v_audit_id,
    'tombstone_username', v_tombstone_username,
    'credential_revocation', v_credential_result,
    'assignment_release', v_release_result,
    'records_changed', v_changed,
    'history_preserved', true,
    'ready_to_restart_onboarding', true
  );
end;
$function$
