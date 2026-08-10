begin;

alter table public.client_instagram_accounts
  add column if not exists login_identity_verification_source text,
  add column if not exists login_identity_verification_method text,
  add column if not exists login_identity_verified_by text,
  add column if not exists login_identity_verified_account_id uuid,
  add column if not exists login_identity_verified_device_id uuid,
  add column if not exists login_identity_verified_app_instance_id uuid,
  add column if not exists login_identity_verified_assignment_id uuid,
  add column if not exists login_identity_login_lineage jsonb not null default '{}'::jsonb;

alter table public.client_instagram_accounts
  drop constraint if exists cia_login_identity_source_check,
  add constraint cia_login_identity_source_check
    check (login_identity_verification_source is null or login_identity_verification_source in ('worker', 'operator')),
  drop constraint if exists cia_login_identity_lineage_object_check,
  add constraint cia_login_identity_lineage_object_check
    check (jsonb_typeof(login_identity_login_lineage) = 'object');

comment on column public.client_instagram_accounts.login_identity_verification_source is
  'Canonical identity proof producer. Only worker and operator are accepted.';
comment on column public.client_instagram_accounts.login_identity_verification_method is
  'Stable verification method. Operator confirmation uses manual_phone_review.';
comment on column public.client_instagram_accounts.login_identity_verified_by is
  'Audited worker or operator identity that produced the canonical proof.';
comment on column public.client_instagram_accounts.login_identity_login_lineage is
  'Secret-free assignment/login lineage captured with the canonical proof.';

-- Before this migration, only the Worker identity guard could create a
-- verified canonical proof. Preserve that fact explicitly for existing rows;
-- operator provenance is introduced only by the RPC below.
update public.client_instagram_accounts
set login_identity_verification_source = 'worker',
    login_identity_verification_method = coalesce(
      nullif(login_identity_verification_method, ''),
      'own_profile_identity_guard'
    ),
    login_identity_verified_by = coalesce(
      nullif(login_identity_verified_by, ''),
      'worker'
    ),
    login_identity_verified_account_id = account_id,
    login_identity_login_lineage = coalesce(login_identity_login_lineage, '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
        'source_run_id', login_identity_source_run_id,
        'proof_version', login_identity_proof_version,
        'provenance_backfill', 'pre_operator_worker_only_contract'
      ))
where login_identity_proof_status = 'verified'
  and login_identity_verified_at is not null
  and login_identity_verification_source is null;

create or replace function public.stamp_worker_login_identity_provenance_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.login_identity_proof_status = 'verified'
     and new.login_identity_verified_at is not null
     and new.login_identity_verification_source is null then
    new.login_identity_verification_source := 'worker';
    new.login_identity_verification_method := coalesce(
      nullif(new.login_identity_verification_method, ''),
      'own_profile_identity_guard'
    );
    new.login_identity_verified_by := coalesce(
      nullif(new.login_identity_verified_by, ''),
      'worker'
    );
    new.login_identity_verified_account_id := new.account_id;
    new.login_identity_login_lineage := coalesce(new.login_identity_login_lineage, '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
        'source_run_id', new.login_identity_source_run_id,
        'proof_version', new.login_identity_proof_version
      ));
  end if;
  return new;
end;
$$;

drop trigger if exists a_stamp_worker_login_identity_provenance_v1
  on public.client_instagram_accounts;
create trigger a_stamp_worker_login_identity_provenance_v1
before insert or update of
  login_identity_proof_status,
  login_identity_verified_at,
  login_identity_verification_source
on public.client_instagram_accounts
for each row
execute function public.stamp_worker_login_identity_provenance_v1();

