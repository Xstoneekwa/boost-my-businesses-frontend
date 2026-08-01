-- Keep linked operator-review dashboard actions aligned with their canonical
-- incident.  The opposite direction already exists in
-- dashboard_action_resolution_sync_incident_v1; this trigger closes the
-- historical split-brain gap when an incident is resolved first.

create or replace function public.reconcile_operator_actions_from_resolved_incident_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'resolved' or old.status = 'resolved' then
    return new;
  end if;

  update public.account_dashboard_actions a
  set status = 'resolved',
      blocking_campaign = false,
      requires_client_action = false,
      resolved_at = coalesce(a.resolved_at, new.resolved_at, now()),
      updated_at = now(),
      metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object(
        'incident_resolution_reconciliation',
        jsonb_build_object(
          'contract', 'resolved_incident_operator_action_v1',
          'source', 'linked_incident_resolution',
          'incident_id', new.id,
          'incident_resolution_reason', new.resolution_reason,
          'operator_review_performed', false,
          'reconciled_at', now()
        )
      )
  where a.incident_id = new.id
    and a.action_type in ('operator_review_required', 'review_auto_restart_hard_stop')
    and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted');

  return new;
end
$$;

revoke all on function public.reconcile_operator_actions_from_resolved_incident_v1()
  from public, anon, authenticated;
grant execute on function public.reconcile_operator_actions_from_resolved_incident_v1()
  to service_role;

drop trigger if exists incident_resolution_sync_operator_actions_v1
  on public.account_incidents;
create trigger incident_resolution_sync_operator_actions_v1
after update of status on public.account_incidents
for each row
when (new.status = 'resolved' and old.status is distinct from new.status)
execute function public.reconcile_operator_actions_from_resolved_incident_v1();

-- Reconcile every legacy orphan using the same terminal representation.  This
-- is intentionally limited to linked operator-review blockers whose canonical
-- incident is already resolved.  No incident, run, request, or schedule row is
-- changed.
update public.account_dashboard_actions a
set status = 'resolved',
    blocking_campaign = false,
    requires_client_action = false,
    resolved_at = coalesce(a.resolved_at, i.resolved_at, now()),
    updated_at = now(),
    metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object(
      'incident_resolution_reconciliation',
      jsonb_build_object(
        'contract', 'resolved_incident_operator_action_v1',
        'source', 'legacy_orphan_backfill',
        'incident_id', i.id,
        'incident_resolution_reason', i.resolution_reason,
        'operator_review_performed', false,
        'reconciled_at', now()
      )
    )
from public.account_incidents i
where a.incident_id = i.id
  and i.status = 'resolved'
  and a.action_type in ('operator_review_required', 'review_auto_restart_hard_stop')
  and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted');

comment on function public.reconcile_operator_actions_from_resolved_incident_v1()
is 'Atomically resolves linked active operator-review blockers when their canonical incident becomes resolved; records system reconciliation metadata without claiming a human review.';
