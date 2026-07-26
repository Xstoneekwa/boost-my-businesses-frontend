-- Canonical package/runtime contract for account assignment and login provisioning.
-- The selected commercial package remains the business source of truth. The
-- assigned phone_app_instance is the Android package source of truth.

create table if not exists public.commercial_package_runtime_settings (
  package_code text primary key references public.commercial_packages(code) on delete restrict,
  max_follows_per_target_per_run integer not null check (max_follows_per_target_per_run between 1 and 50),
  max_targets_per_run integer not null check (max_targets_per_run between 1 and 10),
  likes_per_follow_min integer not null check (likes_per_follow_min >= 0),
  likes_per_follow_max integer not null check (likes_per_follow_max >= likes_per_follow_min),
  likes_per_day_limit integer not null check (likes_per_day_limit >= 0),
  welcome_per_session_limit integer not null check (welcome_per_session_limit >= 0),
  outreach_per_session_limit integer not null check (outreach_per_session_limit >= 0),
  unfollow_after_days integer not null check (unfollow_after_days >= 0),
  runtime_profile text not null check (runtime_profile in ('full_cycle', 'outreach_only')),
  schedule_mode text not null check (schedule_mode in ('scheduled', 'manual_only')),
  slot_kind text not null check (slot_kind in ('full_cycle_6h', 'outreach_short', 'outreach_40m', 'manual_only')),
  warmup_enabled boolean not null default true,
  warmup_profile_code text not null default 'follow_default_v1',
  warmup_day_1_cap integer not null check (warmup_day_1_cap > 0),
  warmup_day_2_cap integer not null check (warmup_day_2_cap > 0),
  warmup_day_3_cap integer not null check (warmup_day_3_cap > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.commercial_package_runtime_settings (
  package_code, max_follows_per_target_per_run, max_targets_per_run,
  likes_per_follow_min, likes_per_follow_max, likes_per_day_limit,
  welcome_per_session_limit, outreach_per_session_limit, unfollow_after_days,
  runtime_profile, schedule_mode, slot_kind,
  warmup_enabled, warmup_profile_code, warmup_day_1_cap, warmup_day_2_cap, warmup_day_3_cap
)
values
  ('growth', 30, 4, 0, 2, 100, 0, 5, 3, 'full_cycle', 'scheduled', 'full_cycle_6h', true, 'follow_default_v1', 10, 20, 40),
  ('pro', 30, 4, 0, 2, 100, 10, 5, 3, 'full_cycle', 'scheduled', 'full_cycle_6h', true, 'follow_default_v1', 10, 20, 40),
  ('premium', 30, 4, 0, 2, 100, 10, 5, 3, 'full_cycle', 'scheduled', 'full_cycle_6h', true, 'follow_default_v1', 10, 20, 40),
  ('internal_test', 30, 4, 0, 2, 100, 0, 5, 3, 'full_cycle', 'scheduled', 'full_cycle_6h', true, 'follow_default_v1', 10, 20, 40),
  ('outreach_standalone', 30, 4, 0, 0, 0, 0, 5, 0, 'outreach_only', 'scheduled', 'outreach_40m', false, 'disabled', 1, 1, 1)
on conflict (package_code) do update
set max_follows_per_target_per_run = excluded.max_follows_per_target_per_run,
    max_targets_per_run = excluded.max_targets_per_run,
    likes_per_follow_min = excluded.likes_per_follow_min,
    likes_per_follow_max = excluded.likes_per_follow_max,
    likes_per_day_limit = excluded.likes_per_day_limit,
    welcome_per_session_limit = excluded.welcome_per_session_limit,
    outreach_per_session_limit = excluded.outreach_per_session_limit,
    unfollow_after_days = excluded.unfollow_after_days,
    runtime_profile = excluded.runtime_profile,
    schedule_mode = excluded.schedule_mode,
    slot_kind = excluded.slot_kind,
    warmup_enabled = excluded.warmup_enabled,
    warmup_profile_code = excluded.warmup_profile_code,
    warmup_day_1_cap = excluded.warmup_day_1_cap,
    warmup_day_2_cap = excluded.warmup_day_2_cap,
    warmup_day_3_cap = excluded.warmup_day_3_cap,
    updated_at = now();

alter table public.commercial_package_runtime_settings enable row level security;
revoke all on table public.commercial_package_runtime_settings from public, anon, authenticated;
grant select on table public.commercial_package_runtime_settings to service_role;

create or replace function public.reconcile_account_package_runtime_contract(
  p_account_id uuid,
  p_source text default 'canonical_reconcile'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_package public.commercial_packages%rowtype;
  v_runtime public.commercial_package_runtime_settings%rowtype;
  v_account_package public.account_commercial_packages%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_instance public.phone_app_instances%rowtype;
  v_subscription_type text;
  v_expected_clone_mode text;
  v_outreach_enabled boolean := false;
  v_outreach_day integer := 0;
  v_outreach_session integer := 0;
  v_welcome_day integer := 0;
  v_welcome_session integer := 0;
  v_settings_count integer := 0;
begin
  if p_account_id is null then
    raise exception 'package_settings_incomplete';
  end if;

  select acp.* into v_account_package
  from public.account_commercial_packages acp
  where acp.account_id = p_account_id
    and acp.status = 'active'
    and (acp.ends_at is null or acp.ends_at > now())
  order by acp.starts_at desc, acp.created_at desc
  limit 1
  for update;

  if v_account_package.id is null then
    raise exception 'package_settings_incomplete';
  end if;

  select cp.* into v_package
  from public.commercial_packages cp
  where cp.code = v_account_package.package_code
    and cp.active = true;

  if v_package.code is null
     or v_package.default_follow_day_cap is null
     or v_package.default_follow_session_cap is null
     or v_package.default_unfollow_day_cap is null
     or v_package.default_unfollow_session_cap is null then
    raise exception 'package_settings_incomplete';
  end if;

  select prs.* into v_runtime
  from public.commercial_package_runtime_settings prs
  where prs.package_code = v_package.code;
  if v_runtime.package_code is null then
    raise exception 'package_settings_incomplete';
  end if;

  if not exists (
    select 1
    from public.client_account_entitlements cae
    where cae.account_id = p_account_id
      and cae.status = 'entitlement_consumed'
      and cae.commercial_package_code = v_account_package.package_code
  ) then
    raise exception 'package_settings_incomplete';
  end if;

  select aa.* into v_assignment
  from public.account_assignments aa
  where aa.account_id = p_account_id
    and aa.status in ('pending', 'reserved', 'active')
  order by aa.updated_at desc, aa.created_at desc
  limit 1
  for update;

  if v_assignment.id is null
     or v_assignment.device_id is null
     or v_assignment.app_instance_id is null then
    raise exception 'assignment_package_mismatch';
  end if;

  select pai.* into v_instance
  from public.phone_app_instances pai
  where pai.id = v_assignment.app_instance_id
  for update;

  if v_instance.id is null
     or v_instance.device_id <> v_assignment.device_id
     or nullif(trim(v_instance.package_name), '') is null
     or not coalesce(v_instance.is_launchable, false)
     or not coalesce(v_instance.usable_for_auto_login, false) then
    raise exception 'app_instance_package_mismatch';
  end if;

  select cs.subscription_type into v_subscription_type
  from public.client_subscription_accounts csa
  join public.client_subscriptions cs on cs.id = csa.subscription_id
  where csa.account_id = p_account_id
    and csa.status = 'active'
    and cs.status = 'active'
  order by cs.starts_at desc, cs.created_at desc
  limit 1;

  if nullif(trim(v_subscription_type), '') is null
     or v_assignment.assignment_type is distinct from v_subscription_type then
    raise exception 'runtime_profile_mismatch';
  end if;

  v_expected_clone_mode := case
    when v_instance.instance_type = 'primary_app' or coalesce(v_instance.instance_index, 0) = 0 then 'off'
    else 'clone_' || v_instance.instance_index::text
  end;

  select count(*) into v_settings_count
  from public.ig_account_settings s
  where s.account_id = p_account_id
    and s.likes_per_follow_min is not null
    and s.likes_per_follow_max is not null
    and s.total_likes_limit is not null;

  if v_settings_count <> 1 then
    raise exception 'package_settings_incomplete';
  end if;

  select exists (
    select 1
    from public.client_account_entitlements cae
    where cae.account_id = p_account_id
      and cae.status = 'entitlement_consumed'
      and (
        nullif(trim(cae.outreach_addon_key), '') is not null
        or nullif(trim(cae.outreach_variant), '') is not null
        or nullif(trim(cae.backend_addon_code), '') is not null
      )
  ) into v_outreach_enabled;

  if v_outreach_enabled then
    select coalesce(cp.default_outreach_day_cap, 0)
    into v_outreach_day
    from public.commercial_packages cp
    where cp.code = 'outreach_standalone' and cp.active = true;
    if coalesce(v_outreach_day, 0) <= 0 then
      raise exception 'package_settings_incomplete';
    end if;
    v_outreach_session := least(v_outreach_day, v_runtime.outreach_per_session_limit);
  end if;

  v_welcome_day := case
    when coalesce(v_package.default_welcome_enabled, false)
      then coalesce(v_package.default_welcome_day_cap, 0)
    else 0
  end;
  v_welcome_session := least(v_welcome_day, v_runtime.welcome_per_session_limit);

  update public.ig_accounts
  set clone_mode = v_expected_clone_mode,
      device_name = (select coalesce(pd.name, pd.device_name) from public.phone_devices pd where pd.id = v_assignment.device_id),
      updated_at = now()
  where id = p_account_id;

  update public.ig_account_settings
  set app_package = v_instance.package_name,
      clone_mode = v_expected_clone_mode,
      cloned_app_mode = v_expected_clone_mode <> 'off',
      follow_enabled = v_subscription_type = 'full_cycle',
      like_enabled = v_subscription_type = 'full_cycle',
      unfollow_enabled = v_subscription_type = 'full_cycle',
      welcome_dm_enabled = v_subscription_type = 'full_cycle' and coalesce(v_package.default_welcome_enabled, false),
      cold_dm_enabled = v_outreach_enabled,
      max_actions_per_day = v_package.default_follow_day_cap,
      follow_limit = v_package.default_follow_session_cap,
      max_follow_per_run = v_package.default_follow_session_cap,
      total_unfollows_limit = v_package.default_unfollow_day_cap,
      likes_per_follow_min = v_runtime.likes_per_follow_min,
      likes_per_follow_max = v_runtime.likes_per_follow_max,
      total_likes_limit = v_runtime.likes_per_day_limit,
      warmup_mode = v_runtime.warmup_enabled,
      updated_at = now()
  where account_id = p_account_id;

  if not found then
    raise exception 'package_settings_incomplete';
  end if;

  insert into public.account_follow_source_settings (
    account_id, max_follows_per_target_per_run, max_targets_per_run, updated_at, updated_by, metadata
  ) values (
    p_account_id, v_runtime.max_follows_per_target_per_run, v_runtime.max_targets_per_run,
    now(), coalesce(nullif(trim(p_source), ''), 'canonical_reconcile'),
    jsonb_build_object('source', 'canonical_package_runtime_contract', 'package_code', v_package.code)
  )
  on conflict (account_id) do update
  set max_follows_per_target_per_run = excluded.max_follows_per_target_per_run,
      max_targets_per_run = excluded.max_targets_per_run,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by,
      metadata = coalesce(public.account_follow_source_settings.metadata, '{}'::jsonb) || excluded.metadata;

  insert into public.ig_account_unfollow_settings (
    account_id, unfollow_enabled, unfollow_after_days, unfollow_mode,
    unfollow_per_session_limit, unfollow_per_day_limit, runtime_cap_mode,
    runtime_safety_cap, package_default_snapshot, updated_at
  ) values (
    p_account_id, v_subscription_type = 'full_cycle', v_runtime.unfollow_after_days, 'unfollow',
    v_package.default_unfollow_session_cap, v_package.default_unfollow_day_cap,
    'prod_normal', null,
    jsonb_build_object(
      'source', 'commercial_packages',
      'package_code', v_package.code,
      'unfollow_day', v_package.default_unfollow_day_cap,
      'unfollow_session', v_package.default_unfollow_session_cap
    ),
    now()
  )
  on conflict (account_id) do update
  set unfollow_enabled = excluded.unfollow_enabled,
      unfollow_after_days = excluded.unfollow_after_days,
      unfollow_per_session_limit = excluded.unfollow_per_session_limit,
      unfollow_per_day_limit = excluded.unfollow_per_day_limit,
      runtime_cap_mode = excluded.runtime_cap_mode,
      runtime_safety_cap = excluded.runtime_safety_cap,
      package_default_snapshot = excluded.package_default_snapshot,
      updated_at = excluded.updated_at;

  insert into public.account_warmup_settings (
    account_id, warmup_enabled, package_started_at, warmup_profile_code,
    day_1_follow_cap, day_2_follow_cap, day_3_follow_cap, day_4_plus_follow_cap,
    status, updated_at
  ) values (
    p_account_id, v_runtime.warmup_enabled, v_account_package.starts_at,
    v_runtime.warmup_profile_code, v_runtime.warmup_day_1_cap,
    v_runtime.warmup_day_2_cap, v_runtime.warmup_day_3_cap,
    v_package.default_follow_day_cap, 'active', now()
  )
  on conflict (account_id) do update
  set warmup_enabled = excluded.warmup_enabled,
      package_started_at = excluded.package_started_at,
      warmup_profile_code = excluded.warmup_profile_code,
      day_1_follow_cap = excluded.day_1_follow_cap,
      day_2_follow_cap = excluded.day_2_follow_cap,
      day_3_follow_cap = excluded.day_3_follow_cap,
      day_4_plus_follow_cap = excluded.day_4_plus_follow_cap,
      status = excluded.status,
      updated_at = excluded.updated_at;

  insert into public.ig_account_dm_settings (
    account_id, welcome_enabled, outreach_enabled,
    welcome_per_session_limit, welcome_per_day_limit,
    outreach_per_session_limit, outreach_per_day_limit,
    total_dm_per_day_limit, updated_at
  ) values (
    p_account_id,
    v_subscription_type = 'full_cycle' and coalesce(v_package.default_welcome_enabled, false),
    v_outreach_enabled,
    v_welcome_session, v_welcome_day,
    v_outreach_session, v_outreach_day,
    v_welcome_day + v_outreach_day,
    now()
  )
  on conflict (account_id) do update
  set welcome_enabled = excluded.welcome_enabled,
      outreach_enabled = excluded.outreach_enabled,
      welcome_per_session_limit = excluded.welcome_per_session_limit,
      welcome_per_day_limit = excluded.welcome_per_day_limit,
      outreach_per_session_limit = excluded.outreach_per_session_limit,
      outreach_per_day_limit = excluded.outreach_per_day_limit,
      total_dm_per_day_limit = excluded.total_dm_per_day_limit,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'reason', 'package_runtime_contract_reconciled',
    'account_id', p_account_id,
    'commercial_package_code', v_package.code,
    'runtime_profile', v_subscription_type,
    'assignment_id', v_assignment.id,
    'device_id', v_assignment.device_id,
    'app_instance_id', v_instance.id,
    'clone_mode', v_expected_clone_mode,
    'android_package_name', v_instance.package_name,
    'source', coalesce(nullif(trim(p_source), ''), 'canonical_reconcile')
  );
end;
$function$;

revoke all on function public.reconcile_account_package_runtime_contract(uuid, text) from public, anon, authenticated;
grant execute on function public.reconcile_account_package_runtime_contract(uuid, text) to service_role;

create or replace function public.account_package_runtime_contract_status(p_account_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_package_code text;
  v_entitlement_package text;
  v_package_caps jsonb;
  v_effective_preview jsonb;
  v_runtime_profiles jsonb;
  v_runtime public.commercial_package_runtime_settings%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_instance public.phone_app_instances%rowtype;
  v_settings public.ig_account_settings%rowtype;
  v_sources public.account_follow_source_settings%rowtype;
  v_unfollow public.ig_account_unfollow_settings%rowtype;
  v_dm public.ig_account_dm_settings%rowtype;
  v_subscription_type text;
  v_expected_clone_mode text;
  v_reason text := 'ready';
  v_follow_day integer;
  v_follow_session integer;
  v_unfollow_day integer;
  v_unfollow_session integer;
begin
  select aps.commercial_package_code, aps.package_caps, aps.effective_caps_preview,
         to_jsonb(aps.runtime_profiles)
  into v_package_code, v_package_caps, v_effective_preview, v_runtime_profiles
  from public.account_package_summary aps
  where aps.account_id = p_account_id;

  select cae.commercial_package_code into v_entitlement_package
  from public.client_account_entitlements cae
  where cae.account_id = p_account_id and cae.status = 'entitlement_consumed'
  order by cae.consumed_at desc nulls last, cae.created_at desc
  limit 1;

  if v_package_code is not null then
    select prs.* into v_runtime
    from public.commercial_package_runtime_settings prs
    where prs.package_code = v_package_code;
  end if;

  select aa.* into v_assignment
  from public.account_assignments aa
  where aa.account_id = p_account_id and aa.status in ('pending', 'reserved', 'active')
  order by aa.updated_at desc, aa.created_at desc limit 1;

  if v_assignment.app_instance_id is not null then
    select pai.* into v_instance from public.phone_app_instances pai where pai.id = v_assignment.app_instance_id;
  end if;
  select s.* into v_settings
  from public.ig_account_settings s
  where s.account_id = p_account_id
  order by s.updated_at desc nulls last, s.created_at desc nulls last
  limit 1;
  select s.* into v_sources from public.account_follow_source_settings s where s.account_id = p_account_id;
  select s.* into v_unfollow from public.ig_account_unfollow_settings s where s.account_id = p_account_id;
  select s.* into v_dm from public.ig_account_dm_settings s where s.account_id = p_account_id;
  select cs.subscription_type into v_subscription_type
  from public.client_subscription_accounts csa
  join public.client_subscriptions cs on cs.id = csa.subscription_id
  where csa.account_id = p_account_id and csa.status = 'active' and cs.status = 'active'
  order by cs.starts_at desc, cs.created_at desc limit 1;

  v_expected_clone_mode := case
    when v_instance.id is null then null
    when v_instance.instance_type = 'primary_app' or coalesce(v_instance.instance_index, 0) = 0 then 'off'
    else 'clone_' || v_instance.instance_index::text
  end;

  if v_package_code is null
     or v_runtime.package_code is null
     or v_entitlement_package is distinct from v_package_code then
    v_reason := 'package_settings_incomplete';
  elsif v_assignment.id is null or v_assignment.device_id is null or v_assignment.app_instance_id is null then
    v_reason := 'assignment_package_mismatch';
  elsif v_instance.id is null
     or v_instance.device_id is distinct from v_assignment.device_id
     or nullif(trim(v_instance.package_name), '') is null
     or not coalesce(v_instance.is_launchable, false)
     or not coalesce(v_instance.usable_for_auto_login, false) then
    v_reason := 'app_instance_package_mismatch';
  elsif nullif(trim(v_settings.app_package), '') is null
     or v_settings.app_package is distinct from v_instance.package_name then
    v_reason := 'assignment_package_mismatch';
  elsif v_settings.clone_mode is distinct from v_expected_clone_mode
     or v_settings.cloned_app_mode is distinct from (v_expected_clone_mode <> 'off') then
    v_reason := 'clone_package_mismatch';
  elsif v_subscription_type is null
     or v_assignment.assignment_type is distinct from v_subscription_type
     or not coalesce(v_runtime_profiles ? v_subscription_type, false) then
    v_reason := 'runtime_profile_mismatch';
  elsif v_settings.account_id is null
     or v_sources.account_id is null
     or v_unfollow.account_id is null
     or v_dm.account_id is null
     or coalesce((v_package_caps ->> 'follow_day')::integer, 0) <= 0
     or coalesce((v_package_caps ->> 'follow_session')::integer, 0) <= 0
     or coalesce((v_package_caps ->> 'unfollow_day')::integer, 0) <= 0
     or coalesce((v_package_caps ->> 'unfollow_session')::integer, 0) <= 0
     or coalesce(v_settings.max_actions_per_day, 0) <= 0
     or coalesce(v_settings.follow_limit, 0) <= 0
     or coalesce(v_settings.max_follow_per_run, 0) <= 0
     or coalesce(v_sources.max_follows_per_target_per_run, 0) <= 0
     or coalesce(v_sources.max_targets_per_run, 0) <= 0
     or coalesce(v_unfollow.unfollow_per_day_limit, 0) <= 0
     or coalesce(v_unfollow.unfollow_per_session_limit, 0) <= 0
     or v_settings.likes_per_follow_min is null
     or v_settings.likes_per_follow_max is null
     or v_settings.total_likes_limit is null
     or v_dm.welcome_enabled is null
     or v_dm.welcome_per_session_limit is null
     or v_dm.welcome_per_day_limit is null
     or v_dm.outreach_enabled is null
     or v_dm.outreach_per_session_limit is null
     or v_dm.outreach_per_day_limit is null then
    v_reason := 'package_settings_incomplete';
  elsif v_settings.max_actions_per_day is distinct from (v_package_caps ->> 'follow_day')::integer
     or v_settings.follow_limit is distinct from (v_package_caps ->> 'follow_session')::integer
     or v_settings.max_follow_per_run is distinct from (v_package_caps ->> 'follow_session')::integer
     or v_sources.max_follows_per_target_per_run is distinct from v_runtime.max_follows_per_target_per_run
     or v_sources.max_targets_per_run is distinct from v_runtime.max_targets_per_run
     or v_unfollow.unfollow_per_day_limit is distinct from (v_package_caps ->> 'unfollow_day')::integer
     or v_unfollow.unfollow_per_session_limit is distinct from (v_package_caps ->> 'unfollow_session')::integer
     or v_settings.likes_per_follow_min is distinct from v_runtime.likes_per_follow_min
     or v_settings.likes_per_follow_max is distinct from v_runtime.likes_per_follow_max
     or v_settings.total_likes_limit is distinct from v_runtime.likes_per_day_limit then
    v_reason := 'package_settings_incomplete';
  elsif v_assignment.schedule_mode = 'scheduled'
     and (v_assignment.starts_at is null or v_assignment.ends_at is null or v_assignment.ends_at <= v_assignment.starts_at) then
    v_reason := 'package_settings_incomplete';
  end if;

  v_follow_day := least(
    coalesce(v_settings.max_actions_per_day, 2147483647),
    coalesce((v_package_caps ->> 'follow_day')::integer, 2147483647),
    coalesce((v_effective_preview ->> 'follow_day')::integer, 2147483647)
  );
  v_follow_session := least(
    coalesce(v_settings.follow_limit, 2147483647),
    coalesce((v_package_caps ->> 'follow_session')::integer, 2147483647)
  );
  v_unfollow_day := least(
    coalesce(v_unfollow.unfollow_per_day_limit, 2147483647),
    coalesce((v_package_caps ->> 'unfollow_day')::integer, 2147483647)
  );
  v_unfollow_session := least(
    coalesce(v_unfollow.unfollow_per_session_limit, 2147483647),
    coalesce((v_package_caps ->> 'unfollow_session')::integer, 2147483647)
  );

  return jsonb_build_object(
    'ok', v_reason = 'ready',
    'reason', v_reason,
    'commercial_package_code', v_package_code,
    'entitlement_package_code', v_entitlement_package,
    'runtime_profile', v_subscription_type,
    'assignment', jsonb_build_object(
      'assignment_id', v_assignment.id,
      'device_id', v_assignment.device_id,
      'app_instance_id', v_assignment.app_instance_id,
      'schedule_mode', v_assignment.schedule_mode,
      'slot_kind', v_assignment.slot_kind,
      'starts_at', v_assignment.starts_at,
      'ends_at', v_assignment.ends_at
    ),
    'android', jsonb_build_object(
      'package_name', v_instance.package_name,
      'instance_type', v_instance.instance_type,
      'instance_index', v_instance.instance_index,
      'expected_clone_mode', v_expected_clone_mode,
      'configured_package_name', v_settings.app_package,
      'configured_clone_mode', v_settings.clone_mode
    ),
    'settings', jsonb_build_object(
      'follow_day', jsonb_build_object('db', v_settings.max_actions_per_day, 'package', v_package_caps -> 'follow_day', 'env_hard_cap', null, 'effective', v_follow_day, 'source', 'ig_account_settings+account_package_summary'),
      'follow_session', jsonb_build_object('db', v_settings.follow_limit, 'package', v_package_caps -> 'follow_session', 'env_hard_cap', null, 'effective', v_follow_session, 'source', 'ig_account_settings+account_package_summary'),
      'max_follows_per_target_per_run', jsonb_build_object('db', v_sources.max_follows_per_target_per_run, 'package', v_runtime.max_follows_per_target_per_run, 'effective', v_sources.max_follows_per_target_per_run, 'source', 'commercial_package_runtime_settings+account_follow_source_settings'),
      'max_targets_per_run', jsonb_build_object('db', v_sources.max_targets_per_run, 'package', v_runtime.max_targets_per_run, 'effective', v_sources.max_targets_per_run, 'source', 'commercial_package_runtime_settings+account_follow_source_settings'),
      'unfollow_day', jsonb_build_object('db', v_unfollow.unfollow_per_day_limit, 'package', v_package_caps -> 'unfollow_day', 'env_hard_cap', v_unfollow.runtime_safety_cap, 'effective', v_unfollow_day, 'source', 'ig_account_unfollow_settings+account_package_summary'),
      'unfollow_session', jsonb_build_object('db', v_unfollow.unfollow_per_session_limit, 'package', v_package_caps -> 'unfollow_session', 'env_hard_cap', v_unfollow.runtime_safety_cap, 'effective', v_unfollow_session, 'source', 'ig_account_unfollow_settings+account_package_summary'),
      'likes_per_follow', jsonb_build_object('min', v_settings.likes_per_follow_min, 'max', v_settings.likes_per_follow_max, 'source', 'ig_account_settings'),
      'likes_day', jsonb_build_object('db', v_settings.total_likes_limit, 'env_hard_cap', null, 'effective', v_settings.total_likes_limit, 'source', 'ig_account_settings'),
      'welcome', jsonb_build_object('enabled', v_dm.welcome_enabled, 'session', v_dm.welcome_per_session_limit, 'day', v_dm.welcome_per_day_limit, 'source', 'ig_account_dm_settings'),
      'outreach', jsonb_build_object('enabled', v_dm.outreach_enabled, 'session', v_dm.outreach_per_session_limit, 'day', v_dm.outreach_per_day_limit, 'source', 'client_account_entitlements+ig_account_dm_settings'),
      'max_actions_per_day', jsonb_build_object('db', v_settings.max_actions_per_day, 'effective', v_follow_day, 'source', 'ig_account_settings'),
      'ops_controls', jsonb_build_object('dry_run_enabled', v_settings.dry_run_enabled, 'send_enabled', v_settings.send_enabled, 'source', 'ig_account_settings')
    )
  );
end;
$function$;

revoke all on function public.account_package_runtime_contract_status(uuid) from public, anon, authenticated;
grant execute on function public.account_package_runtime_contract_status(uuid) to service_role;

create or replace function public.enforce_assignment_package_runtime_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.status in ('pending', 'reserved', 'active') then
    perform public.reconcile_account_package_runtime_contract(new.account_id, 'assignment_trigger');
  end if;
  return new;
end;
$function$;

drop trigger if exists account_assignment_package_runtime_contract on public.account_assignments;
create trigger account_assignment_package_runtime_contract
after insert or update of device_id, app_instance_id, assignment_type, schedule_mode, starts_at, ends_at, status
on public.account_assignments
for each row execute function public.enforce_assignment_package_runtime_contract();

create or replace function public.block_invalid_login_package_runtime_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_contract jsonb;
  v_reason text;
begin
  if new.requested_run_type in ('login_provisioning', 'login_email_code_resume') then
    v_contract := public.account_package_runtime_contract_status(new.account_id);
    v_reason := coalesce(v_contract ->> 'reason', 'package_settings_incomplete');
    if not coalesce((v_contract ->> 'ok')::boolean, false) then
      raise exception '%', v_reason;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists account_run_request_package_runtime_preflight on public.account_run_requests;
create trigger account_run_request_package_runtime_preflight
before insert on public.account_run_requests
for each row execute function public.block_invalid_login_package_runtime_contract();

revoke all on function public.enforce_assignment_package_runtime_contract() from public, anon, authenticated;
revoke all on function public.block_invalid_login_package_runtime_contract() from public, anon, authenticated;
