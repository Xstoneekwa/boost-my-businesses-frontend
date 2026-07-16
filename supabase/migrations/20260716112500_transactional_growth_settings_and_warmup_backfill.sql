create or replace function public.save_account_follow_settings_v1(
  p_account_id uuid,
  p_actor_id uuid,
  p_idempotency_key text,
  p_warmup_enabled boolean,
  p_day_1_follow_cap integer,
  p_day_2_follow_cap integer,
  p_day_3_follow_cap integer,
  p_day_4_plus_follow_cap integer,
  p_admin_day_cap integer,
  p_admin_session_cap integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package_cap integer;
  v_before jsonb;
  v_after jsonb;
  v_started_at timestamptz;
begin
  if coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'idempotency_key_required';
  end if;

  select (package_caps ->> 'follow_day')::integer
    into v_package_cap
    from public.account_package_summary
   where account_id = p_account_id;
  if v_package_cap is null or v_package_cap < 1 then
    raise exception 'package_follow_cap_unavailable';
  end if;
  if p_day_1_follow_cap not between 0 and 10
     or p_day_2_follow_cap not between 0 and 20
     or p_day_3_follow_cap not between 0 and 40
     or p_day_4_plus_follow_cap not between 0 and v_package_cap
     or p_admin_day_cap < 0
     or p_admin_session_cap < 0 then
    raise exception 'invalid_follow_cap';
  end if;

  if exists (
    select 1 from public.ig_action_logs
     where account_id = p_account_id
       and action_type = 'follow_warmup_settings_saved'
       and payload ->> 'idempotency_key' = p_idempotency_key
  ) then
    return jsonb_build_object('changed', false, 'idempotent', true);
  end if;

  select package_started_at into v_started_at
    from public.account_warmup_settings
   where account_id = p_account_id
   for update;
  select jsonb_build_object(
    'warmup', to_jsonb(w),
    'admin_day_cap', s.max_actions_per_day,
    'admin_session_cap', s.follow_limit
  ) into v_before
    from public.ig_account_settings s
    left join public.account_warmup_settings w on w.account_id = s.account_id
   where s.account_id = p_account_id;

  insert into public.account_warmup_settings (
    account_id, warmup_enabled, warmup_profile_code, day_1_follow_cap,
    day_2_follow_cap, day_3_follow_cap, day_4_plus_follow_cap,
    package_started_at, status, updated_at
  ) values (
    p_account_id, p_warmup_enabled, 'follow_default_v1', p_day_1_follow_cap,
    p_day_2_follow_cap, p_day_3_follow_cap, p_day_4_plus_follow_cap,
    v_started_at, case when v_started_at is null then 'pending_package_start' else 'active' end, now()
  ) on conflict (account_id) do update set
    warmup_enabled = excluded.warmup_enabled,
    day_1_follow_cap = excluded.day_1_follow_cap,
    day_2_follow_cap = excluded.day_2_follow_cap,
    day_3_follow_cap = excluded.day_3_follow_cap,
    day_4_plus_follow_cap = excluded.day_4_plus_follow_cap,
    updated_at = now();

  update public.ig_account_settings
     set max_actions_per_day = p_admin_day_cap,
         follow_limit = p_admin_session_cap,
         updated_at = now()
   where account_id = p_account_id;
  if not found then
    raise exception 'account_settings_missing';
  end if;

  select jsonb_build_object(
    'warmup', to_jsonb(w),
    'admin_day_cap', s.max_actions_per_day,
    'admin_session_cap', s.follow_limit
  ) into v_after
    from public.ig_account_settings s
    join public.account_warmup_settings w on w.account_id = s.account_id
   where s.account_id = p_account_id;

  insert into public.ig_action_logs(account_id, action_type, status, message, payload)
  values (p_account_id, 'follow_warmup_settings_saved', 'success',
    'Follow and warmup settings saved transactionally.',
    jsonb_build_object('actor_type','admin','actor_id',p_actor_id,'source_surface','admin_dashboard',
      'domain','follow_warmup','idempotency_key',p_idempotency_key,'before',coalesce(v_before,'{}'::jsonb),'after',v_after));
  return jsonb_build_object('changed', true, 'idempotent', false, 'data', v_after);
end;
$$;

create or replace function public.save_account_unfollow_settings_v1(
  p_account_id uuid,
  p_actor_id uuid,
  p_idempotency_key text,
  p_unfollow_enabled boolean,
  p_unfollow_mode text,
  p_unfollow_per_session_limit integer,
  p_unfollow_per_day_limit integer,
  p_unfollow_after_days integer,
  p_runtime_cap_mode text,
  p_runtime_safety_cap integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if coalesce(trim(p_idempotency_key), '') = '' then raise exception 'idempotency_key_required'; end if;
  if p_unfollow_mode not in ('unfollow','unfollow-any')
     or p_runtime_cap_mode not in ('prod_normal','mini_run','incident_safety')
     or p_unfollow_per_session_limit < 0 or p_unfollow_per_day_limit < 0
     or p_unfollow_after_days < 0
     or (p_runtime_cap_mode <> 'prod_normal' and coalesce(p_runtime_safety_cap, 0) < 1) then
    raise exception 'invalid_unfollow_settings';
  end if;
  if exists (
    select 1 from public.ig_action_logs
     where account_id = p_account_id
       and action_type = 'unfollow_domain_settings_saved'
       and payload ->> 'idempotency_key' = p_idempotency_key
  ) then
    return jsonb_build_object('changed', false, 'idempotent', true);
  end if;

  select to_jsonb(u) into v_before from public.ig_account_unfollow_settings u
   where account_id = p_account_id for update;
  insert into public.ig_account_unfollow_settings (
    account_id, unfollow_enabled, unfollow_mode, unfollow_per_session_limit,
    unfollow_per_day_limit, unfollow_after_days, runtime_cap_mode,
    runtime_safety_cap, updated_at
  ) values (
    p_account_id, p_unfollow_enabled, p_unfollow_mode, p_unfollow_per_session_limit,
    p_unfollow_per_day_limit, p_unfollow_after_days, p_runtime_cap_mode,
    case when p_runtime_cap_mode = 'prod_normal' then null else p_runtime_safety_cap end, now()
  ) on conflict (account_id) do update set
    unfollow_enabled = excluded.unfollow_enabled,
    unfollow_mode = excluded.unfollow_mode,
    unfollow_per_session_limit = excluded.unfollow_per_session_limit,
    unfollow_per_day_limit = excluded.unfollow_per_day_limit,
    unfollow_after_days = excluded.unfollow_after_days,
    runtime_cap_mode = excluded.runtime_cap_mode,
    runtime_safety_cap = excluded.runtime_safety_cap,
    updated_at = now();
  select to_jsonb(u) into v_after from public.ig_account_unfollow_settings u where account_id = p_account_id;
  insert into public.ig_action_logs(account_id, action_type, status, message, payload)
  values (p_account_id, 'unfollow_domain_settings_saved', 'success',
    'Unfollow settings saved transactionally.',
    jsonb_build_object('actor_type','admin','actor_id',p_actor_id,'source_surface','admin_dashboard',
      'domain','unfollow','idempotency_key',p_idempotency_key,'before',coalesce(v_before,'{}'::jsonb),'after',v_after));
  return jsonb_build_object('changed', true, 'idempotent', false, 'data', v_after);
end;
$$;

create or replace function public.backfill_account_warmup_start_v1(
  p_account_id uuid,
  p_package_started_at timestamptz,
  p_actor_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package_cap integer;
  v_existing_start timestamptz;
begin
  select package_started_at into v_existing_start
    from public.account_warmup_settings where account_id = p_account_id for update;
  if v_existing_start is not null then
    return jsonb_build_object('changed', false, 'reason', 'existing_start_preserved', 'package_started_at', v_existing_start);
  end if;
  select (package_caps ->> 'follow_day')::integer into v_package_cap
    from public.account_package_summary where account_id = p_account_id;
  if v_package_cap is null then raise exception 'package_follow_cap_unavailable'; end if;
  insert into public.account_warmup_settings (
    account_id,warmup_enabled,package_started_at,warmup_profile_code,
    day_1_follow_cap,day_2_follow_cap,day_3_follow_cap,day_4_plus_follow_cap,status,updated_at
  ) values (p_account_id,true,p_package_started_at,'follow_default_v1',10,20,40,v_package_cap,'active',now())
  on conflict (account_id) do update set package_started_at=excluded.package_started_at,
    warmup_enabled=true,day_1_follow_cap=10,day_2_follow_cap=20,day_3_follow_cap=40,
    day_4_plus_follow_cap=v_package_cap,status='active',updated_at=now()
  where public.account_warmup_settings.package_started_at is null;
  insert into public.ig_action_logs(account_id,action_type,status,message,payload)
  select p_account_id,'follow_warmup_start_backfilled','success','Warmup start backfilled from verified account history.',
    jsonb_build_object('actor_type','admin','actor_id',p_actor_id,'source_surface','controlled_backfill',
      'idempotency_key',p_idempotency_key,'package_started_at',p_package_started_at,'day_caps',jsonb_build_array(10,20,40,v_package_cap))
  where not exists (select 1 from public.ig_action_logs where account_id=p_account_id
    and action_type='follow_warmup_start_backfilled' and payload->>'idempotency_key'=p_idempotency_key);
  return jsonb_build_object('changed', true, 'package_started_at', p_package_started_at, 'day_4_plus_follow_cap', v_package_cap);
end;
$$;

revoke all on function public.save_account_follow_settings_v1(uuid,uuid,text,boolean,integer,integer,integer,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.save_account_unfollow_settings_v1(uuid,uuid,text,boolean,text,integer,integer,integer,text,integer) from public, anon, authenticated;
revoke all on function public.backfill_account_warmup_start_v1(uuid,timestamptz,uuid,text) from public, anon, authenticated;
grant execute on function public.save_account_follow_settings_v1(uuid,uuid,text,boolean,integer,integer,integer,integer,integer,integer) to service_role;
grant execute on function public.save_account_unfollow_settings_v1(uuid,uuid,text,boolean,text,integer,integer,integer,text,integer) to service_role;
grant execute on function public.backfill_account_warmup_start_v1(uuid,timestamptz,uuid,text) to service_role;
