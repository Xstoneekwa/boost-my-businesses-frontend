-- Existing assignment package/runtime reconciliation and bounded natural retry.
--
-- This is a forward-only correction to 20260726015750. Package maxima remain
-- authoritative, while positive account caps below those maxima remain valid
-- explicit overrides. A schedule request blocked before run creation may be
-- retried once, inside the same open business window, by the natural cron only.

create table if not exists public.account_package_runtime_contract_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid null references public.ig_accounts(id) on delete set null,
  assignment_id uuid null references public.account_assignments(id) on delete set null,
  request_id uuid null references public.account_run_requests(id) on delete set null,
  event_type text not null check (event_type in (
    'package_runtime_contract_blocked',
    'package_runtime_contract_reconciled',
    'retryable_pre_run_block',
    'scheduled_retry_created',
    'scheduled_retry_not_needed',
    'scheduled_retry_window_closed',
    'scheduled_retry_limit_reached'
  )),
  source text not null,
  idempotency_key text null check (idempotency_key is null or char_length(idempotency_key) between 1 and 240),
  details_safe jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details_safe) = 'object' and pg_column_size(details_safe) <= 8192),
  created_at timestamptz not null default now()
);

create unique index if not exists account_package_runtime_contract_events_idempotency_uidx
  on public.account_package_runtime_contract_events (idempotency_key)
  where idempotency_key is not null;

create index if not exists account_package_runtime_contract_events_account_created_idx
  on public.account_package_runtime_contract_events (account_id, created_at desc);

alter table public.account_package_runtime_contract_events enable row level security;
revoke all on table public.account_package_runtime_contract_events from public, anon, authenticated;
grant select, insert on table public.account_package_runtime_contract_events to service_role;

-- Preserve the original exact-default materializer as an internal primitive.
-- The public RPC below becomes the override-preserving, idempotent contract.
do $block$
begin
  if to_regprocedure('public.reconcile_account_package_runtime_contract_exact_v1(uuid,text)') is null then
    alter function public.reconcile_account_package_runtime_contract(uuid, text)
      rename to reconcile_account_package_runtime_contract_exact_v1;
  end if;
end;
$block$;

revoke all on function public.reconcile_account_package_runtime_contract_exact_v1(uuid, text)
  from public, anon, authenticated;

