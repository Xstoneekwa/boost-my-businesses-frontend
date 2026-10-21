-- Preserve exact incident lineage for incident-derived login challenge actions.
-- Historical repair is deliberately limited to a unique 1:1 ads-consent pair.

begin;

drop function if exists public.upsert_login_challenge_dashboard_action(
  uuid, text, text, text, uuid, text, text, text, boolean, boolean,
  text, text, text, text, text, jsonb
);

create or replace function public.upsert_login_challenge_dashboard_action(
  p_account_id uuid,
  p_action_type text,
  p_title text,
  p_dedupe_key text,
  p_client_id uuid default null,
  p_status text default 'pending',
  p_severity text default 'warning',
  p_audience text default 'client',
  p_requires_client_action boolean default true,
  p_blocking_campaign boolean default true,
  p_safe_client_message text default null,
  p_assistant_message text default null,
  p_admin_message text default null,
  p_action_label text default null,
  p_action_deep_link text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_incident_id uuid default null
)
returns public.account_dashboard_actions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_action_type text := nullif(trim(p_action_type), '');
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  if v_action_type not in ('enter_email_verification_code', 'review_login_challenge') then
    raise exception 'unsupported_login_challenge_action_type';
  end if;

  return public.upsert_account_dashboard_action(
    p_account_id := p_account_id,
    p_client_id := p_client_id,
    p_incident_id := p_incident_id,
    p_action_type := v_action_type,
    p_status := coalesce(nullif(trim(p_status), ''), 'pending'),
    p_severity := coalesce(nullif(trim(p_severity), ''), 'warning'),
    p_audience := coalesce(nullif(trim(p_audience), ''), 'client'),
    p_requires_client_action := coalesce(p_requires_client_action, true),
    p_blocking_campaign := coalesce(p_blocking_campaign, true),
    p_title := p_title,
    p_safe_client_message := p_safe_client_message,
    p_assistant_message := p_assistant_message,
    p_admin_message := p_admin_message,
    p_action_label := p_action_label,
    p_action_deep_link := p_action_deep_link,
    p_dedupe_key := p_dedupe_key,
    p_metadata := coalesce(p_metadata, '{}'::jsonb)
  );
end
$function$;

revoke all on function public.upsert_login_challenge_dashboard_action(
  uuid, text, text, text, uuid, text, text, text, boolean, boolean,
  text, text, text, text, text, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.upsert_login_challenge_dashboard_action(
  uuid, text, text, text, uuid, text, text, text, boolean, boolean,
  text, text, text, text, text, jsonb, uuid
) to service_role;

comment on function public.upsert_login_challenge_dashboard_action(
  uuid, text, text, text, uuid, text, text, text, boolean, boolean,
  text, text, text, text, text, jsonb, uuid
) is 'Service-role login challenge action upsert. Incident-derived callers pass the exact incident id; null remains valid only for standalone actions.';

do $repair_notice$
declare
  v_ambiguous_rows integer;
begin
  with raw_matches as (
    select
      action.id as action_id,
      incident.id as incident_id,
      count(*) over (partition by action.id) as incident_matches,
      count(*) over (partition by incident.id) as action_matches
    from public.account_dashboard_actions as action
    join public.account_incidents as incident
      on incident.account_id = action.account_id
     and incident.run_id::text = action.metadata ->> 'run_id'
     and incident.incident_type = 'instagram_ads_data_consent_popup_requires_operator'
     and action.created_at >= incident.created_at
     and action.created_at <= incident.created_at + interval '5 seconds'
    where action.incident_id is null
      and action.action_type = 'review_login_challenge'
      and action.dedupe_key = 'account:' || action.account_id::text
        || ':dashboard_action:review_login_challenge:instagram_ads_data_consent_popup'
      and action.metadata ->> 'screen_type' = 'instagram_ads_data_consent_popup'
      and coalesce(action.metadata ->> 'run_id', '')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
  select count(distinct action_id)
    into v_ambiguous_rows
  from raw_matches
  where incident_matches <> 1 or action_matches <> 1;

  raise notice 'incident_dashboard_action_lineage_repair_v1 ambiguous_rows_skipped=%',
    v_ambiguous_rows;
end
$repair_notice$;

with raw_matches as (
  select
    action.id as action_id,
    incident.id as incident_id,
    incident.status as incident_status,
    incident.resolved_at as incident_resolved_at,
    incident.archived_at as incident_archived_at,
    count(*) over (partition by action.id) as incident_matches,
    count(*) over (partition by incident.id) as action_matches
  from public.account_dashboard_actions as action
  join public.account_incidents as incident
    on incident.account_id = action.account_id
   and incident.run_id::text = action.metadata ->> 'run_id'
   and incident.incident_type = 'instagram_ads_data_consent_popup_requires_operator'
   and action.created_at >= incident.created_at
   and action.created_at <= incident.created_at + interval '5 seconds'
  where action.incident_id is null
    and action.action_type = 'review_login_challenge'
    and action.dedupe_key = 'account:' || action.account_id::text
      || ':dashboard_action:review_login_challenge:instagram_ads_data_consent_popup'
    and action.metadata ->> 'screen_type' = 'instagram_ads_data_consent_popup'
    and coalesce(action.metadata ->> 'run_id', '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
), exact_pairs as (
  select *
  from raw_matches
  where incident_matches = 1 and action_matches = 1
)
update public.account_dashboard_actions as action
set
  incident_id = exact_pair.incident_id,
  status = case
    when exact_pair.incident_resolved_at is not null
      or exact_pair.incident_archived_at is not null
      or lower(coalesce(exact_pair.incident_status, '')) in ('resolved', 'ignored', 'archived')
    then 'resolved'
    else action.status
  end,
  blocking_campaign = case
    when exact_pair.incident_resolved_at is not null
      or exact_pair.incident_archived_at is not null
      or lower(coalesce(exact_pair.incident_status, '')) in ('resolved', 'ignored', 'archived')
    then false
    else action.blocking_campaign
  end,
  requires_client_action = case
    when exact_pair.incident_resolved_at is not null
      or exact_pair.incident_archived_at is not null
      or lower(coalesce(exact_pair.incident_status, '')) in ('resolved', 'ignored', 'archived')
    then false
    else action.requires_client_action
  end,
  resolved_at = case
    when exact_pair.incident_resolved_at is not null
      or exact_pair.incident_archived_at is not null
      or lower(coalesce(exact_pair.incident_status, '')) in ('resolved', 'ignored', 'archived')
    then coalesce(action.resolved_at, exact_pair.incident_resolved_at,
      exact_pair.incident_archived_at, now())
    else action.resolved_at
  end,
  updated_at = now(),
  metadata = coalesce(action.metadata, '{}'::jsonb) || jsonb_build_object(
    'incident_lineage_repair', 'exact_account_run_popup_temporal_pair',
    'incident_lineage_contract', 'incident_dashboard_action_lineage_repair_v1'
  )
from exact_pairs as exact_pair
where action.id = exact_pair.action_id
  and action.incident_id is null;

commit;
