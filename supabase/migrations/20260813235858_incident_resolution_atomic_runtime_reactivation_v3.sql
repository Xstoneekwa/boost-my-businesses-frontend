-- Incident resolution atomic runtime reactivation V3.
--
-- `Resolve after verification` is the sole operator gesture required to end
-- an operator-review runtime pause.  This transition is intentionally narrow:
-- it only restores `paused_manual_review` to `active`, never changes schedules
-- or commercial lifecycle state, and remains blocked while any other active
-- blocking operator-review incident exists for the same account.

create or replace function public.restore_resolved_operator_review_runtime_v3(
  p_account_id uuid,
  p_incident_id uuid,
  p_source text default 'incident_resolution'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.account_incidents%rowtype;
  v_previous_status text;
  v_reactivated boolean := false;
  v_blocked_reason text;
begin
  if p_account_id is null or p_incident_id is null then
    raise exception 'operator_review_runtime_restore_payload_invalid'
      using errcode = '22023';
  end if;

  select i.* into v_incident
  from public.account_incidents i
  where i.id = p_incident_id
    and i.account_id = p_account_id
  for update;

  if v_incident.id is null then
    raise exception 'incident_not_found' using errcode = 'P0002';
  elsif v_incident.status <> 'resolved' or v_incident.resolved_at is null then
    v_blocked_reason := 'incident_not_resolved';
  elsif left(lower(coalesce(v_incident.incident_type, '')), 9) = 'security_'
     or lower(coalesce(v_incident.metadata ->> 'security_incident', 'false'))
        in ('true', '1', 'yes') then
    v_blocked_reason := 'security_incident_forbidden';
  elsif exists (
    select 1
    from public.account_dashboard_actions a
    join public.account_incidents i
      on i.id = a.incident_id
     and i.account_id = a.account_id
     and i.status in ('open', 'acknowledged', 'investigating')
     and i.resolved_at is null
     and i.archived_at is null
    where a.account_id = p_account_id
      and a.action_type in (
        'operator_review_required',
        'review_auto_restart_hard_stop'
      )
      and a.status in (
        'pending',
        'acknowledged',
        'pending_verification',
        'code_submitted'
      )
      and coalesce(a.blocking_campaign, false)
  ) then
    v_blocked_reason := 'another_blocking_operator_review_exists';
  else
    select s.account_status into v_previous_status
    from public.ig_account_settings s
    where s.account_id = p_account_id
    for update;

    if lower(coalesce(v_previous_status, '')) = 'paused_manual_review' then
      update public.ig_account_settings
      set account_status = 'active',
          current_run_status = 'idle',
          updated_at = now()
      where account_id = p_account_id
        and lower(coalesce(account_status, '')) = 'paused_manual_review';
      v_reactivated := found;

      if v_reactivated then
        insert into public.ig_action_logs (
          account_id,
          run_id,
          target_username,
          action_type,
          status,
          message,
          payload,
          created_at
        ) values (
          p_account_id,
          v_incident.run_id,
          null,
          'operator_review_runtime_reactivated',
          'success',
          'Resolved operator-review incident atomically restored runtime eligibility.',
          jsonb_build_object(
            'incident_id', p_incident_id,
            'previous_runtime_status', v_previous_status,
            'runtime_status', 'active',
            'schedule_changed', false,
            'commercial_lifecycle_changed', false,
            'run_created', false,
            'tick_created', false,
            'source', left(coalesce(nullif(btrim(p_source), ''), 'incident_resolution'), 120),
            'contract_version', 'incident_resolution_atomic_runtime_reactivation_v3'
          ),
          now()
        );
      end if;
    elsif lower(coalesce(v_previous_status, '')) = 'active' then
      null;
    else
      v_blocked_reason := 'runtime_status_not_operator_review_pause';
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', v_blocked_reason is null,
    'account_id', p_account_id,
    'incident_id', p_incident_id,
    'runtime_reactivated', v_reactivated,
    'runtime_status', case when v_blocked_reason is null then 'active' else null end,
    'blocked_reason', v_blocked_reason,
    'schedule_changed', false,
    'commercial_lifecycle_changed', false,
    'run_created', false,
    'tick_created', false
  ));
end
$$;

