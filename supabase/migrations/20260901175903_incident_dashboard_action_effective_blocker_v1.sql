-- Incident/dashboard-action effective blocker coordination V1.
-- Linked actions follow their incident lifecycle; standalone actions keep
-- their existing semantics. Historical incidents and rows are never deleted.

begin;

create or replace function public.sync_terminal_incident_dashboard_actions_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.resolved_at is null
     and new.archived_at is null
     and lower(coalesce(new.status, '')) not in ('resolved', 'ignored', 'archived') then
    return new;
  end if;

  update public.account_dashboard_actions as action
  set status = 'resolved',
      blocking_campaign = false,
      requires_client_action = false,
      resolved_at = coalesce(action.resolved_at, new.resolved_at, now()),
      updated_at = now(),
      metadata_safe = coalesce(action.metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'incident_lifecycle_sync', 'terminal',
        'incident_status', lower(coalesce(new.status, '')),
        'incident_archived', new.archived_at is not null,
        'contract_version', 'incident_dashboard_action_effective_blocker_v1'
      )
  where action.incident_id = new.id
    and action.account_id = new.account_id
    and action.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted');

  return new;
end
$function$;

revoke all on function public.sync_terminal_incident_dashboard_actions_v1()
  from public, anon, authenticated;
grant execute on function public.sync_terminal_incident_dashboard_actions_v1()
  to service_role;

drop trigger if exists account_incident_dashboard_action_terminal_sync_v1
  on public.account_incidents;
create trigger account_incident_dashboard_action_terminal_sync_v1
after insert or update of status, resolved_at, archived_at
on public.account_incidents
for each row
execute function public.sync_terminal_incident_dashboard_actions_v1();

create or replace function public.canonical_active_operational_blockers_v1(
  p_account_ids uuid[]
)
returns table (
  account_id uuid,
  source_type text,
  source_id uuid,
  incident_type text,
  action_type text,
  reason_code text,
  severity text,
  requires_manual_resolution boolean,
  not_before timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  with requested_accounts as (
    select distinct requested.account_id
    from unnest(coalesce(p_account_ids, array[]::uuid[])) as requested(account_id)
    where requested.account_id is not null
  ), candidates as (
    select
      incident.account_id,
      'incident'::text as source_type,
      incident.incident_id as source_id,
      incident.incident_type,
      null::text as action_type,
      incident.reason_code,
      incident.severity,
      incident.requires_manual_resolution,
      incident.not_before,
      incident.created_at,
      incident.updated_at,
      0 as source_rank,
      case incident.incident_type
        when 'instagram_account_restriction' then 0
        when 'active_instagram_account_mismatch' then 1
        when 'instagram_human_confirmation_required' then 2
        when 'account_login_required' then 3
        when 'assigned_instagram_package_unavailable' then 4
        else 5
      end as category_rank
    from public.canonical_active_blocking_incidents_v1(p_account_ids) as incident

    union all

    select
      action.account_id,
      'dashboard_action'::text,
      action.id,
      null::text,
      action.action_type,
      coalesce(nullif(action.action_type, ''), 'blocking_dashboard_action'),
      'warning'::text,
      true,
      null::timestamptz,
      action.created_at,
      action.updated_at,
      1,
      6
    from public.account_dashboard_actions as action
    join requested_accounts as requested on requested.account_id = action.account_id
    where coalesce(action.blocking_campaign, false)
      and action.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
      and (
        action.incident_id is null
        or exists (
          select 1
          from public.account_incidents as linked_incident
          where linked_incident.id = action.incident_id
            and linked_incident.account_id = action.account_id
            and linked_incident.status in ('open', 'acknowledged')
            and linked_incident.resolved_at is null
            and linked_incident.archived_at is null
        )
      )
  ), ranked as (
    select candidates.*,
      row_number() over (
        partition by candidates.account_id
        order by
          case candidates.severity when 'critical' then 0 when 'error' then 1 else 2 end,
          candidates.source_rank,
          candidates.category_rank,
          candidates.updated_at desc,
          candidates.created_at desc,
          candidates.source_id
      ) as blocker_rank
    from candidates
  )
  select ranked.account_id, ranked.source_type, ranked.source_id,
    ranked.incident_type, ranked.action_type, ranked.reason_code,
    ranked.severity, ranked.requires_manual_resolution, ranked.not_before,
    ranked.created_at, ranked.updated_at
  from ranked
  where ranked.blocker_rank = 1
$function$;

revoke all on function public.canonical_active_operational_blockers_v1(uuid[])
  from public, anon, authenticated;
grant execute on function public.canonical_active_operational_blockers_v1(uuid[])
  to service_role;

do $migration$
declare
  admission_signature constant regprocedure :=
    'public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)'::regprocedure;
  recovery_signature constant regprocedure :=
    'public.certify_zero_work_and_enqueue_recovery_v1(uuid,uuid,text,integer)'::regprocedure;
  admission_definition text;
  recovery_definition text;
  old_call constant text := 'public.canonical_active_blocking_incidents_v1(array[v_account.id])';
  new_call constant text := 'public.canonical_active_operational_blockers_v1(array[v_account.id])';
begin
  select pg_get_functiondef(admission_signature) into admission_definition;
  select pg_get_functiondef(recovery_signature) into recovery_definition;
  if admission_definition is null
     or (length(admission_definition) - length(replace(admission_definition, old_call, ''))) / length(old_call) <> 1 then
    raise exception 'incident_dashboard_action_effective_blocker_v1: admission lineage drift';
  end if;
  if recovery_definition is null
     or (length(recovery_definition) - length(replace(recovery_definition, old_call, ''))) / length(old_call) <> 1 then
    raise exception 'incident_dashboard_action_effective_blocker_v1: recovery lineage drift';
  end if;
  execute replace(admission_definition, old_call, new_call);
  execute replace(recovery_definition, old_call, new_call);
end
$migration$;

revoke all on function public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamptz,timestamptz,integer)
  from public, anon, authenticated;
grant execute on function public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamptz,timestamptz,integer)
  to service_role;

commit;
