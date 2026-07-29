-- Account-level Follow source rotation overrides.
--
-- Package runtime values remain hard ceilings. Positive account values at or
-- below those ceilings are explicit overrides, matching the existing Follow
-- cap contract. This migration changes no account row and starts no runtime.

begin;

create or replace function public.account_package_runtime_contract_status(p_account_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_package_code text;
  v_entitlement_package text;
  v_legacy_package_code text;
  v_entitlement_source text;
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
  v_account public.ig_accounts%rowtype;
  v_subscription_type text;
  v_expected_clone_mode text;
  v_reason text := 'ready';
  v_follow_day integer;
  v_follow_session integer;
  v_follow_run integer;
  v_unfollow_day integer;
  v_unfollow_session integer;
  v_package_follow_day integer;
  v_package_follow_session integer;
  v_package_unfollow_day integer;
  v_package_unfollow_session integer;
begin
  select * into v_account from public.ig_accounts where id = p_account_id;

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

  if v_entitlement_package is null then
    select acp.package_code into v_legacy_package_code
    from public.account_commercial_packages acp
    where acp.account_id = p_account_id
      and acp.status = 'active'
      and (acp.ends_at is null or acp.ends_at > now())
      and exists (
        select 1
        from public.client_subscription_accounts csa
        join public.client_subscriptions cs on cs.id = csa.subscription_id
        where csa.account_id = p_account_id
          and csa.status = 'active'
          and cs.status = 'active'
      )
    order by acp.starts_at desc, acp.created_at desc
    limit 1;
  end if;

  v_entitlement_source := case
    when v_entitlement_package is not null then 'consumed_entitlement'
    when v_legacy_package_code is not null then 'legacy_active_subscription_package'
    else 'missing'
  end;

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
  v_package_follow_day := coalesce((v_package_caps ->> 'follow_day')::integer, 0);
  v_package_follow_session := coalesce((v_package_caps ->> 'follow_session')::integer, 0);
  v_package_unfollow_day := coalesce((v_package_caps ->> 'unfollow_day')::integer, 0);
  v_package_unfollow_session := coalesce((v_package_caps ->> 'unfollow_session')::integer, 0);

  if v_account.id is null
     or v_account.status in ('archived', 'trashed')
     or v_account.archived_at is not null
     or v_account.trashed_at is not null then
    v_reason := 'account_archived';
  elsif v_package_code is null
     or v_runtime.package_code is null
     or coalesce(v_entitlement_package, v_legacy_package_code) is distinct from v_package_code then
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
     or v_package_follow_day <= 0
     or v_package_follow_session <= 0
     or v_package_unfollow_day <= 0
     or v_package_unfollow_session <= 0
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
  -- Account caps and source rotation values are valid lower overrides. Package
  -- values are ceilings, not mandatory persisted defaults.
  elsif v_settings.max_actions_per_day > v_package_follow_day
     or v_settings.follow_limit > v_package_follow_session
     or v_settings.max_follow_per_run > least(v_package_follow_session, v_settings.follow_limit)
     or v_unfollow.unfollow_per_day_limit > v_package_unfollow_day
     or v_unfollow.unfollow_per_session_limit > v_package_unfollow_session
     or v_sources.max_follows_per_target_per_run > v_runtime.max_follows_per_target_per_run
     or v_sources.max_targets_per_run > v_runtime.max_targets_per_run
     or v_settings.likes_per_follow_min is distinct from v_runtime.likes_per_follow_min
     or v_settings.likes_per_follow_max is distinct from v_runtime.likes_per_follow_max
     or v_settings.total_likes_limit is distinct from v_runtime.likes_per_day_limit then
    v_reason := 'package_settings_incomplete';
  elsif v_assignment.schedule_mode = 'scheduled'
     and (v_assignment.starts_at is null or v_assignment.ends_at is null or v_assignment.ends_at <= v_assignment.starts_at) then
    v_reason := 'package_settings_incomplete';
  end if;

  v_follow_day := least(coalesce(v_settings.max_actions_per_day, 2147483647),
                        nullif(v_package_follow_day, 0),
                        coalesce((v_effective_preview ->> 'follow_day')::integer, 2147483647));
  v_follow_session := least(coalesce(v_settings.follow_limit, 2147483647), nullif(v_package_follow_session, 0));
  v_follow_run := least(coalesce(v_settings.max_follow_per_run, 2147483647), v_follow_session);
  v_unfollow_day := least(coalesce(v_unfollow.unfollow_per_day_limit, 2147483647), nullif(v_package_unfollow_day, 0));
  v_unfollow_session := least(coalesce(v_unfollow.unfollow_per_session_limit, 2147483647), nullif(v_package_unfollow_session, 0));

  return jsonb_build_object(
    'ok', v_reason = 'ready',
    'reason', v_reason,
    'commercial_package_code', v_package_code,
    'entitlement_package_code', coalesce(v_entitlement_package, v_legacy_package_code),
    'consumed_entitlement_package_code', v_entitlement_package,
    'entitlement_source', v_entitlement_source,
    'runtime_profile', v_subscription_type,
    'assignment', jsonb_build_object(
      'assignment_id', v_assignment.id, 'device_id', v_assignment.device_id,
      'app_instance_id', v_assignment.app_instance_id, 'schedule_mode', v_assignment.schedule_mode,
      'slot_kind', v_assignment.slot_kind, 'starts_at', v_assignment.starts_at, 'ends_at', v_assignment.ends_at
    ),
    'android', jsonb_build_object(
      'package_name', v_instance.package_name, 'instance_type', v_instance.instance_type,
      'instance_index', v_instance.instance_index, 'expected_clone_mode', v_expected_clone_mode,
      'configured_package_name', v_settings.app_package, 'configured_clone_mode', v_settings.clone_mode
    ),
    'settings', jsonb_build_object(
      'follow_day', jsonb_build_object('db', v_settings.max_actions_per_day, 'package', v_package_follow_day, 'effective', v_follow_day, 'rule', 'positive_account_override_lte_package'),
      'follow_session', jsonb_build_object('db', v_settings.follow_limit, 'package', v_package_follow_session, 'effective', v_follow_session, 'rule', 'positive_account_override_lte_package'),
      'max_follow_per_run', jsonb_build_object('db', v_settings.max_follow_per_run, 'package', v_package_follow_session, 'effective', v_follow_run, 'rule', 'positive_account_override_lte_effective_session'),
      'max_follows_per_target_per_run', jsonb_build_object('db', v_sources.max_follows_per_target_per_run, 'package', v_runtime.max_follows_per_target_per_run, 'effective', v_sources.max_follows_per_target_per_run, 'rule', 'positive_account_override_lte_package'),
      'max_targets_per_run', jsonb_build_object('db', v_sources.max_targets_per_run, 'package', v_runtime.max_targets_per_run, 'effective', v_sources.max_targets_per_run, 'rule', 'positive_account_override_lte_package'),
      'unfollow_day', jsonb_build_object('db', v_unfollow.unfollow_per_day_limit, 'package', v_package_unfollow_day, 'effective', v_unfollow_day, 'rule', 'positive_account_override_lte_package'),
      'unfollow_session', jsonb_build_object('db', v_unfollow.unfollow_per_session_limit, 'package', v_package_unfollow_session, 'effective', v_unfollow_session, 'rule', 'positive_account_override_lte_package'),
      'likes_per_follow', jsonb_build_object('min', v_settings.likes_per_follow_min, 'max', v_settings.likes_per_follow_max, 'rule', 'package_exact'),
      'likes_day', jsonb_build_object('db', v_settings.total_likes_limit, 'effective', v_settings.total_likes_limit, 'rule', 'package_exact'),
      'welcome', jsonb_build_object('enabled', v_dm.welcome_enabled, 'session', v_dm.welcome_per_session_limit, 'day', v_dm.welcome_per_day_limit, 'rule', 'positive_lower_override_when_enabled'),
      'outreach', jsonb_build_object('enabled', v_dm.outreach_enabled, 'session', v_dm.outreach_per_session_limit, 'day', v_dm.outreach_per_day_limit, 'rule', 'positive_lower_override_when_enabled'),
      'ops_controls', jsonb_build_object('dry_run_enabled', v_settings.dry_run_enabled, 'send_enabled', v_settings.send_enabled, 'source', 'ig_account_settings')
    )
  );
end;
$function$;

revoke all on function public.account_package_runtime_contract_status(uuid)
  from public, anon, authenticated;
grant execute on function public.account_package_runtime_contract_status(uuid)
  to service_role;

-- Keep the previous canonical reconciler as a private implementation detail.
-- The new wrapper preserves only valid lower source overrides after any package
-- materialization, so unrelated reconciliation cannot silently erase them.
alter function public.reconcile_account_package_runtime_contract(uuid, text)
  rename to reconcile_package_runtime_contract_pre_source_override_v1;

revoke all on function public.reconcile_package_runtime_contract_pre_source_override_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_package_runtime_contract_pre_source_override_v1(uuid, text)
  to service_role;

create or replace function public.reconcile_account_package_runtime_contract(
  p_account_id uuid,
  p_source text default 'canonical_reconcile'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_before_follows integer;
  v_before_targets integer;
  v_before_updated_at timestamptz;
  v_before_updated_by text;
  v_before_metadata jsonb;
  v_package_follows integer;
  v_package_targets integer;
  v_restore_follows boolean := false;
  v_restore_targets boolean := false;
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
  v_result jsonb;
  v_contract jsonb;
begin
  if p_account_id is null then
    raise exception 'package_settings_incomplete';
  end if;

  -- Serialize setting saves and package changes for this account before taking
  -- the candidate override snapshot.
  perform 1
  from public.ig_accounts a
  where a.id = p_account_id
  for update;
  if not found then
    raise exception 'package_settings_incomplete';
  end if;

  select
    s.max_follows_per_target_per_run,
    s.max_targets_per_run,
    s.updated_at,
    s.updated_by,
    s.metadata
  into
    v_before_follows,
    v_before_targets,
    v_before_updated_at,
    v_before_updated_by,
    v_before_metadata
  from public.account_follow_source_settings s
  where s.account_id = p_account_id;

  v_result := public.reconcile_package_runtime_contract_pre_source_override_v1(
    p_account_id,
    p_source
  );

  select
    prs.max_follows_per_target_per_run,
    prs.max_targets_per_run
  into v_package_follows, v_package_targets
  from public.account_package_summary aps
  join public.commercial_package_runtime_settings prs
    on prs.package_code = aps.commercial_package_code
  where aps.account_id = p_account_id;

  if coalesce(v_package_follows, 0) <= 0 or coalesce(v_package_targets, 0) <= 0 then
    raise exception 'package_settings_incomplete';
  end if;

  v_restore_follows := v_before_follows between 1 and v_package_follows;
  v_restore_targets := v_before_targets between 1 and v_package_targets;

  perform set_config('bmb.package_contract_reconcile', 'on', true);
  update public.account_follow_source_settings s
  set max_follows_per_target_per_run = case
        when v_restore_follows then v_before_follows
        else s.max_follows_per_target_per_run
      end,
      max_targets_per_run = case
        when v_restore_targets then v_before_targets
        else s.max_targets_per_run
      end,
      updated_at = case
        when v_restore_follows and v_restore_targets
          then coalesce(v_before_updated_at, s.updated_at)
        else s.updated_at
      end,
      updated_by = case
        when v_restore_follows and v_restore_targets then v_before_updated_by
        else s.updated_by
      end,
      metadata = case
        when v_restore_follows or v_restore_targets then
          coalesce(s.metadata, '{}'::jsonb)
          || coalesce(v_before_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'rotation_override_policy', 'positive_account_override_lte_package'
          )
        else s.metadata
      end
  where s.account_id = p_account_id;
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);

  v_contract := public.account_package_runtime_contract_status(p_account_id);
  if not coalesce((v_contract ->> 'ok')::boolean, false) then
    raise exception '%', coalesce(v_contract ->> 'reason', 'package_settings_incomplete');
  end if;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'follow_source_rotation', jsonb_build_object(
      'configured_follows_per_target', v_contract #> '{settings,max_follows_per_target_per_run,db}',
      'package_follows_per_target', v_package_follows,
      'configured_targets_per_run', v_contract #> '{settings,max_targets_per_run,db}',
      'package_targets_per_run', v_package_targets,
      'override_policy', 'positive_account_override_lte_package'
    )
  );
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$function$;

revoke all on function public.reconcile_account_package_runtime_contract(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_account_package_runtime_contract(uuid, text)
  to service_role;

commit;
