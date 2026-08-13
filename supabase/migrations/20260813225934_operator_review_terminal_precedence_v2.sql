-- Operator-review terminal precedence V2.
-- Historical/resolved actions remain auditable but cannot become authoritative
-- again after an explicit Active transition.

create or replace function public.project_operator_review_runtime_pause_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed boolean := false;
begin
  if new.account_id is null
     or new.action_type not in ('operator_review_required', 'review_auto_restart_hard_stop')
     or new.status not in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
     or coalesce(new.blocking_campaign, false) is false
     or not exists (
       select 1
       from public.account_incidents i
       where i.id = new.incident_id
         and i.account_id = new.account_id
         and i.status in ('open', 'acknowledged', 'investigating')
         and i.resolved_at is null
         and i.archived_at is null
     ) then
    return new;
  end if;

  update public.ig_account_settings
  set account_status = 'paused_manual_review',
      current_run_status = 'idle',
      updated_at = now()
  where account_id = new.account_id
    and (
      lower(coalesce(account_status, '')) <> 'paused_manual_review'
      or lower(coalesce(current_run_status, '')) <> 'idle'
    );
  v_changed := found;

  if v_changed then
    insert into public.ig_action_logs (
      account_id, run_id, target_username, action_type, status, message, payload, created_at
    ) values (
      new.account_id,
      null,
      null,
      'operator_review_runtime_paused',
      'success',
      'Active blocking operator-review incident projected to paused_manual_review.',
      jsonb_build_object(
        'dashboard_action_id', new.id,
        'incident_id', new.incident_id,
        'runtime_status', 'paused_manual_review',
        'scheduler_eligible', false,
        'auto_unpause', false,
        'terminal_incidents_ignored', true,
        'terminal_actions_ignored', true,
        'source', 'account_dashboard_actions_trigger_v2'
      ),
      now()
    );
  end if;
  return new;
end
$$;

revoke all on function public.project_operator_review_runtime_pause_v1()
  from public, anon, authenticated;
grant execute on function public.project_operator_review_runtime_pause_v1()
  to service_role;

comment on function public.project_operator_review_runtime_pause_v1() is
  'Projects only active blocking operator-review actions whose linked incident remains open; terminal incident/action history can never re-pause an explicitly active account.';
