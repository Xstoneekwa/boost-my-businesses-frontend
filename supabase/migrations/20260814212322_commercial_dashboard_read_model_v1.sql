-- Owner-only Commercial CRM dashboard projection.
-- The function is intentionally service-role-only. The application performs
-- the canonical authenticated + superadmin + active grant check before every
-- call; Postgres grants provide an independent fail-closed data boundary.

-- Cohort windows and deterministic keyset-compatible ordering are the two
-- dominant read paths for this dashboard.
create index if not exists commercial_leads_created_dashboard_idx
  on public.commercial_leads (created_at desc, id desc);
create index if not exists commercial_leads_updated_dashboard_idx
  on public.commercial_leads (updated_at desc, id desc);

create or replace function public.commercial_dashboard_read_model_v1(
  p_filters jsonb default '{}'::jsonb,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with
params as (
  select
    greatest(coalesce(p_page, 1), 1) as page,
    least(greatest(coalesce(p_page_size, 25), 1), 100) as page_size,
    nullif(btrim(p_filters->>'campaign'), '')::uuid as campaign_id,
    nullif(btrim(p_filters->>'country'), '') as country,
    nullif(btrim(p_filters->>'city'), '') as city,
    nullif(btrim(p_filters->>'vertical'), '') as vertical,
    nullif(btrim(p_filters->>'subsegment'), '') as subsegment,
    nullif(btrim(p_filters->>'channel'), '') as channel,
    nullif(btrim(p_filters->>'message_angle'), '') as message_angle,
    nullif(btrim(p_filters->>'template_version'), '') as template_version,
    nullif(btrim(p_filters->>'priority'), '') as priority,
    nullif(btrim(p_filters->>'qualification_status'), '') as qualification_status,
    nullif(btrim(p_filters->>'outreach_status'), '') as outreach_status,
    nullif(btrim(p_filters->>'sales_status'), '') as sales_status,
    nullif(btrim(p_filters->>'search'), '') as search,
    nullif(p_filters->>'date_from', '')::timestamptz as date_from,
    nullif(p_filters->>'date_to', '')::timestamptz as date_to
),
base as (
  select
    l.id,
    l.campaign_id,
    c.name as campaign_name,
    c.campaign_code,
    l.business_id,
    b.business_name,
    b.country_code,
    coalesce(l.city_snapshot, b.city) as city,
    b.vertical,
    coalesce(l.subsegment_snapshot, b.subsegment) as subsegment,
    b.website,
    b.instagram_handle,
    b.source,
    l.primary_contact_id,
    pc.full_name as contact_name,
    pc.job_title as contact_role,
    pc.email as contact_email,
    pc.instagram_handle as contact_instagram,
    l.score,
    l.priority,
    l.qualification_status,
    l.outreach_status,
    l.sales_status,
    l.outreach_channel,
    l.message_angle,
    l.template_version,
    l.approved_by,
    l.approved_at,
    l.sales_owner_auth_user_id,
    l.personalization_context_safe,
    l.audience_context_safe,
    l.created_at,
    l.updated_at,
    cv.id as conversion_id,
    cv.client_id,
    cv.package_reference,
    cv.checkout_session_id,
    cv.entitlement_id,
    cv.stripe_billing_profile_id,
    cv.stripe_subscription_id,
    cv.converted_at,
    (l.qualification_status in ('qualified', 'approved')) as is_qualified,
    (l.qualification_status = 'approved') as is_approved,
    (
      l.outreach_status in ('contacted', 'replied', 'no_response')
      or l.sales_status not in ('not_started', 'lost')
    ) as is_contacted,
    (l.outreach_status = 'replied') as is_replied,
    (l.sales_status in ('sales_qualified', 'demo_booked', 'demo_done', 'checkout_sent', 'paid', 'onboarding', 'active_client')) as is_sales_qualified,
    (l.sales_status in ('demo_booked', 'demo_done', 'checkout_sent', 'paid', 'onboarding', 'active_client')) as is_demo,
    (cv.id is not null) as is_paid
  from public.commercial_leads l
  join public.commercial_campaigns c on c.id = l.campaign_id
  join public.commercial_businesses b on b.id = l.business_id
  left join public.commercial_contacts pc on pc.id = l.primary_contact_id
  left join public.commercial_conversions cv on cv.lead_id = l.id
),
filtered as (
  select b.*
  from base b
  cross join params p
  where (p.campaign_id is null or b.campaign_id = p.campaign_id)
    and (p.country is null or b.country_code = p.country)
    and (p.city is null or b.city = p.city)
    and (p.vertical is null or b.vertical = p.vertical)
    and (p.subsegment is null or b.subsegment = p.subsegment)
    and (p.channel is null or b.outreach_channel = p.channel)
    and (p.message_angle is null or b.message_angle = p.message_angle)
    and (p.template_version is null or b.template_version = p.template_version)
    and (p.priority is null or b.priority = p.priority)
    and (p.qualification_status is null or b.qualification_status = p.qualification_status)
    and (p.outreach_status is null or b.outreach_status = p.outreach_status)
    and (p.sales_status is null or b.sales_status = p.sales_status)
    and (p.date_from is null or b.created_at >= p.date_from)
    and (p.date_to is null or b.created_at < p.date_to)
    and (
      p.search is null
      or b.business_name ilike '%' || p.search || '%'
      or b.instagram_handle ilike '%' || p.search || '%'
      or b.contact_email ilike '%' || p.search || '%'
      or b.contact_instagram ilike '%' || p.search || '%'
    )
),
summary as (
  select
    count(*)::integer as discovered,
    count(*) filter (where is_qualified)::integer as qualified,
    count(*) filter (where is_approved)::integer as approved,
    count(*) filter (where is_contacted)::integer as contacted,
    count(*) filter (where is_replied)::integer as replies,
    count(*) filter (where is_sales_qualified)::integer as hot_leads,
    count(*) filter (where is_demo)::integer as demos,
    count(*) filter (where is_paid)::integer as paid
  from filtered
),
breakdown_rows as (
  select 'channel'::text as dimension, coalesce(outreach_channel, 'Unassigned') as label, * from filtered
  union all
  select 'angle', coalesce(message_angle, 'Unassigned'), * from filtered
  union all
  select 'city', coalesce(city, 'Unassigned'), * from filtered
  union all
  select 'subsegment', coalesce(subsegment, 'Unassigned'), * from filtered
  union all
  select 'template', coalesce(template_version, 'Unassigned'), * from filtered
),
breakdown_stats as (
  select
    dimension,
    label,
    count(*) filter (where is_qualified)::integer as qualified,
    count(*) filter (where is_contacted)::integer as contacted,
    count(*) filter (where is_replied)::integer as replies,
    count(*) filter (where is_sales_qualified)::integer as sales_qualified,
    count(*) filter (where is_demo)::integer as demos,
    count(*) filter (where is_paid)::integer as paid
  from breakdown_rows
  group by dimension, label
),
page_rows as (
  select
    f.*,
    e.occurred_at as last_activity_at,
    e.event_type as last_activity_type
  from filtered f
  cross join params p
  left join lateral (
    select occurred_at, event_type
    from public.commercial_events
    where lead_id = f.id
    order by occurred_at desc, id desc
    limit 1
  ) e on true
  order by f.updated_at desc, f.id desc
  limit (select page_size from params)
  offset ((select page - 1 from params) * (select page_size from params))
),
queue_candidates as (
  select
    f.id,
    f.business_name,
    f.city,
    f.subsegment,
    f.score,
    f.priority,
    f.instagram_handle,
    f.outreach_channel,
    f.message_angle,
    f.sales_status,
    f.updated_at
  from filtered f
),
facets as (
  select jsonb_build_object(
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', campaign_code) order by name) from public.commercial_campaigns), '[]'::jsonb),
    'countries', coalesce((select jsonb_agg(value order by value) from (select distinct country_code as value from base) x), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(value order by value) from (select distinct city as value from base where city is not null) x), '[]'::jsonb),
    'verticals', coalesce((select jsonb_agg(value order by value) from (select distinct vertical as value from base) x), '[]'::jsonb),
    'subsegments', coalesce((select jsonb_agg(value order by value) from (select distinct subsegment as value from base where subsegment is not null) x), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(value order by value) from (select distinct outreach_channel as value from base where outreach_channel is not null) x), '[]'::jsonb),
    'angles', coalesce((select jsonb_agg(value order by value) from (select distinct message_angle as value from base where message_angle is not null) x), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(value order by value) from (select distinct template_version as value from base where template_version is not null) x), '[]'::jsonb)
  ) as value
)
select jsonb_build_object(
  'metric_contract', jsonb_build_object(
    'cohort', 'lead_created_at',
    'paid_source', 'commercial_conversions',
    'minimum_qualified_sample', 20
  ),
  'kpis', jsonb_build_object(
    'discovered', s.discovered,
    'qualified', s.qualified,
    'approved', s.approved,
    'contacted', s.contacted,
    'replies', s.replies,
    'hot_leads', s.hot_leads,
    'demos', s.demos,
    'paid', s.paid,
    'paid_per_100_qualified', case when s.qualified >= 20 then round((s.paid::numeric * 100) / s.qualified, 1) else null end,
    'paid_per_100_sample_sufficient', s.qualified >= 20
  ),
  'funnel', jsonb_build_array(
    jsonb_build_object('key', 'qualified', 'label', 'Qualified', 'count', s.qualified, 'from_previous', null, 'from_qualified', case when s.qualified > 0 then 100 else null end),
    jsonb_build_object('key', 'contacted', 'label', 'Contacted', 'count', s.contacted, 'from_previous', case when s.qualified > 0 then round(s.contacted::numeric * 100 / s.qualified, 1) else null end, 'from_qualified', case when s.qualified > 0 then round(s.contacted::numeric * 100 / s.qualified, 1) else null end),
    jsonb_build_object('key', 'replied', 'label', 'Replied', 'count', s.replies, 'from_previous', case when s.contacted > 0 then round(s.replies::numeric * 100 / s.contacted, 1) else null end, 'from_qualified', case when s.qualified > 0 then round(s.replies::numeric * 100 / s.qualified, 1) else null end),
    jsonb_build_object('key', 'sales_qualified', 'label', 'Sales Qualified', 'count', s.hot_leads, 'from_previous', case when s.replies > 0 then round(s.hot_leads::numeric * 100 / s.replies, 1) else null end, 'from_qualified', case when s.qualified > 0 then round(s.hot_leads::numeric * 100 / s.qualified, 1) else null end),
    jsonb_build_object('key', 'demo', 'label', 'Demo', 'count', s.demos, 'from_previous', case when s.hot_leads > 0 then round(s.demos::numeric * 100 / s.hot_leads, 1) else null end, 'from_qualified', case when s.qualified > 0 then round(s.demos::numeric * 100 / s.qualified, 1) else null end),
    jsonb_build_object('key', 'paid', 'label', 'Paid', 'count', s.paid, 'from_previous', case when s.demos > 0 then round(s.paid::numeric * 100 / s.demos, 1) else null end, 'from_qualified', case when s.qualified > 0 then round(s.paid::numeric * 100 / s.qualified, 1) else null end)
  ),
  'breakdowns', coalesce((
    select jsonb_object_agg(dimension, rows)
    from (
      select dimension, jsonb_agg(
        jsonb_build_object(
          'label', label,
          'qualified', qualified,
          'contacted', contacted,
          'replies', replies,
          'sales_qualified', sales_qualified,
          'demos', demos,
          'paid', paid,
          'paid_per_100_qualified', case when qualified >= 20 then round(paid::numeric * 100 / qualified, 1) else null end,
          'sample_sufficient', qualified >= 20
        ) order by qualified desc, label
      ) as rows
      from breakdown_stats
      group by dimension
    ) grouped
  ), '{}'::jsonb),
  'queues', jsonb_build_object(
    'needs_approval', coalesce((select jsonb_agg(to_jsonb(q) order by q.priority desc, q.score desc nulls last, q.updated_at desc) from (select * from queue_candidates where id in (select id from filtered where qualification_status = 'qualified' and approved_at is null) order by score desc nulls last, updated_at desc limit 8) q), '[]'::jsonb),
    'hot_responses', coalesce((select jsonb_agg(to_jsonb(q) order by q.updated_at desc) from (select * from queue_candidates where sales_status = 'sales_qualified' order by updated_at desc limit 8) q), '[]'::jsonb),
    'upcoming_demos', coalesce((select jsonb_agg(to_jsonb(q) order by q.updated_at desc) from (select * from queue_candidates where sales_status = 'demo_booked' order by updated_at desc limit 8) q), '[]'::jsonb),
    'needs_sales_action', '[]'::jsonb
  ),
  'leads', jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(pr) order by pr.updated_at desc, pr.id desc) from page_rows pr), '[]'::jsonb),
    'total', (select count(*)::integer from filtered),
    'page', (select page from params),
    'page_size', (select page_size from params)
  ),
  'facets', (select value from facets)
)
from summary s;
$$;

revoke all on function public.commercial_dashboard_read_model_v1(jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.commercial_dashboard_read_model_v1(jsonb, integer, integer) to service_role;

comment on function public.commercial_dashboard_read_model_v1(jsonb, integer, integer) is
  'Service-role-only owner dashboard projection. Application must pass requireCommercialCrmAccess before invocation.';