revoke all on function public.restore_resolved_operator_review_runtime_v3(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.restore_resolved_operator_review_runtime_v3(
  uuid, uuid, text
) to service_role;

create or replace function public.project_resolved_operator_review_runtime_v3()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_id is null
     or new.incident_id is null
     or new.action_type not in (
       'operator_review_required',
       'review_auto_restart_hard_stop'
     )
     or new.status <> 'resolved'
     or coalesce(new.blocking_campaign, false) then
    return new;
  end if;

  perform public.restore_resolved_operator_review_runtime_v3(
    new.account_id,
    new.incident_id,
    'account_dashboard_actions_resolved_trigger_v3'
  );
  return new;
end
$$;

revoke all on function public.project_resolved_operator_review_runtime_v3()
  from public, anon, authenticated;
grant execute on function public.project_resolved_operator_review_runtime_v3()
  to service_role;

drop trigger if exists account_dashboard_action_runtime_resume_v3
  on public.account_dashboard_actions;
create trigger account_dashboard_action_runtime_resume_v3
after insert or update of status, blocking_campaign, action_type
on public.account_dashboard_actions
for each row
execute function public.project_resolved_operator_review_runtime_v3();

create or replace function public.reconcile_resolved_operator_review_runtime_v3(
  p_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_result jsonb;
  v_reactivated_count integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  for v_row in
    select distinct on (i.account_id)
      i.account_id,
      i.id as incident_id
    from public.account_incidents i
    join public.account_dashboard_actions a
      on a.incident_id = i.id
     and a.account_id = i.account_id
     and a.action_type in (
       'operator_review_required',
       'review_auto_restart_hard_stop'
     )
     and a.status = 'resolved'
     and coalesce(a.blocking_campaign, false) is false
    join public.ig_account_settings s
      on s.account_id = i.account_id
     and lower(coalesce(s.account_status, '')) = 'paused_manual_review'
    where (p_account_id is null or i.account_id = p_account_id)
      and i.status = 'resolved'
      and i.resolved_at is not null
      and i.archived_at is null
      and left(lower(coalesce(i.incident_type, '')), 9) <> 'security_'
      and lower(coalesce(i.metadata ->> 'security_incident', 'false'))
          not in ('true', '1', 'yes')
    order by i.account_id, i.resolved_at desc, i.id desc
  loop
    v_result := public.restore_resolved_operator_review_runtime_v3(
      v_row.account_id,
      v_row.incident_id,
      'resolved_operator_review_reconciliation_v3'
    );
    if coalesce((v_result ->> 'runtime_reactivated')::boolean, false) then
      v_reactivated_count := v_reactivated_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'reactivated_count', v_reactivated_count,
    'contract_version', 'incident_resolution_atomic_runtime_reactivation_v3'
  );
end
$$;

revoke all on function public.reconcile_resolved_operator_review_runtime_v3(uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_resolved_operator_review_runtime_v3(uuid)
  to service_role;

comment on function public.restore_resolved_operator_review_runtime_v3(uuid, uuid, text) is
  'Atomically restores only paused_manual_review to active after a non-security incident resolution when no other active blocking operator-review action exists; never changes schedules or commercial lifecycle state and never creates a run or tick.';

-- Repair accounts stranded by V1 between incident resolution and the missing
-- UI-only Active transition. Migration execution has no PostgREST JWT, so the
-- backfill calls the narrow restore primitive directly while the public
-- reconciliation RPC remains service-role-only.
do $$
declare
  v_row record;
begin
  for v_row in
    select distinct on (i.account_id)
      i.account_id,
      i.id as incident_id
    from public.account_incidents i
    join public.account_dashboard_actions a
      on a.incident_id = i.id
     and a.account_id = i.account_id
     and a.action_type in (
       'operator_review_required',
       'review_auto_restart_hard_stop'
     )
     and a.status = 'resolved'
     and coalesce(a.blocking_campaign, false) is false
    join public.ig_account_settings s
      on s.account_id = i.account_id
     and lower(coalesce(s.account_status, '')) = 'paused_manual_review'
    where i.status = 'resolved'
      and i.resolved_at is not null
      and i.archived_at is null
      and left(lower(coalesce(i.incident_type, '')), 9) <> 'security_'
      and lower(coalesce(i.metadata ->> 'security_incident', 'false'))
          not in ('true', '1', 'yes')
    order by i.account_id, i.resolved_at desc, i.id desc
  loop
    perform public.restore_resolved_operator_review_runtime_v3(
      v_row.account_id,
      v_row.incident_id,
      'migration_backfill_v3'
    );
  end loop;
end
$$;