-- Legacy accounts created before commercial checkout entitlements may still
-- have both an active client subscription and an active account package. Do
-- not invent a checkout entitlement for those accounts. Reconcile only the
-- assignment/app binding, then let the canonical status function validate all
-- package-owned fields and account overrides fail-closed.
create or replace function public.reconcile_legacy_account_assignment_binding_v1(
  p_account_id uuid,
  p_source text default 'canonical_reconcile'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_account_package public.account_commercial_packages%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_instance public.phone_app_instances%rowtype;
  v_subscription_type text;
  v_expected_clone_mode text;
begin
  select acp.* into v_account_package
  from public.account_commercial_packages acp
  where acp.account_id = p_account_id
    and acp.status = 'active'
    and (acp.ends_at is null or acp.ends_at > now())
  order by acp.starts_at desc, acp.created_at desc
  limit 1
  for update;

  if v_account_package.id is null
     or exists (
       select 1
       from public.client_account_entitlements cae
       where cae.account_id = p_account_id
         and cae.status = 'entitlement_consumed'
     ) then
    raise exception 'legacy_package_contract_not_applicable';
  end if;

  select cs.subscription_type into v_subscription_type
  from public.client_subscription_accounts csa
  join public.client_subscriptions cs on cs.id = csa.subscription_id
  where csa.account_id = p_account_id
    and csa.status = 'active'
    and cs.status = 'active'
  order by cs.starts_at desc, cs.created_at desc
  limit 1;

  select aa.* into v_assignment
  from public.account_assignments aa
  where aa.account_id = p_account_id
    and aa.status in ('pending', 'reserved', 'active')
  order by aa.updated_at desc, aa.created_at desc
  limit 1
  for update;

  if v_subscription_type is null
     or v_assignment.id is null
     or v_assignment.device_id is null
     or v_assignment.app_instance_id is null
     or v_assignment.assignment_type is distinct from v_subscription_type then
    raise exception 'runtime_profile_mismatch';
  end if;

  select pai.* into v_instance
  from public.phone_app_instances pai
  where pai.id = v_assignment.app_instance_id
  for update;

  if v_instance.id is null
     or v_instance.device_id is distinct from v_assignment.device_id
     or nullif(trim(v_instance.package_name), '') is null
     or not coalesce(v_instance.is_launchable, false)
     or not coalesce(v_instance.usable_for_auto_login, false) then
    raise exception 'app_instance_package_mismatch';
  end if;

  v_expected_clone_mode := case
    when v_instance.instance_type = 'primary_app' or coalesce(v_instance.instance_index, 0) = 0 then 'off'
    else 'clone_' || v_instance.instance_index::text
  end;

  update public.ig_accounts
  set clone_mode = v_expected_clone_mode,
      device_name = (
        select coalesce(pd.name, pd.device_name)
        from public.phone_devices pd
        where pd.id = v_assignment.device_id
      ),
      updated_at = now()
  where id = p_account_id;

  update public.ig_account_settings
  set app_package = v_instance.package_name,
      clone_mode = v_expected_clone_mode,
      cloned_app_mode = v_expected_clone_mode <> 'off',
      updated_at = now()
  where account_id = p_account_id;

  if not found then
    raise exception 'package_settings_incomplete';
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', 'legacy_assignment_package_binding_reconciled',
    'account_id', p_account_id,
    'commercial_package_code', v_account_package.package_code,
    'runtime_profile', v_subscription_type,
    'assignment_id', v_assignment.id,
    'app_instance_id', v_instance.id,
    'clone_mode', v_expected_clone_mode,
    'android_package_name', v_instance.package_name,
    'source', coalesce(nullif(trim(p_source), ''), 'canonical_reconcile')
  );
end;
$function$;

revoke all on function public.reconcile_legacy_account_assignment_binding_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_legacy_account_assignment_binding_v1(uuid, text)
  to service_role;

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
  -- Account Follow and Unfollow caps are valid lower overrides. Package values
  -- are ceilings, not mandatory persisted defaults.
  elsif v_settings.max_actions_per_day > v_package_follow_day
     or v_settings.follow_limit > v_package_follow_session
     or v_settings.max_follow_per_run > least(v_package_follow_session, v_settings.follow_limit)
     or v_unfollow.unfollow_per_day_limit > v_package_unfollow_day
     or v_unfollow.unfollow_per_session_limit > v_package_unfollow_session
     -- Source rotation and Like ratios are package-owned exact fields.
     or v_sources.max_follows_per_target_per_run is distinct from v_runtime.max_follows_per_target_per_run
     or v_sources.max_targets_per_run is distinct from v_runtime.max_targets_per_run
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
      'max_follows_per_target_per_run', jsonb_build_object('db', v_sources.max_follows_per_target_per_run, 'package', v_runtime.max_follows_per_target_per_run, 'effective', v_sources.max_follows_per_target_per_run, 'rule', 'package_exact'),
      'max_targets_per_run', jsonb_build_object('db', v_sources.max_targets_per_run, 'package', v_runtime.max_targets_per_run, 'effective', v_sources.max_targets_per_run, 'rule', 'package_exact'),
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

revoke all on function public.account_package_runtime_contract_status(uuid) from public, anon, authenticated;
grant execute on function public.account_package_runtime_contract_status(uuid) to service_role;

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
  v_source text := coalesce(nullif(trim(p_source), ''), 'canonical_reconcile');
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
  v_before_status jsonb;
  v_after_status jsonb;
  v_account public.ig_accounts%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_package_caps jsonb;
  v_package_follow_day integer;
  v_package_follow_session integer;
  v_package_unfollow_day integer;
  v_package_unfollow_session integer;
  v_follow_day integer;
  v_follow_session integer;
  v_follow_run integer;
  v_unfollow_day integer;
  v_unfollow_session integer;
  v_welcome_day integer;
  v_welcome_session integer;
  v_outreach_day integer;
  v_outreach_session integer;
  v_total_dm_day integer;
  v_result jsonb;
  v_changed_fields jsonb := '{}'::jsonb;
