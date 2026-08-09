-- Keep a reviewed-but-unresolved incident visible under Open.
-- review_operator_dashboard_action intentionally leaves the durable action row
-- acknowledged and records review completion in metadata. The overview must
-- project that state as reviewed instead of treating it as Action Required.

create or replace function public.get_account_incidents_overview_v1(
  p_filter text default 'open',
  p_limit integer default 50,
  p_cursor_last_seen_at timestamptz default null,
  p_cursor_id uuid default null,
  p_search text default null,
  p_include_test boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with latest_action as (
  select distinct on (a.incident_id)
    a.incident_id,
    a.id as action_id,
    case
      when lower(coalesce(a.metadata ->> 'review_status', '')) = 'reviewed'
       and lower(coalesce(a.metadata ->> 'operator_review_completed', 'false')) in ('true', '1', 'yes')
      then 'reviewed'
      else a.status
    end as action_status,
    a.blocking_campaign,
    a.created_at
  from public.account_dashboard_actions a
  where a.action_type = 'operator_review_required'
    and a.incident_id is not null
  order by a.incident_id, a.created_at desc, a.id desc
), base as (
  select
    i.*,
    la.action_id as operator_action_id,
    la.action_status as operator_action_status,
    coalesce(la.action_status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted'), false)
      or coalesce(i.metadata #>> '{recovery,state}', '') in ('reintervention_required', 'resume_authorization_expired')
      as action_required_derived,
    (i.incident_type = 'system_test_incident' or lower(coalesce(i.metadata ->> 'test', 'false')) in ('true', '1', 'yes')) as is_test
  from public.account_incidents i
  left join latest_action la on la.incident_id = i.id
  where i.archived_at is null
), operational as (
  select * from base where not is_test
), filtered as (
  select *
  from base b
  where (p_include_test or not b.is_test)
    and (
      nullif(trim(coalesce(p_search, '')), '') is null
      or coalesce(b.account_username, '') ilike '%' || trim(p_search) || '%'
      or coalesce(b.reason, '') ilike '%' || trim(p_search) || '%'
      or coalesce(b.failure_reason, '') ilike '%' || trim(p_search) || '%'
      or b.incident_type ilike '%' || trim(p_search) || '%'
    )
    and case lower(coalesce(p_filter, 'open'))
      when 'action_required' then b.status in ('open', 'acknowledged') and b.action_required_derived
      when 'resolved' then b.status in ('resolved', 'ignored')
      when 'all' then true
      else b.status in ('open', 'acknowledged') and not b.action_required_derived
    end
), cursor_filtered as (
  select *
  from filtered f
  where p_cursor_last_seen_at is null
    or p_cursor_id is null
    or (f.last_seen_at, f.id) < (p_cursor_last_seen_at, p_cursor_id)
), page_plus_one as (
  select * from cursor_filtered
  order by last_seen_at desc, id desc
  limit least(100, greatest(1, coalesce(p_limit, 50))) + 1
), page_rows as (
  select * from page_plus_one
  order by last_seen_at desc, id desc
  limit least(100, greatest(1, coalesce(p_limit, 50)))
), last_row as (
  select last_seen_at, id from page_rows order by last_seen_at asc, id asc limit 1
), global_counters as (
  select
    count(*) filter (where status in ('open', 'acknowledged') and not action_required_derived) as open_count,
    count(*) filter (where status in ('open', 'acknowledged') and action_required_derived) as action_required_count,
    count(*) filter (where status in ('resolved', 'ignored')) as resolved_count,
    count(*) as total_count,
    count(*) filter (where exists (
      select 1 from public.account_incident_notifications n
      where n.incident_id = operational.id and n.status = 'failed'
    )) as delivery_degraded_count
  from operational
)
select jsonb_build_object(
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'status', r.status,
      'severity', r.severity,
      'incident_type', r.incident_type,
      'reason', r.reason,
      'failure_reason', r.failure_reason,
      'action_required', r.action_required,
      'admin_message', r.admin_message,
      'account_id', r.account_id,
      'account_username', r.account_username,
      'run_id', r.run_id,
      'occurrence_count', r.occurrence_count,
      'first_seen_at', r.first_seen_at,
      'last_seen_at', r.last_seen_at,
      'resolved_at', r.resolved_at,
      'source', r.source,
      'metadata', r.metadata,
      'operator_action_id', r.operator_action_id,
      'operator_action_status', r.operator_action_status,
      'is_test', r.is_test
    ) order by r.last_seen_at desc, r.id desc) from page_rows r
  ), '[]'::jsonb),
  'filtered_total', (select count(*) from filtered),
  'has_more', (select count(*) from page_plus_one) > least(100, greatest(1, coalesce(p_limit, 50))),
  'next_cursor', case
    when (select count(*) from page_plus_one) > least(100, greatest(1, coalesce(p_limit, 50)))
    then (select jsonb_build_object('last_seen_at', last_seen_at, 'id', id) from last_row)
    else null
  end,
  'counters', (select jsonb_build_object(
    'open', open_count,
    'actionRequired', action_required_count,
    'resolved', resolved_count,
    'deliveryDegraded', delivery_degraded_count,
    'total', total_count
  ) from global_counters)
)
$$;

comment on function public.get_account_incidents_overview_v1(text, integer, timestamptz, uuid, text, boolean)
is 'Projects canonical incident states; reviewed unresolved incidents stay visible under Open while resolution remains separate.';

revoke all on function public.get_account_incidents_overview_v1(text, integer, timestamptz, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.get_account_incidents_overview_v1(text, integer, timestamptz, uuid, text, boolean) to service_role;
