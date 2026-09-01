-- Canonical operational blocker V1.
--
-- The predicate below is the only implementation of the operational safety
-- contract. Atomic admission, Profiles, and the scheduler consume this same
-- set-based primitive.

begin;

create or replace function public.canonical_active_blocking_incidents_v1(
  p_account_ids uuid[]
)
returns table (
  account_id uuid,
  incident_id uuid,
  incident_type text,
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
  ), ranked as (
    select
      incident.account_id,
      incident.id as incident_id,
      incident.incident_type,
      coalesce(nullif(incident.reason, ''), nullif(incident.failure_reason, ''), incident.incident_type) as reason_code,
      incident.severity,
      lower(coalesce(incident.metadata ->> 'manual_incident_resolution_required', 'false')) in ('true', '1', 'yes')
        as requires_manual_resolution,
      case
        when incident.incident_type = 'instagram_account_restriction'
          and lower(coalesce(incident.metadata ->> 'manual_incident_resolution_required', 'false')) in ('true', '1', 'yes')
          then incident.created_at + interval '48 hours'
        else null
      end as not_before,
      incident.created_at,
      incident.updated_at,
      row_number() over (
        partition by incident.account_id
        order by
          case incident.severity when 'critical' then 0 when 'error' then 1 else 2 end,
          case incident.incident_type
            when 'instagram_account_restriction' then 0
            when 'active_instagram_account_mismatch' then 1
            when 'instagram_human_confirmation_required' then 2
            when 'account_login_required' then 3
            when 'assigned_instagram_package_unavailable' then 4
            else 5
          end,
          incident.updated_at desc,
          incident.created_at desc,
          incident.id
      ) as blocker_rank
    from public.account_incidents as incident
    join requested_accounts as requested on requested.account_id = incident.account_id
    where incident.status in ('open', 'acknowledged')
      and incident.archived_at is null
      and incident.resolved_at is null
      and (
        incident.severity in ('error', 'critical')
        or incident.incident_type in (
          'instagram_human_confirmation_required',
          'instagram_account_restriction',
          'active_instagram_account_mismatch',
          'assigned_instagram_package_unavailable',
          'account_login_required'
        )
      )
  )
  select
    ranked.account_id,
    ranked.incident_id,
    ranked.incident_type,
    ranked.reason_code,
    ranked.severity,
    ranked.requires_manual_resolution,
    ranked.not_before,
    ranked.created_at,
    ranked.updated_at
  from ranked
  where ranked.blocker_rank = 1
$function$;

revoke all on function public.canonical_active_blocking_incidents_v1(uuid[])
  from public, anon, authenticated;
grant execute on function public.canonical_active_blocking_incidents_v1(uuid[])
  to service_role;

-- Preserve the exact deployed admission body and replace only its former
-- inline predicate. The migration fails closed if the production definition
-- is not the certified shape or contains more than one matching block.
do $migration$
declare
  admission_signature constant regprocedure :=
    'public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)'::regprocedure;
  recovery_signature constant regprocedure :=
    'public.certify_zero_work_and_enqueue_recovery_v1(uuid,uuid,text,integer)'::regprocedure;
  admission_definition text;
  recovery_definition text;
  patched_admission_definition text;
  patched_recovery_definition text;
  admission_block_start_marker constant text := E'  if exists (\n    select 1 from public.account_incidents i\n';
  admission_block_end_marker constant text := E'  ) then\n    return jsonb_build_object(''ok'', false, ''reason'', ''active_blocking_incident'');\n';
  recovery_block_start_marker constant text := E'  if exists (\n    select 1 from public.account_incidents i\n';
  recovery_block_end_marker constant text := E'  ) then return jsonb_build_object(''ok'',false,''reason'',''active_blocking_incident''); end if;\n';
  canonical_admission_call constant text := $new$
  if exists (
    select 1
    from public.canonical_active_blocking_incidents_v1(array[v_account.id])
  ) then
    return jsonb_build_object('ok', false, 'reason', 'active_blocking_incident');
$new$;
  canonical_recovery_call constant text := $new$
  if exists (
    select 1
    from public.canonical_active_blocking_incidents_v1(array[v_account.id])
  ) then return jsonb_build_object('ok',false,'reason','active_blocking_incident'); end if;
$new$;
  admission_block_start integer;
  admission_block_end integer;
  recovery_block_start integer;
  recovery_block_end integer;
begin
  -- Read and validate every deployed consumer before executing either patch.
  -- Combined with the explicit transaction, any drift aborts the entire file.
  select pg_get_functiondef(admission_signature) into admission_definition;
  select pg_get_functiondef(recovery_signature) into recovery_definition;

  admission_block_start := position(admission_block_start_marker in admission_definition);
  admission_block_end := position(admission_block_end_marker in admission_definition);
  if admission_definition is null
     or admission_block_start = 0
     or admission_block_end <= admission_block_start then
    raise exception 'canonical_operational_blocker_v1: certified admission predicate not found';
  end if;

  if position(admission_block_start_marker in substring(admission_definition from admission_block_start + length(admission_block_start_marker))) > 0
     or position(admission_block_end_marker in substring(admission_definition from admission_block_end + length(admission_block_end_marker))) > 0 then
    raise exception 'canonical_operational_blocker_v1: admission predicate is not singular';
  end if;

  recovery_block_start := position(recovery_block_start_marker in recovery_definition);
  recovery_block_end := position(recovery_block_end_marker in recovery_definition);
  if recovery_definition is null
     or recovery_block_start = 0
     or recovery_block_end <= recovery_block_start then
    raise exception 'canonical_operational_blocker_v1: certified recovery predicate not found';
  end if;

  if position(recovery_block_start_marker in substring(recovery_definition from recovery_block_start + length(recovery_block_start_marker))) > 0
     or position(recovery_block_end_marker in substring(recovery_definition from recovery_block_end + length(recovery_block_end_marker))) > 0 then
    raise exception 'canonical_operational_blocker_v1: recovery predicate is not singular';
  end if;

  patched_admission_definition := overlay(
    admission_definition
    placing canonical_admission_call
    from admission_block_start
    for (admission_block_end + length(admission_block_end_marker) - admission_block_start)
  );
  patched_recovery_definition := overlay(
    recovery_definition
    placing canonical_recovery_call
    from recovery_block_start
    for (recovery_block_end + length(recovery_block_end_marker) - recovery_block_start)
  );

  execute patched_admission_definition;
  execute patched_recovery_definition;
end
$migration$;

revoke all on function public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamptz,timestamptz,integer)
  from public, anon, authenticated;
grant execute on function public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamptz,timestamptz,integer)
  to service_role;

commit;
