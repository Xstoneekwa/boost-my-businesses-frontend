alter table public.account_warmup_settings
  drop constraint if exists account_warmup_settings_day_1_cap_check,
  drop constraint if exists account_warmup_settings_day_2_cap_check,
  drop constraint if exists account_warmup_settings_day_3_cap_check,
  drop constraint if exists account_warmup_settings_day_4_plus_cap_check,
  drop constraint if exists account_warmup_settings_progression_check;

alter table public.account_warmup_settings
  add constraint account_warmup_settings_day_1_cap_check
    check (day_1_follow_cap > 0),
  add constraint account_warmup_settings_day_2_cap_check
    check (day_2_follow_cap > 0),
  add constraint account_warmup_settings_day_3_cap_check
    check (day_3_follow_cap > 0),
  add constraint account_warmup_settings_day_4_plus_cap_check
    check (day_4_plus_follow_cap is null or day_4_plus_follow_cap > 0),
  add constraint account_warmup_settings_progression_check
    check (
      day_1_follow_cap <= day_2_follow_cap
      and day_2_follow_cap <= day_3_follow_cap
      and (day_4_plus_follow_cap is null or day_3_follow_cap <= day_4_plus_follow_cap)
    );

create or replace view public.account_package_summary
with (security_invoker = true) as
with current_package as (
  select distinct on (acp.account_id)
    acp.account_id,
    acp.package_code,
    cp.label as package_label,
    coalesce(
      nullif(acp.metadata_safe ->> 'package_started_at', '')::timestamptz,
      nullif(acp.metadata_safe ->> 'service_started_at', '')::timestamptz,
      nullif(acp.metadata_safe ->> 'warmup_started_at', '')::timestamptz
    ) as metadata_package_started_at,
    cp.default_follow_day_cap,
    cp.default_follow_session_cap,
    coalesce(cp.max_follow_day_cap, cp.default_follow_day_cap) as max_follow_day_cap,
    coalesce(cp.max_follow_session_cap, cp.default_follow_session_cap) as max_follow_session_cap,
    cp.default_unfollow_day_cap,
    cp.default_unfollow_session_cap,
    cp.default_welcome_enabled,
    cp.default_welcome_day_cap,
    cp.default_outreach_enabled,
    cp.default_outreach_day_cap,
    cp.advanced_ct_enabled,
    cp.ai_comment_enabled,
    cp.ai_targeting_enabled
  from public.account_commercial_packages acp
  join public.commercial_packages cp on cp.code = acp.package_code
  where acp.status = 'active'
    and acp.starts_at <= now()
    and (acp.ends_at is null or acp.ends_at > now())
  order by acp.account_id, acp.starts_at desc, acp.created_at desc
),
active_addons as (
  select
    account_id,
    array_agg(distinct addon_code order by addon_code) as commercial_addons,
    max(addon_variant) filter (where addon_code like 'outreach%') as outreach_variant,
    max(source_type) filter (where addon_code like 'outreach%') as outreach_job_source
  from public.account_commercial_addons
  where status = 'active'
    and starts_at <= now()
    and (ends_at is null or ends_at > now())
  group by account_id
),
account_clients as (
  select account_id, client_id
  from public.client_instagram_accounts
),
entitlement_summary as (
  select
    coalesce(ce.account_id, ac.account_id) as account_id,
    array_agg(distinct ce.feature_code order by ce.feature_code) filter (where ce.active) as entitlements
  from public.client_entitlements ce
  left join account_clients ac on ac.client_id = ce.client_id
  where ce.active = true
  group by coalesce(ce.account_id, ac.account_id)
),
runtime_profiles as (
  select
    csa.account_id,
    array_agg(distinct cs.subscription_type order by cs.subscription_type) as runtime_profiles
  from public.client_subscription_accounts csa
  join public.client_subscriptions cs on cs.id = csa.subscription_id
  where csa.status = 'active'
    and cs.status = 'active'
  group by csa.account_id
),
follow_caps as (
  select
    account_id,
    follow_limit as follow_session_cap,
    max_actions_per_day as follow_day_cap,
    warmup_mode
  from public.ig_account_settings
),
unfollow_caps as (
  select
    account_id,
    unfollow_per_session_limit,
    unfollow_per_day_limit
  from public.ig_account_unfollow_settings
),
dm_caps as (
  select
    account_id,
    welcome_per_session_limit,
    welcome_per_day_limit,
    outreach_per_session_limit,
    outreach_per_day_limit
  from public.ig_account_dm_settings
),
follow_activity_days as (
  select
    account_id,
    count(distinct (event_at at time zone 'Africa/Johannesburg')::date)
      filter (
        where (event_at at time zone 'Africa/Johannesburg')::date
          < (now() at time zone 'Africa/Johannesburg')::date
      )::integer as prior_active_days
  from public.ig_interaction_events
  where interaction_type = 'follow'
    and interaction_status = 'success'
    and event_type = 'follow_verified'
    and run_id is not null
  group by account_id
),
resolved as (
  select
    a.id as account_id,
    cp.package_code,
    cp.package_label,
    cp.default_follow_day_cap,
    cp.default_follow_session_cap,
    cp.max_follow_day_cap,
    cp.max_follow_session_cap,
    cp.default_unfollow_day_cap,
    cp.default_unfollow_session_cap,
    cp.default_welcome_enabled,
    cp.default_welcome_day_cap,
    cp.default_outreach_enabled,
    cp.default_outreach_day_cap,
    cp.advanced_ct_enabled,
    cp.ai_comment_enabled,
    cp.ai_targeting_enabled,
    coalesce(aa.commercial_addons, array[]::text[]) as commercial_addons,
    coalesce(aa.outreach_variant, 'pending_source_classification') as outreach_variant,
    coalesce(aa.outreach_job_source, 'pending_source_classification') as outreach_job_source,
    coalesce(es.entitlements, array[]::text[]) as entitlements,
    coalesce(rp.runtime_profiles, array[]::text[]) as runtime_profiles,
    coalesce(aws.warmup_enabled, coalesce(fc.warmup_mode, true)) as warmup_enabled,
    coalesce(aws.package_started_at, cp.metadata_package_started_at) as package_started_at,
    least(coalesce(aws.day_1_follow_cap, 10), cp.max_follow_day_cap, cp.max_follow_session_cap) as day_1_follow_cap,
    least(coalesce(aws.day_2_follow_cap, 20), cp.max_follow_day_cap, cp.max_follow_session_cap) as day_2_follow_cap,
    least(coalesce(aws.day_3_follow_cap, 40), cp.max_follow_day_cap, cp.max_follow_session_cap) as day_3_follow_cap,
    least(coalesce(aws.day_4_plus_follow_cap, cp.max_follow_day_cap), cp.max_follow_day_cap, cp.max_follow_session_cap) as day_4_plus_follow_cap,
    coalesce(fad.prior_active_days, 0) as prior_active_days,
    fc.follow_day_cap,
    fc.follow_session_cap,
    uc.unfollow_per_day_limit,
    uc.unfollow_per_session_limit,
    dc.welcome_per_day_limit,
    dc.welcome_per_session_limit,
    dc.outreach_per_day_limit,
    dc.outreach_per_session_limit
  from public.ig_accounts a
  left join current_package cp on cp.account_id = a.id
  left join active_addons aa on aa.account_id = a.id
  left join entitlement_summary es on es.account_id = a.id
  left join runtime_profiles rp on rp.account_id = a.id
  left join follow_caps fc on fc.account_id = a.id
  left join unfollow_caps uc on uc.account_id = a.id
  left join dm_caps dc on dc.account_id = a.id
  left join public.account_warmup_settings aws on aws.account_id = a.id
  left join follow_activity_days fad on fad.account_id = a.id
),
with_warmup as (
  select
    r.*,
    least(4, r.prior_active_days + 1)::integer as warmup_day
  from resolved r
),
with_warmup_cap as (
  select
    w.*,
    case
      when not coalesce(w.warmup_enabled, true) then least(w.max_follow_day_cap, w.max_follow_session_cap)
      when w.warmup_day <= 1 then w.day_1_follow_cap
      when w.warmup_day = 2 then w.day_2_follow_cap
      when w.warmup_day = 3 then w.day_3_follow_cap
      else w.day_4_plus_follow_cap
    end as warmup_follow_cap
  from with_warmup w
)
select
  w.account_id,
  w.package_code as commercial_package_code,
  w.package_label as commercial_package_label,
  w.commercial_addons,
  w.outreach_variant,
  w.outreach_job_source,
  w.entitlements,
  w.runtime_profiles,
  null::text as assignment_profile,
  case
    when not coalesce(w.warmup_enabled, true) then 'disabled'
    when w.warmup_day >= 4 then 'warmed_up'
    else 'warming_up'
  end as warmup_status,
  w.warmup_day,
  w.package_started_at,
  jsonb_build_object(
    'follow_day', w.max_follow_day_cap,
    'follow_session', w.max_follow_session_cap,
    'unfollow_day', w.default_unfollow_day_cap,
    'unfollow_session', w.default_unfollow_session_cap,
    'welcome_enabled', w.default_welcome_enabled,
    'welcome_day', w.default_welcome_day_cap,
    'outreach_enabled', w.default_outreach_enabled,
    'outreach_day', w.default_outreach_day_cap,
    'advanced_ct_enabled', w.advanced_ct_enabled,
    'ai_comment_enabled', w.ai_comment_enabled,
    'ai_targeting_enabled', w.ai_targeting_enabled
  ) as package_caps,
  jsonb_build_object(
    'warmup_enabled', w.warmup_enabled,
    'day_1_follow_cap', w.day_1_follow_cap,
    'day_2_follow_cap', w.day_2_follow_cap,
    'day_3_follow_cap', w.day_3_follow_cap,
    'day_4_plus_follow_cap', w.day_4_plus_follow_cap,
    'warmup_follow_day_cap', w.warmup_follow_cap,
    'follow_day', least(
      coalesce(w.follow_day_cap, w.default_follow_day_cap),
      coalesce(w.max_follow_day_cap, w.follow_day_cap),
      w.warmup_follow_cap
    ),
    'follow_session', least(
      coalesce(w.follow_session_cap, w.default_follow_session_cap),
      coalesce(w.max_follow_session_cap, w.follow_session_cap),
      w.warmup_follow_cap
    ),
    'unfollow_day', least(coalesce(w.unfollow_per_day_limit, w.default_unfollow_day_cap), w.default_unfollow_day_cap),
    'unfollow_session', least(coalesce(w.unfollow_per_session_limit, w.default_unfollow_session_cap), w.default_unfollow_session_cap),
    'welcome_day', least(coalesce(w.welcome_per_day_limit, w.default_welcome_day_cap), w.default_welcome_day_cap),
    'welcome_session', least(coalesce(w.welcome_per_session_limit, w.default_welcome_day_cap), w.default_welcome_day_cap),
    'outreach_day', least(coalesce(w.outreach_per_day_limit, w.default_outreach_day_cap), w.default_outreach_day_cap),
    'outreach_session', w.outreach_per_session_limit,
    'warmup_applied', coalesce(w.warmup_enabled, true)
  ) as effective_caps_preview,
  jsonb_build_object(
    'follow_day', w.default_follow_day_cap,
    'follow_session', w.default_follow_session_cap
  ) as package_defaults
from with_warmup_cap w;

comment on view public.account_package_summary is
  'Commercial package defaults, maxima and effective caps. Follow warmup caps are account-configured while the active day remains based on prior distinct SAST dates with persisted follow_verified activity.';