create or replace function public.confirm_instagram_login_operator_v1(
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
  v_now timestamptz := now();
  v_account public.ig_accounts%rowtype;
  v_client public.client_instagram_accounts%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_device public.phone_devices%rowtype;
  v_instance public.phone_app_instances%rowtype;
  v_contract jsonb;
  v_incident public.account_incidents%rowtype;
  v_resolution jsonb := jsonb_build_object(
    'incident_resolved', false,
    'dashboard_action_resolved', false,
    'resume_authorization_created', false,
    'next_tick_eligible', false,
    'blocked_reason', 'no_linked_incident'
  );
  v_canonical_username text;
  v_blocker text;
  v_eligible_targets integer := 0;
  v_idempotent boolean := false;
begin
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
      and archived_at is null
    for update;
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

  select * into v_account
  from public.ig_accounts
  where id = p_account_id
  for update;
  if v_account.id is null then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;
  if lower(coalesce(v_account.admin_lifecycle_status, v_account.status, '')) <> 'active'
     or lower(coalesce(v_account.status, '')) in ('archived', 'trashed', 'deleted', 'cancelled', 'canceled') then
    v_blocker := 'account_lifecycle_blocked';
  end if;

  select * into v_client
  from public.client_instagram_accounts
  where account_id = p_account_id and active = true
  for update;
  if v_client.account_id is null then
    raise exception 'client_instagram_account_not_found' using errcode = 'P0002';
  end if;

  select * into v_assignment
  from public.account_assignments
  where account_id = p_account_id
    and released_at is null
    and status in ('reserved', 'active')
    and (p_assignment_id is null or id = p_assignment_id)
  order by case when id = p_assignment_id then 0 else 1 end,
           id
  limit 1
  for update;
  if v_blocker is null and (
    v_assignment.id is null
    or v_assignment.device_id is null
    or v_assignment.app_instance_id is null
  ) then
    v_blocker := 'assignment_not_ready';
  end if;

  if v_assignment.device_id is not null then
    select * into v_device from public.phone_devices where id = v_assignment.device_id;
  end if;
  if v_assignment.app_instance_id is not null then
    select * into v_instance from public.phone_app_instances where id = v_assignment.app_instance_id;
  end if;
  if v_blocker is null and (
    v_device.id is null
    or lower(coalesce(v_device.status, '')) not in ('available', 'active', 'online')
    or v_instance.id is null
    or v_instance.device_id is distinct from v_assignment.device_id
    or lower(coalesce(v_instance.status, '')) not in ('available', 'occupied')
    or not coalesce(v_instance.usable_for_auto_login, false)
    or not coalesce(v_instance.is_launchable, false)
  ) then
    v_blocker := 'assigned_phone_or_app_instance_not_ready';
  end if;

  if v_blocker is null and not exists (
    select 1 from public.account_credentials ac
    where ac.account_id = p_account_id
      and ac.provider = 'instagram'
      and ac.status in ('active', 'configured')
      and not coalesce(ac.reauth_required, false)
  ) then
    v_blocker := 'credentials_not_ready';
  end if;

  if v_blocker is null then
    v_contract := public.account_package_runtime_contract_status(p_account_id);
    if not coalesce((v_contract ->> 'ok')::boolean, false) then
      v_blocker := coalesce(v_contract ->> 'reason', 'package_settings_incomplete');
    end if;
  end if;

  select count(*)::integer into v_eligible_targets
  from public.ig_targets t
  where t.account_id = p_account_id
    and lower(coalesce(t.status, '')) in ('valid', 'active')
    and lower(coalesce(t.quality_status, '')) = 'eligible'
    and lower(coalesce(t.verification_status, '')) = 'found'
    and t.archived_at is null
    and t.deleted_at is null;
  if v_blocker is null and v_eligible_targets = 0 then
    v_blocker := 'no_eligible_ct';
  end if;

  if v_blocker is null and exists (
    select 1 from public.account_dashboard_actions a
    where a.account_id = p_account_id
      and a.status in ('pending', 'acknowledged', 'pending_verification')
      and coalesce(a.blocking_campaign, false)
      and (p_incident_id is null or a.incident_id is distinct from p_incident_id)
  ) then
    v_blocker := 'other_blocking_dashboard_action';
  end if;
  if v_blocker is null and exists (
    select 1 from public.account_run_requests q
    where q.account_id = p_account_id and q.status in ('queued', 'claimed', 'starting', 'running')
  ) then
    v_blocker := 'active_request_exists';
  end if;
  if v_blocker is null and exists (
    select 1 from public.ig_runs r
    where r.account_id = p_account_id and r.status in ('queued', 'pending', 'starting', 'running', 'in_progress', 'active')
  ) then
    v_blocker := 'active_run_exists';
  end if;

  v_canonical_username := public.normalize_instagram_identity_username_v1(v_account.username);
  if v_blocker is null and v_canonical_username = '' then
    v_blocker := 'canonical_username_missing';
  end if;

  if v_blocker is not null then
    return jsonb_build_object(
      'ok', false,
      'ready', false,
      'proof_created', false,
      'reason', v_blocker,
      'account_id', p_account_id,
      'assignment_id', v_assignment.id,
      'device_id', v_assignment.device_id,
      'app_instance_id', v_assignment.app_instance_id,
      'eligible_targets', v_eligible_targets,
      'run_started', false
    );
  end if;

  v_idempotent :=
    v_client.login_identity_proof_status = 'verified'
    and v_client.login_identity_verification_source = 'operator'
    and v_client.login_identity_verification_method = 'manual_phone_review'
    and v_client.login_identity_verified_by = p_operator_id::text
    and v_client.login_identity_verified_assignment_id = v_assignment.id;

  update public.client_instagram_accounts
  set login_identity_proof_status = 'verified',
      login_identity_expected_username = v_canonical_username,
      login_identity_detected_username = v_canonical_username,
      login_identity_profile_opened = true,
      login_identity_username_match = true,
      login_identity_verified_at = case when v_idempotent then login_identity_verified_at else v_now end,
      login_identity_source_run_id = login_identity_source_run_id,
      login_identity_failure_reason = null,
      login_identity_proof_version = greatest(login_identity_proof_version, 1),
      login_identity_verification_source = 'operator',
      login_identity_verification_method = 'manual_phone_review',
      login_identity_verified_by = p_operator_id::text,
      login_identity_verified_account_id = p_account_id,
      login_identity_verified_device_id = v_assignment.device_id,
      login_identity_verified_app_instance_id = v_assignment.app_instance_id,
      login_identity_verified_assignment_id = v_assignment.id,
      login_identity_login_lineage = jsonb_strip_nulls(jsonb_build_object(
        'account_id', p_account_id,
        'assignment_id', v_assignment.id,
        'device_id', v_assignment.device_id,
        'app_instance_id', v_assignment.app_instance_id,
        'incident_id', p_incident_id,
        'idempotency_key', p_idempotency_key,
        'verified_at', case when v_idempotent then login_identity_verified_at else v_now end
      )),
      login_state_source_at = case when v_idempotent then login_state_source_at else v_now end,
      login_state_version = case when v_idempotent then login_state_version else login_state_version + 1 end,
      login_state_invalidation_reason = null,
      login_status = 'connected',
      provisioning_status = 'ready',
      onboarding_status = 'ready',
      updated_at = v_now
  where account_id = p_account_id;

  update public.account_credentials
  set reauth_required = false,
      reauth_reason = null,
      updated_at = v_now
  where account_id = p_account_id
    and provider = 'instagram'
    and status in ('active', 'configured');

  perform public.sync_account_dashboard_actions_from_status(
    p_account_id := p_account_id,
    p_actor_type := 'admin',
    p_reason := 'operator_confirmed_login',
    p_external_request_id := p_idempotency_key,
    p_metadata := jsonb_build_object(
      'verification_source', 'operator',
      'verification_method', 'manual_phone_review',
      'operator_id', p_operator_id,
      'assignment_id', v_assignment.id,
      'device_id', v_assignment.device_id,
      'app_instance_id', v_assignment.app_instance_id,
      'incident_id', p_incident_id
    )
  );

  if v_incident.id is not null then
    v_resolution := public.transition_account_incident_human_review_v2(
      p_incident_id := v_incident.id,
      p_action := 'resolve',
      p_expected_version := v_incident.lifecycle_version,
      p_actor_type := 'ops',
      p_actor_id := p_operator_id,
      p_source := 'confirm_login_readiness',
      p_note := 'Instagram login manually verified on the canonical assigned app instance.',
      p_resolution_reason := 'operator_login_identity_verified',
      p_idempotency_key := p_idempotency_key || ':incident',
      p_expected_worker_sha := lower(btrim(p_expected_worker_sha)),
      p_cause_fixed_version := btrim(p_cause_fixed_version),
      p_channel := null,
      p_notification_id := null
    );
    if coalesce((v_resolution ->> 'incident_resolved')::boolean, false) is not true
       or coalesce((v_resolution ->> 'dashboard_action_resolved')::boolean, false) is not true then
      raise exception 'operator_confirmation_linked_incident_not_terminalized';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'ready', true,
    'proof_created', not v_idempotent,
    'idempotent', v_idempotent,
    'reason', case when v_idempotent then 'operator_proof_already_current' else 'operator_login_confirmed' end,
    'account_id', p_account_id,
    'assignment_id', v_assignment.id,
    'device_id', v_assignment.device_id,
    'app_instance_id', v_assignment.app_instance_id,
    'verification_source', 'operator',
    'verification_method', 'manual_phone_review',
    'verified_by', p_operator_id,
    'verified_at', (select login_identity_verified_at from public.client_instagram_accounts where account_id = p_account_id),
    'eligible_targets', v_eligible_targets,
    'run_started', false
  ) || v_resolution;
end;
$$;

revoke all on function public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text)
  to service_role;

comment on function public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text) is
  'Fail-closed atomic operator login confirmation. Revalidates canonical gates, persists one operator proof, resolves the linked incident/action, reconciles resume authorization, and never creates a run.';

commit;
