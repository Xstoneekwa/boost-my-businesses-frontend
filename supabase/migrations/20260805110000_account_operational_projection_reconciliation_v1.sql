-- Account operational projection reconciliation V1.
--
-- Repairs a narrow legacy drift where the canonical admin lifecycle and an
-- assignment are active, while ig_accounts.status and/or
-- ig_account_settings.account_status remain inactive.  No schedule, package,
-- phase, quota, checkpoint, protection list, incident, or runtime row is
-- changed by this RPC.

create or replace function public.reconcile_account_operational_projection_v1(
  p_account_id uuid,
  p_source text,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.ig_accounts%rowtype;
  v_settings public.ig_account_settings%rowtype;
  v_source text := lower(trim(coalesce(p_source, '')));
  v_now timestamptz := now();
  v_changed boolean := false;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;
  if v_source not in ('schedule_assignment', 'commercial_resume', 'operator_reconciliation') then
    raise exception 'projection_reconciliation_source_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'account_operational_projection:' || p_account_id::text,
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

  select * into v_settings
  from public.ig_account_settings
  where account_id = p_account_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'account_settings_missing');
  end if;

  if exists (
    select 1 from public.account_run_requests r
    where r.account_id = p_account_id
      and r.status in ('pending', 'queued', 'claimed', 'processing', 'running')
  ) or exists (
    select 1 from public.ig_runs r
    where r.account_id = p_account_id
      and r.status in ('pending', 'queued', 'processing', 'running')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'account_runtime_active');
  end if;

  if not exists (
    select 1 from public.client_instagram_accounts c
    where c.account_id = p_account_id
      and c.active is true
      and c.onboarding_status = 'ready'
      and c.provisioning_status = 'ready'
      and c.login_status = 'connected'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'client_instagram_account_not_ready');
  end if;

  if not exists (
    select 1 from public.account_credentials c
    where c.account_id = p_account_id
      and c.status = 'active'
      and coalesce(c.reauth_required, false) is false
      and nullif(trim(coalesce(c.secret_ref, '')), '') is not null
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
        nullif(trim(coalesce(i.action_required, '')), '') is not null
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

  if v_changed then
    insert into public.ig_action_logs (
      account_id, run_id, target_username, action_type, status, message, payload, created_at
    ) values (
      p_account_id,
      null,
      null,
      'account_operational_projection_reconciled',
      'success',
      'Canonical active lifecycle reconciled to legacy operational projections.',
      jsonb_build_object(
        'source', v_source,
        'actor_id', p_actor_id,
        'old_account_status', v_account.status,
        'old_settings_account_status', v_settings.account_status,
        'old_current_run_status', v_settings.current_run_status,
        'new_account_status', 'active',
        'new_settings_account_status', 'active',
        'new_current_run_status', 'idle',
        'runtime_started', false,
        'schedule_changed', false,
        'package_changed', false,
        'phase_flags_changed', false,
        'caps_changed', false
      ),
      v_now
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', case when v_changed then 'operational_projection_reconciled' else 'already_converged' end,
    'changed', v_changed,
    'account_id', p_account_id,
    'account_status', 'active',
    'settings_account_status', 'active',
    'current_run_status', 'idle'
  );
end
$$;

revoke all on function public.reconcile_account_operational_projection_v1(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_account_operational_projection_v1(uuid, text, uuid)
  to service_role;

comment on function public.reconcile_account_operational_projection_v1(uuid, text, uuid) is
  'Atomically repairs only legacy active-account status projections after strict readiness and safety gates; never changes schedules, packages, phases, caps, checkpoints, protection lists, incidents, or runtime rows.';