begin
  if p_account_id is null then
    raise exception 'package_settings_incomplete';
  end if;

  select * into v_account from public.ig_accounts where id = p_account_id for update;
  if v_account.id is null then
    raise exception 'package_settings_incomplete';
  end if;
  if v_account.status in ('archived', 'trashed')
     or v_account.archived_at is not null
     or v_account.trashed_at is not null then
    return jsonb_build_object('ok', true, 'reason', 'account_archived_skipped', 'account_id', p_account_id, 'source', v_source, 'changed', false);
  end if;

  v_before_status := public.account_package_runtime_contract_status(p_account_id);
  if coalesce((v_before_status ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', true, 'reason', 'package_runtime_contract_already_compliant', 'account_id', p_account_id, 'source', v_source, 'changed', false, 'contract', v_before_status);
  end if;

  select aa.* into v_assignment
  from public.account_assignments aa
  where aa.account_id = p_account_id and aa.status in ('pending', 'reserved', 'active')
  order by aa.updated_at desc, aa.created_at desc limit 1 for update;

  select aps.package_caps into v_package_caps
  from public.account_package_summary aps where aps.account_id = p_account_id;
  v_package_follow_day := coalesce((v_package_caps ->> 'follow_day')::integer, 0);
  v_package_follow_session := coalesce((v_package_caps ->> 'follow_session')::integer, 0);
  v_package_unfollow_day := coalesce((v_package_caps ->> 'unfollow_day')::integer, 0);
  v_package_unfollow_session := coalesce((v_package_caps ->> 'unfollow_session')::integer, 0);
  if least(v_package_follow_day, v_package_follow_session, v_package_unfollow_day, v_package_unfollow_session) <= 0 then
    raise exception 'package_settings_incomplete';
  end if;

  select s.max_actions_per_day, s.follow_limit, s.max_follow_per_run
  into v_follow_day, v_follow_session, v_follow_run
  from public.ig_account_settings s
  where s.account_id = p_account_id
  order by s.updated_at desc nulls last, s.created_at desc nulls last limit 1;

  select u.unfollow_per_day_limit, u.unfollow_per_session_limit
  into v_unfollow_day, v_unfollow_session
  from public.ig_account_unfollow_settings u where u.account_id = p_account_id;

  select d.welcome_per_day_limit, d.welcome_per_session_limit,
         d.outreach_per_day_limit, d.outreach_per_session_limit,
         d.total_dm_per_day_limit
  into v_welcome_day, v_welcome_session, v_outreach_day, v_outreach_session,
       v_total_dm_day
  from public.ig_account_dm_settings d where d.account_id = p_account_id;

  -- A missing legacy settings row can be initialized safely from schema
  -- defaults; the exact materializer below fills every contract field.
  if not exists (select 1 from public.ig_account_settings where account_id = p_account_id) then
    insert into public.ig_account_settings (account_id) values (p_account_id);
    v_changed_fields := v_changed_fields || jsonb_build_object('ig_account_settings', 'LEGACY_DEFAULT_MISSING');
  end if;

  perform set_config('bmb.package_contract_reconcile', 'on', true);
  if v_before_status ->> 'entitlement_source' = 'legacy_active_subscription_package' then
    v_result := public.reconcile_legacy_account_assignment_binding_v1(p_account_id, v_source);
  else
    v_result := public.reconcile_account_package_runtime_contract_exact_v1(p_account_id, v_source);
  end if;

  -- Restore only explicit positive lower account overrides. Above-package,
  -- zero and null values stay corrected to the package materializer value.
  update public.ig_account_settings s
  set max_actions_per_day = case when v_follow_day between 1 and v_package_follow_day then v_follow_day else s.max_actions_per_day end,
      follow_limit = case when v_follow_session between 1 and v_package_follow_session then v_follow_session else s.follow_limit end,
      max_follow_per_run = case
        when v_follow_run between 1 and least(v_package_follow_session,
             case when v_follow_session between 1 and v_package_follow_session then v_follow_session else s.follow_limit end)
          then v_follow_run
        else least(s.max_follow_per_run, s.follow_limit)
      end,
      updated_at = case
        when (s.max_actions_per_day, s.follow_limit, s.max_follow_per_run) is distinct from (
          case when v_follow_day between 1 and v_package_follow_day then v_follow_day else s.max_actions_per_day end,
          case when v_follow_session between 1 and v_package_follow_session then v_follow_session else s.follow_limit end,
          case
            when v_follow_run between 1 and least(v_package_follow_session,
                 case when v_follow_session between 1 and v_package_follow_session then v_follow_session else s.follow_limit end)
              then v_follow_run
            else least(s.max_follow_per_run, s.follow_limit)
          end
        ) then now() else s.updated_at end
  where s.account_id = p_account_id;

  update public.ig_account_unfollow_settings u
  set unfollow_per_day_limit = case when v_unfollow_day between 1 and v_package_unfollow_day then v_unfollow_day else u.unfollow_per_day_limit end,
      unfollow_per_session_limit = case when v_unfollow_session between 1 and v_package_unfollow_session then v_unfollow_session else u.unfollow_per_session_limit end,
      updated_at = case
        when (u.unfollow_per_day_limit, u.unfollow_per_session_limit) is distinct from (
          case when v_unfollow_day between 1 and v_package_unfollow_day then v_unfollow_day else u.unfollow_per_day_limit end,
          case when v_unfollow_session between 1 and v_package_unfollow_session then v_unfollow_session else u.unfollow_per_session_limit end
        ) then now() else u.updated_at end
  where u.account_id = p_account_id;

  -- DM values are inherited at provisioning, but explicit positive lower caps
  -- remain safe. Disabled domains remain zeroed by the exact materializer.
  update public.ig_account_dm_settings d
  set welcome_per_day_limit = case when d.welcome_enabled and v_welcome_day between 1 and d.welcome_per_day_limit then v_welcome_day else d.welcome_per_day_limit end,
      welcome_per_session_limit = case when d.welcome_enabled and v_welcome_session between 1 and least(d.welcome_per_session_limit, d.welcome_per_day_limit) then v_welcome_session else d.welcome_per_session_limit end,
      outreach_per_day_limit = case when d.outreach_enabled and v_outreach_day between 1 and d.outreach_per_day_limit then v_outreach_day else d.outreach_per_day_limit end,
      outreach_per_session_limit = case when d.outreach_enabled and v_outreach_session between 1 and least(d.outreach_per_session_limit, d.outreach_per_day_limit) then v_outreach_session else d.outreach_per_session_limit end,
      updated_at = now()
  where d.account_id = p_account_id;

  -- Compute the combined ceiling from the restored domain caps, then preserve a
  -- positive lower combined override when one existed before reconciliation.
  update public.ig_account_dm_settings d
  set total_dm_per_day_limit = case
        when v_total_dm_day between 1 and
          ((case when d.welcome_enabled then d.welcome_per_day_limit else 0 end) +
           (case when d.outreach_enabled then d.outreach_per_day_limit else 0 end))
          then v_total_dm_day
        else
          (case when d.welcome_enabled then d.welcome_per_day_limit else 0 end) +
          (case when d.outreach_enabled then d.outreach_per_day_limit else 0 end)
      end,
      updated_at = case
        when d.total_dm_per_day_limit is distinct from case
          when v_total_dm_day between 1 and
            ((case when d.welcome_enabled then d.welcome_per_day_limit else 0 end) +
             (case when d.outreach_enabled then d.outreach_per_day_limit else 0 end))
            then v_total_dm_day
          else
            (case when d.welcome_enabled then d.welcome_per_day_limit else 0 end) +
            (case when d.outreach_enabled then d.outreach_per_day_limit else 0 end)
        end then now() else d.updated_at end
  where d.account_id = p_account_id;

  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  v_after_status := public.account_package_runtime_contract_status(p_account_id);
  if not coalesce((v_after_status ->> 'ok')::boolean, false) then
    raise exception '%', coalesce(v_after_status ->> 'reason', 'package_settings_incomplete');
  end if;

  insert into public.account_package_runtime_contract_events (
    account_id, assignment_id, event_type, source, idempotency_key, details_safe
  ) values (
    p_account_id, v_assignment.id, 'package_runtime_contract_reconciled', v_source,
    left('contract-reconcile:' || p_account_id::text || ':' || coalesce(v_assignment.id::text, 'none') || ':' || v_source, 205)
      || ':' || md5(v_after_status::text),
    jsonb_build_object(
      'before_reason', v_before_status ->> 'reason',
      'after_reason', v_after_status ->> 'reason',
      'commercial_package_code', v_after_status ->> 'commercial_package_code',
      'override_policy', 'positive_account_override_lte_package',
      'missing_fields', v_changed_fields
    )
  ) on conflict (idempotency_key) where idempotency_key is not null do nothing;

  return jsonb_build_object(
    'ok', true, 'reason', 'package_runtime_contract_reconciled',
    'account_id', p_account_id, 'source', v_source, 'changed', true,
    'contract', v_after_status, 'materializer', v_result
  );
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$function$;

revoke all on function public.reconcile_account_package_runtime_contract(uuid, text) from public, anon, authenticated;
grant execute on function public.reconcile_account_package_runtime_contract(uuid, text) to service_role;

create or replace function public.enforce_assignment_package_runtime_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if coalesce(current_setting('bmb.package_contract_reconcile', true), '') = 'on' then
    return new;
  end if;
  if new.status in ('pending', 'reserved', 'active') then
    begin
      perform public.reconcile_account_package_runtime_contract(new.account_id, 'assignment_trigger');
    exception when others then
      insert into public.account_package_runtime_contract_events (
        account_id, assignment_id, event_type, source, details_safe
      ) values (
        new.account_id, new.id, 'package_runtime_contract_blocked', 'assignment_trigger',
        jsonb_build_object('reason', case when sqlerrm in ('package_settings_incomplete','assignment_package_mismatch','app_instance_package_mismatch','clone_package_mismatch','runtime_profile_mismatch') then sqlerrm else 'contract_reconcile_failed' end)
      );
    end;
  end if;
  return new;
end;
$function$;

drop trigger if exists account_assignment_package_runtime_contract on public.account_assignments;
create trigger account_assignment_package_runtime_contract
after insert or update of device_id, app_instance_id, assignment_type, schedule_mode, starts_at, ends_at, status
on public.account_assignments
for each row execute function public.enforce_assignment_package_runtime_contract();

create or replace function public.reconcile_account_package_runtime_contract_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_account_id uuid;
begin
  if coalesce(current_setting('bmb.package_contract_reconcile', true), '') = 'on' then
    return new;
  end if;
  v_account_id := case
    when tg_table_name = 'client_account_entitlements' then coalesce(new.account_id, old.account_id)
    else new.account_id
  end;
  if v_account_id is null then return new; end if;
  begin
    perform public.reconcile_account_package_runtime_contract(v_account_id, tg_table_name || '_trigger');
  exception when others then
    insert into public.account_package_runtime_contract_events (
      account_id, event_type, source, details_safe
    ) values (
      v_account_id, 'package_runtime_contract_blocked', tg_table_name || '_trigger',
      jsonb_build_object('reason', case when sqlerrm in ('package_settings_incomplete','assignment_package_mismatch','app_instance_package_mismatch','clone_package_mismatch','runtime_profile_mismatch') then sqlerrm else 'contract_reconcile_failed' end)
    );
  end;
  return new;
end;
$function$;

drop trigger if exists account_commercial_package_runtime_contract on public.account_commercial_packages;
create trigger account_commercial_package_runtime_contract
after insert or update of package_code, status, starts_at, ends_at
on public.account_commercial_packages
for each row execute function public.reconcile_account_package_runtime_contract_change();

drop trigger if exists client_entitlement_package_runtime_contract on public.client_account_entitlements;
create trigger client_entitlement_package_runtime_contract
after insert or update of account_id, commercial_package_code, status, outreach_addon_key, outreach_variant, backend_addon_code
on public.client_account_entitlements
for each row execute function public.reconcile_account_package_runtime_contract_change();

drop trigger if exists ig_settings_package_runtime_contract on public.ig_account_settings;
create trigger ig_settings_package_runtime_contract
after insert or update of app_package, clone_mode, cloned_app_mode, max_actions_per_day,
  follow_limit, max_follow_per_run, likes_per_follow_min, likes_per_follow_max, total_likes_limit
on public.ig_account_settings
for each row execute function public.reconcile_account_package_runtime_contract_change();

drop trigger if exists follow_sources_package_runtime_contract on public.account_follow_source_settings;
create trigger follow_sources_package_runtime_contract
after insert or update of max_follows_per_target_per_run, max_targets_per_run
on public.account_follow_source_settings
for each row execute function public.reconcile_account_package_runtime_contract_change();

drop trigger if exists unfollow_settings_package_runtime_contract on public.ig_account_unfollow_settings;
create trigger unfollow_settings_package_runtime_contract
after insert or update of unfollow_enabled, unfollow_after_days, unfollow_per_session_limit, unfollow_per_day_limit
on public.ig_account_unfollow_settings
for each row execute function public.reconcile_account_package_runtime_contract_change();

drop trigger if exists dm_settings_package_runtime_contract on public.ig_account_dm_settings;
create trigger dm_settings_package_runtime_contract
after insert or update of welcome_enabled, outreach_enabled, welcome_per_session_limit,
  welcome_per_day_limit, outreach_per_session_limit, outreach_per_day_limit, total_dm_per_day_limit
on public.ig_account_dm_settings
for each row execute function public.reconcile_account_package_runtime_contract_change();

revoke all on function public.enforce_assignment_package_runtime_contract() from public, anon, authenticated;
revoke all on function public.reconcile_account_package_runtime_contract_change() from public, anon, authenticated;

create or replace function public.create_schedule_session_pre_run_retry_v1(
  p_account_id uuid,
  p_assignment_id uuid,
  p_window_starts_at timestamptz,
  p_window_ends_at timestamptz,
  p_base_idempotency_key text,
  p_worker_id text,
  p_device_timezone text default null,
  p_retry_limit integer default 1,
  p_min_remaining_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_assignment public.account_assignments%rowtype;
  v_base public.account_run_requests%rowtype;
  v_retry public.account_run_requests%rowtype;
  v_contract jsonb;
  v_retry_count integer := 0;
  v_retry_ordinal integer;
  v_retry_limit integer := least(greatest(coalesce(p_retry_limit, 1), 1), 3);
  v_min_remaining integer := least(greatest(coalesce(p_min_remaining_seconds, 600), 60), 3600);
  v_retry_key text;
  v_decision_key text;
begin
  if p_account_id is null or p_assignment_id is null
     or p_window_starts_at is null or p_window_ends_at is null
     or nullif(trim(p_base_idempotency_key), '') is null then
    return jsonb_build_object('created', false, 'reason', 'scheduled_retry_not_needed');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'schedule-session-retry-v1:' || p_assignment_id::text || ':' || p_window_starts_at::text, 0
  ));

  select * into v_assignment
  from public.account_assignments
  where id = p_assignment_id and account_id = p_account_id
    and status in ('reserved', 'active') and schedule_mode = 'scheduled'
    and assignment_type = 'full_cycle'
  for share;

  if v_assignment.id is null
     or v_assignment.starts_at is distinct from p_window_starts_at
     or v_assignment.ends_at is distinct from p_window_ends_at then
    return jsonb_build_object('created', false, 'reason', 'scheduled_retry_not_needed');
  end if;

  if v_now < p_window_starts_at
     or v_now >= p_window_ends_at
     or extract(epoch from (p_window_ends_at - v_now)) < v_min_remaining then
    v_decision_key := left(trim(p_base_idempotency_key) || ':decision:window-closed', 240);
    insert into public.account_package_runtime_contract_events (
      account_id, assignment_id, event_type, source, idempotency_key, details_safe
    ) values (
      p_account_id, p_assignment_id, 'scheduled_retry_window_closed', 'schedule_session_cron', v_decision_key,
      jsonb_build_object('window_starts_at', p_window_starts_at, 'window_ends_at', p_window_ends_at, 'minimum_remaining_seconds', v_min_remaining)
    ) on conflict (idempotency_key) where idempotency_key is not null do nothing;
    return jsonb_build_object('created', false, 'reason', 'scheduled_retry_window_closed');
  end if;

  select * into v_base
  from public.account_run_requests
  where account_id = p_account_id
    and idempotency_key = trim(p_base_idempotency_key)
    and source_surface = 'instagram_schedule_session_cron'
    and requested_run_type = 'account_session'
  for share;

  if v_base.id is null
     or v_base.status <> 'blocked'
     or v_base.error_code not in ('package_settings_incomplete', 'runtime_contract_not_ready')
     or v_base.run_id is not null then
    return jsonb_build_object('created', false, 'reason', 'scheduled_retry_not_needed');
  end if;

  insert into public.account_package_runtime_contract_events (
    account_id, assignment_id, request_id, event_type, source, idempotency_key, details_safe
  ) values (
    p_account_id, p_assignment_id, v_base.id, 'retryable_pre_run_block', 'schedule_session_cron',
    left(trim(p_base_idempotency_key) || ':decision:retryable', 240),
    jsonb_build_object('blocked_reason', v_base.error_code, 'run_created', false)
  ) on conflict (idempotency_key) where idempotency_key is not null do nothing;

  v_contract := public.account_package_runtime_contract_status(p_account_id);
  if not coalesce((v_contract ->> 'ok')::boolean, false) then
    return jsonb_build_object('created', false, 'reason', 'package_runtime_contract_blocked', 'contract_reason', v_contract ->> 'reason');
  end if;

  select count(*)::integer into v_retry_count
  from public.account_run_requests r
  where r.account_id = p_account_id
    and r.source_surface = 'instagram_schedule_session_cron'
    and r.metadata_safe ->> 'retry_of_request_id' = v_base.id::text;

  if v_retry_count >= v_retry_limit then
    insert into public.account_package_runtime_contract_events (
      account_id, assignment_id, request_id, event_type, source, idempotency_key, details_safe
    ) values (
      p_account_id, p_assignment_id, v_base.id, 'scheduled_retry_limit_reached', 'schedule_session_cron',
      left(trim(p_base_idempotency_key) || ':decision:limit:' || v_retry_limit::text, 240),
      jsonb_build_object('retry_count', v_retry_count, 'retry_limit', v_retry_limit)
    ) on conflict (idempotency_key) where idempotency_key is not null do nothing;
    return jsonb_build_object('created', false, 'reason', 'scheduled_retry_limit_reached', 'retry_count', v_retry_count, 'retry_limit', v_retry_limit);
  end if;

  if public.account_has_active_ig_run(p_account_id)
     or exists (select 1 from public.account_run_requests r where r.account_id = p_account_id and r.status in ('queued','claimed','starting','running'))
     or exists (select 1 from public.auto_restart_device_locks l where l.device_id = v_assignment.device_id and l.lease_expires_at > v_now)
     or exists (select 1 from public.ig_account_settings s where s.account_id = p_account_id and coalesce(s.manual_stop_requested, false)) then
    return jsonb_build_object('created', false, 'reason', 'scheduled_retry_not_needed');
  end if;

  v_retry_ordinal := v_retry_count + 1;
  v_retry_key := left(trim(p_base_idempotency_key) || ':retry:v1:' || v_retry_ordinal::text, 240);

  v_retry := public.create_account_run_request(
    p_account_id => p_account_id,
    p_requested_by => null,
    p_actor_type => 'system',
    p_source_surface => 'instagram_schedule_session_cron',
    p_requested_run_type => 'account_session',
    p_idempotency_key => v_retry_key,
    p_priority => 0,
    p_metadata_safe => jsonb_build_object(
      'source', 'schedule_session_cron', 'trigger', 'scheduler',
      'assignment_id', p_assignment_id, 'worker_id', coalesce(nullif(trim(p_worker_id), ''), 'schedule_session_cron'),
      'scheduled_session_at', p_window_starts_at, 'scheduled_session_ends_at', p_window_ends_at,
      'device_timezone', p_device_timezone,
      'retry_of_request_id', v_base.id, 'retry_reason', v_base.error_code,
      'schedule_retry_version', 1, 'schedule_retry_ordinal', v_retry_ordinal,
      'package_runtime_contract_status', 'ready'
    )
  );

  insert into public.account_package_runtime_contract_events (
    account_id, assignment_id, request_id, event_type, source, idempotency_key, details_safe
  ) values (
    p_account_id, p_assignment_id, v_retry.id, 'scheduled_retry_created', 'schedule_session_cron',
    left(v_retry_key || ':decision:created', 240),
    jsonb_build_object('retry_of_request_id', v_base.id, 'retry_request_id', v_retry.id, 'retry_ordinal', v_retry_ordinal, 'retry_reason', v_base.error_code)
  ) on conflict (idempotency_key) where idempotency_key is not null do nothing;

  return jsonb_build_object(
    'created', true, 'reason', 'scheduled_retry_created',
    'request_id', v_retry.id, 'status', v_retry.status,
    'idempotency_key', v_retry.idempotency_key,
    'retry_of_request_id', v_base.id, 'retry_ordinal', v_retry_ordinal, 'retry_limit', v_retry_limit
  );
end;
$function$;

revoke all on function public.create_schedule_session_pre_run_retry_v1(uuid,uuid,timestamptz,timestamptz,text,text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.create_schedule_session_pre_run_retry_v1(uuid,uuid,timestamptz,timestamptz,text,text,text,integer,integer)
  to service_role;

-- One-time generic backfill. Archived/trashed accounts are intentionally left
-- untouched. Per-account failures are recorded and do not abort other accounts.
do $backfill$
declare
  v_row record;
begin
  for v_row in
    select distinct aa.account_id
    from public.account_assignments aa
    join public.ig_accounts a on a.id = aa.account_id
    where aa.status in ('pending', 'reserved', 'active')
      and coalesce(a.status, 'active') not in ('archived', 'trashed')
      and a.archived_at is null and a.trashed_at is null
    order by aa.account_id
  loop
    begin
      perform public.reconcile_account_package_runtime_contract(v_row.account_id, 'migration_backfill_v1');
    exception when others then
      insert into public.account_package_runtime_contract_events (
        account_id, event_type, source, idempotency_key, details_safe
      ) values (
        v_row.account_id, 'package_runtime_contract_blocked', 'migration_backfill_v1',
        left('contract-backfill-blocked:' || v_row.account_id::text, 240),
        jsonb_build_object('reason', case when sqlerrm in ('package_settings_incomplete','assignment_package_mismatch','app_instance_package_mismatch','clone_package_mismatch','runtime_profile_mismatch') then sqlerrm else 'contract_reconcile_failed' end)
      ) on conflict (idempotency_key) where idempotency_key is not null do nothing;
    end;
  end loop;
end;
$backfill$;
