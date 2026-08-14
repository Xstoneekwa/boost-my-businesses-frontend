-- Commercial resume blocker preflight and recovery V1.
--
-- A commercial resume must not mutate Stripe or lifecycle projections until
-- active dashboard actions and incidents have been checked.  Resolved linked
-- incidents may leave an old action in an active status; that drift is
-- reconciled in place without deleting either audit row.

create or replace function public.reconcile_commercial_resume_blockers_v1(
  p_account_id uuid,
  p_source text default 'commercial_resume_preflight'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text := left(coalesce(nullif(btrim(p_source), ''), 'commercial_resume_preflight'), 120);
  v_reconciled_count integer := 0;
  v_blocking_action record;
  v_blocking_incident record;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'commercial_resume_blockers:' || p_account_id::text,
    0
  ));

  -- Preserve the action and incident rows.  Only make the action projection
  -- agree with a linked incident that is unambiguously terminal.
  update public.account_dashboard_actions a
  set status = 'resolved',
      blocking_campaign = false,
      requires_client_action = false,
      resolved_at = coalesce(a.resolved_at, i.resolved_at, i.archived_at, now()),
      updated_at = now(),
      metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object(
        'commercial_resume_reconciled_at', now(),
        'commercial_resume_reconciled_source', v_source,
        'commercial_resume_reconciled_reason', 'linked_incident_terminal',
        'commercial_resume_reconciliation_contract',
          'commercial_resume_blocker_preflight_and_recovery_v1'
      )
  from public.account_incidents i
  where a.account_id = p_account_id
    and i.id = a.incident_id
    and i.account_id = a.account_id
    and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
    and (
      coalesce(a.blocking_campaign, false)
      or a.action_type in ('operator_review_required', 'review_auto_restart_hard_stop')
      or a.status = 'pending_verification'
    )
    and (
      (i.status = 'resolved' and i.resolved_at is not null)
      or i.archived_at is not null
    );
  get diagnostics v_reconciled_count = row_count;

  select
    a.id,
    a.action_type,
    a.status,
    a.incident_id
  into v_blocking_action
  from public.account_dashboard_actions a
  left join public.account_incidents i
    on i.id = a.incident_id
   and i.account_id = a.account_id
  where a.account_id = p_account_id
    and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
    and (
      coalesce(a.blocking_campaign, false)
      or a.action_type in ('operator_review_required', 'review_auto_restart_hard_stop')
      or a.status = 'pending_verification'
    )
    and not (
      i.id is not null
      and (
        (i.status = 'resolved' and i.resolved_at is not null)
        or i.archived_at is not null
      )
    )
  order by a.created_at asc, a.id asc
  limit 1;

  if v_blocking_action.id is not null then
    return jsonb_strip_nulls(jsonb_build_object(
      'ok', false,
      'reason', 'blocking_dashboard_action_active',
      'account_id', p_account_id,
      'blocking_action_id', v_blocking_action.id,
      'blocking_action_type', v_blocking_action.action_type,
      'blocking_action_status', v_blocking_action.status,
      'linked_incident_id', v_blocking_action.incident_id,
      'reconciled_count', v_reconciled_count,
      'contract_version', 'commercial_resume_blocker_preflight_and_recovery_v1'
    ));
  end if;

  select i.id, i.incident_type, i.status
  into v_blocking_incident
  from public.account_incidents i
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
  order by i.created_at asc, i.id asc
  limit 1;

  if v_blocking_incident.id is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'blocking_incident_active',
      'account_id', p_account_id,
      'blocking_incident_id', v_blocking_incident.id,
      'blocking_incident_type', v_blocking_incident.incident_type,
      'blocking_incident_status', v_blocking_incident.status,
      'reconciled_count', v_reconciled_count,
      'contract_version', 'commercial_resume_blocker_preflight_and_recovery_v1'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', 'commercial_resume_preflight_clear',
    'account_id', p_account_id,
    'reconciled_count', v_reconciled_count,
    'contract_version', 'commercial_resume_blocker_preflight_and_recovery_v1'
  );
end
$$;

revoke all on function public.reconcile_commercial_resume_blockers_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_commercial_resume_blockers_v1(uuid, text)
  to service_role;

comment on function public.reconcile_commercial_resume_blockers_v1(uuid, text) is
  'Service-role-only commercial resume preflight: reconciles only actions linked to terminal incidents, preserves history, and fails closed for every genuinely active action or incident blocker.';
