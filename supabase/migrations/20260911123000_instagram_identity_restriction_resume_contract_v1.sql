-- Instagram identity/restriction/resume contract V1.
--
-- Specific restriction incidents emitted by Identity Guard previously bypassed
-- apply_instagram_action_restriction_v1, so incident resolution could arm a
-- one-shot resume authorization without the hold required by both the tick and
-- run-start gates. Keep the hold as the physical-preflight authority and create
-- it from the same canonical incident lifecycle for those direct UI reasons.

begin;

create or replace function public.sync_identity_guard_restriction_hold_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_hold public.instagram_account_restriction_holds%rowtype;
  v_prior_hold public.instagram_account_restriction_holds%rowtype;
  v_previous_status text;
  v_reason text := coalesce(nullif(trim(new.reason), ''), nullif(trim(new.failure_reason), ''), 'instagram_account_restriction_unknown_scope');
begin
  if new.incident_type <> 'instagram_account_restriction'
     or new.account_id is null
     or v_reason not in (
       'instagram_account_restriction_messages_disabled',
       'instagram_account_restriction_unknown_scope'
     ) then
    return new;
  end if;

  -- Serialize every hold transition for an account and capture the lifecycle
  -- that existed before this restriction family acquired authority.
  select admin_lifecycle_status into v_previous_status
  from public.ig_accounts
  where id = new.account_id
  for update;

  select * into v_hold
  from public.instagram_account_restriction_holds
  where incident_id = new.id
  for update;

  if new.status in ('open', 'acknowledged') then
    if v_hold.id is null then
      select * into v_prior_hold
      from public.instagram_account_restriction_holds
      where account_id = new.account_id
        and incident_id <> new.id
        and status in ('active', 'verification_required')
      for update;

      if v_prior_hold.id is not null then
        v_previous_status := coalesce(
          nullif(v_prior_hold.previous_admin_lifecycle_status, ''),
          v_previous_status
        );
      end if;

      -- A freshly observed direct restriction is a new generation. Preserve
      -- any prior generation as evidence before installing the new authority.
      update public.instagram_account_restriction_holds
      set status = 'superseded',
          last_seen_at = now(),
          metadata_safe = coalesce(metadata_safe, '{}'::jsonb)
            || jsonb_build_object('superseded_by_incident_id', new.id),
          updated_at = now()
      where id = v_prior_hold.id;

      insert into public.instagram_account_restriction_holds (
        account_id,
        incident_id,
        stable_reason,
        status,
        previous_admin_lifecycle_status,
        metadata_safe
      ) values (
        new.account_id,
        new.id,
        v_reason,
        'active',
        v_previous_status,
        jsonb_build_object(
          'source', 'identity_guard_direct_restriction_incident',
          'restriction_reason', v_reason,
          'incident_created_at', new.created_at
        )
      ) returning * into v_hold;
    else
      update public.instagram_account_restriction_holds
      set status = case
            when status = 'verification_required' then 'active'
            else status
          end,
          human_resolved_at = case
            when status = 'verification_required' then null
            else human_resolved_at
          end,
          verification_required_at = case
            when status = 'verification_required' then null
            else verification_required_at
          end,
          last_seen_at = now(),
          occurrence_count = occurrence_count + 1,
          stable_reason = v_reason,
          metadata_safe = coalesce(metadata_safe, '{}'::jsonb)
            || jsonb_build_object('restriction_reason', v_reason),
          updated_at = now()
      where id = v_hold.id;
    end if;

    update public.ig_accounts
    set admin_lifecycle_status = 'paused', updated_at = now()
    where id = new.account_id
      and coalesce(admin_lifecycle_status, '') <> 'paused';
  elsif new.status = 'resolved' then
    if v_hold.id is null
       and not exists (
         select 1
         from public.instagram_account_restriction_holds other_hold
         where other_hold.account_id = new.account_id
           and other_hold.status in ('active', 'verification_required')
       ) then
      insert into public.instagram_account_restriction_holds (
        account_id,
        incident_id,
        stable_reason,
        status,
        previous_admin_lifecycle_status,
        human_resolved_at,
        verification_required_at,
        metadata_safe
      ) values (
        new.account_id,
        new.id,
        v_reason,
        'verification_required',
        v_previous_status,
        coalesce(new.resolved_at, now()),
        now(),
        jsonb_build_object(
          'source', 'identity_guard_direct_restriction_incident',
          'restriction_reason', v_reason,
          'incident_resolved_but_physical_preflight_pending', true
        )
      ) returning * into v_hold;
    elsif v_hold.id is not null and v_hold.status = 'active' then
      update public.instagram_account_restriction_holds
      set status = 'verification_required',
          human_resolved_at = coalesce(new.resolved_at, now()),
          verification_required_at = now(),
          metadata_safe = coalesce(metadata_safe, '{}'::jsonb)
            || jsonb_build_object('incident_resolved_but_physical_preflight_pending', true),
          updated_at = now()
      where id = v_hold.id;
    end if;

    if v_hold.id is not null then
      update public.ig_accounts
      set admin_lifecycle_status = 'paused', updated_at = now()
      where id = new.account_id
        and coalesce(admin_lifecycle_status, '') <> 'paused';
    end if;
  end if;

  return new;
end
$function$;

revoke all on function public.sync_identity_guard_restriction_hold_v1()
  from public, anon, authenticated;
grant execute on function public.sync_identity_guard_restriction_hold_v1()
  to service_role;

drop trigger if exists account_incident_identity_guard_restriction_hold_v1
  on public.account_incidents;
create trigger account_incident_identity_guard_restriction_hold_v1
after insert or update of status on public.account_incidents
for each row
execute function public.sync_identity_guard_restriction_hold_v1();

-- Recover only an unresolved one-shot contract: a resolved direct restriction
-- with an ARMED authorization. Historical closed generations are untouched.
with eligible as (
  select distinct on (incident.account_id)
    incident.account_id,
    incident.id as incident_id,
    coalesce(nullif(trim(incident.reason), ''), nullif(trim(incident.failure_reason), ''), 'instagram_account_restriction_unknown_scope') as stable_reason,
    incident.resolved_at,
    account.admin_lifecycle_status as previous_admin_lifecycle_status
  from public.account_incidents incident
  join public.incident_resume_authorizations resume_auth
    on resume_auth.incident_id = incident.id
   and resume_auth.account_id = incident.account_id
   and resume_auth.status = 'armed'
   and coalesce(resume_auth.expires_at, resume_auth.scheduled_window_end) > now()
   and coalesce(resume_auth.test, false) is false
  join public.ig_accounts account on account.id = incident.account_id
  where incident.incident_type = 'instagram_account_restriction'
    and incident.status = 'resolved'
    and coalesce(nullif(trim(incident.reason), ''), nullif(trim(incident.failure_reason), '')) in (
      'instagram_account_restriction_messages_disabled',
      'instagram_account_restriction_unknown_scope'
    )
    and not exists (
      select 1 from public.instagram_account_restriction_holds own_hold
      where own_hold.incident_id = incident.id
    )
    and not exists (
      select 1 from public.instagram_account_restriction_holds blocking_hold
      where blocking_hold.account_id = incident.account_id
        and blocking_hold.status in ('active', 'verification_required')
    )
  order by incident.account_id, resume_auth.armed_at desc, incident.resolved_at desc
), inserted as (
  insert into public.instagram_account_restriction_holds (
    account_id,
    incident_id,
    stable_reason,
    status,
    previous_admin_lifecycle_status,
    human_resolved_at,
    verification_required_at,
    metadata_safe
  )
  select
    eligible.account_id,
    eligible.incident_id,
    eligible.stable_reason,
    'verification_required',
    eligible.previous_admin_lifecycle_status,
    coalesce(eligible.resolved_at, now()),
    now(),
    jsonb_build_object(
      'source', 'identity_guard_restriction_armed_authorization_backfill',
      'incident_resolved_but_physical_preflight_pending', true
    )
  from eligible
  on conflict do nothing
  returning account_id
)
update public.ig_accounts account
set admin_lifecycle_status = 'paused', updated_at = now()
from inserted
where account.id = inserted.account_id
  and coalesce(account.admin_lifecycle_status, '') <> 'paused';

-- A duration is projected only from evidence appropriate to the reason. The
-- messages-disabled family uses Instagram's parsed end date; the historical
-- action-limit family retains its explicit 48-hour policy.
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
        when coalesce(nullif(incident.reason, ''), nullif(incident.failure_reason, '')) = 'instagram_account_restriction_messages_disabled'
          and coalesce(incident.metadata ->> 'restriction_end_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
          then ((incident.metadata ->> 'restriction_end_date') || 'T00:00:00+00')::timestamptz
        when coalesce(nullif(incident.reason, ''), nullif(incident.failure_reason, '')) in (
          'instagram_action_rate_limit', 'preventive_follow_restriction'
        )
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
    from public.account_incidents incident
    join requested_accounts requested on requested.account_id = incident.account_id
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

commit;
