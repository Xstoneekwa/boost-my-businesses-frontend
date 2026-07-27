-- Auto Restart bridge for a resolved Instagram action restriction.
--
-- This is deliberately not a business-session resume. It authorizes one
-- zero-action physical preflight while the account remains lifecycle-paused.
-- The Worker may clear the hold only when the restriction popup is absent.

create or replace function public.auto_restart_phase_plan_v2_error(p_plan jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_phase text;
  v_enabled boolean := false;
begin
  if jsonb_typeof(p_plan) <> 'object'
     or p_plan ->> 'schema' <> 'AUTO_RESTART_RESUME_PLAN_V2'
     or coalesce((p_plan ->> 'plan_version')::integer, 0) <> 2 then
    return 'phase_plan_unknown';
  end if;
  if nullif(p_plan ->> 'account_id', '') is null then
    return 'phase_plan_account_missing';
  end if;
  if p_plan -> 'phase_order' <> '["welcome","follow","unfollow"]'::jsonb then
    return 'phase_plan_order_invalid';
  end if;
  if jsonb_typeof(p_plan -> 'phases_to_run') <> 'object'
     or jsonb_typeof(p_plan -> 'quota_remaining') <> 'object' then
    return 'phase_plan_unknown';
  end if;

  if coalesce((p_plan ->> 'restriction_preflight_only')::boolean, false) then
    if p_plan ->> 'resume_kind' <> 'instagram_restriction_preflight'
       or nullif(p_plan ->> 'incident_id', '') is null
       or nullif(p_plan ->> 'authorization_id', '') is null then
      return 'restriction_preflight_contract_invalid';
    end if;
    foreach v_phase in array array['welcome','follow','unfollow'] loop
      if not (p_plan -> 'phases_to_run' ? v_phase)
         or (p_plan -> 'phases_to_run' ->> v_phase)::boolean is not false
         or coalesce((p_plan -> 'quota_remaining' ->> v_phase)::integer, -1) <> 0 then
        return 'restriction_preflight_contract_invalid';
      end if;
    end loop;
    if coalesce((p_plan -> 'quota_remaining' ->> 'outreach')::integer, -1) <> 0
       or coalesce((p_plan -> 'quota_remaining' ->> 'total')::integer, -1) <> 0 then
      return 'restriction_preflight_contract_invalid';
    end if;
    return null;
  end if;

  if coalesce((p_plan ->> 'package_contract_ready')::boolean, false) is not true then
    return 'phase_plan_package_unknown';
  end if;
  foreach v_phase in array array['welcome','follow','unfollow'] loop
    if coalesce((p_plan -> 'phases_to_run' ->> v_phase)::boolean, false) then
      v_enabled := true;
      if nullif(p_plan -> 'quota_remaining' ->> v_phase, '') is null
         or (p_plan -> 'quota_remaining' ->> v_phase)::integer <= 0 then
        return 'phase_plan_quota_invalid';
      end if;
    end if;
  end loop;
  if not v_enabled then
    return 'resume_phase_plan_not_actionable';
  end if;
  return null;
exception when invalid_text_representation or numeric_value_out_of_range then
  return 'phase_plan_invalid_field';
end
$$;

revoke all on function public.auto_restart_phase_plan_v2_error(jsonb)
  from public, anon, authenticated;
grant execute on function public.auto_restart_phase_plan_v2_error(jsonb)
  to service_role;

create or replace function public.consume_resume_authorization_and_create_request_v3(
  p_authorization_id uuid,
  p_worker_id text,
  p_device_id uuid,
  p_metadata_safe jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth public.incident_resume_authorizations%rowtype;
  v_incident public.account_incidents%rowtype;
  v_hold public.instagram_account_restriction_holds%rowtype;
  v_plan jsonb := p_metadata_safe -> 'resume_plan';
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into v_auth
  from public.incident_resume_authorizations
  where id = p_authorization_id
  for update;
  if v_auth.id is null then
    raise exception 'resume_authorization_missing' using errcode = '22023';
  end if;

  if coalesce((v_plan ->> 'restriction_preflight_only')::boolean, false) then
    select * into v_incident
    from public.account_incidents
    where id = v_auth.incident_id and account_id = v_auth.account_id
    for share;
    if v_incident.id is null
       or v_incident.status <> 'resolved'
       or v_incident.incident_type <> 'instagram_account_restriction' then
      raise exception 'restriction_preflight_not_authorized' using errcode = '22023';
    end if;
    if p_metadata_safe ->> 'restriction_preflight_only' <> 'true'
       or v_plan ->> 'incident_id' <> v_auth.incident_id::text
       or v_plan ->> 'authorization_id' <> v_auth.id::text
       or public.auto_restart_phase_plan_v2_error(v_plan) is not null then
      raise exception 'restriction_preflight_contract_invalid' using errcode = '22023';
    end if;

    select * into v_hold
    from public.instagram_account_restriction_holds
    where account_id = v_auth.account_id
      and incident_id = v_auth.incident_id
      and status = 'verification_required'
    for update;
    if v_hold.id is null then
      raise exception 'restriction_preflight_not_authorized' using errcode = '22023';
    end if;
  end if;

  return public.consume_resume_authorization_and_create_request_v2(
    p_authorization_id,
    p_worker_id,
    p_device_id,
    p_metadata_safe
  );
end
$$;

revoke all on function public.consume_resume_authorization_and_create_request_v3(uuid,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.consume_resume_authorization_and_create_request_v3(uuid,text,uuid,jsonb)
  to service_role;

comment on function public.consume_resume_authorization_and_create_request_v3(uuid,text,uuid,jsonb) is
  'Atomically validates a normal human resume or one strict zero-business-action Instagram restriction preflight before request creation.';

create or replace function public.auto_restart_daily_action_counts_v1(
  p_account_ids uuid[],
  p_since timestamptz
)
returns table (
  account_id uuid,
  follow_done bigint,
  unfollow_done bigint,
  welcome_done bigint,
  outreach_done bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.account_id,
    count(*) filter (
      where u.followed_at >= p_since and coalesce(u.was_successful, true)
    ) as follow_done,
    count(*) filter (
      where u.unfollowed_at >= p_since and u.unfollow_result = 'success'
    ) as unfollow_done,
    count(*) filter (
      where u.updated_at >= p_since and coalesce(u.welcome_dm_sent, false)
    ) as welcome_done,
    count(*) filter (
      where u.updated_at >= p_since
        and coalesce(u.dm_sent, false)
        and not coalesce(u.welcome_dm_sent, false)
    ) as outreach_done
  from public.ig_interacted_users u
  where u.account_id = any(coalesce(p_account_ids, '{}'::uuid[]))
    and (
      u.followed_at >= p_since
      or u.unfollowed_at >= p_since
      or u.updated_at >= p_since
    )
  group by u.account_id
$$;

revoke all on function public.auto_restart_daily_action_counts_v1(uuid[],timestamptz)
  from public, anon, authenticated;
grant execute on function public.auto_restart_daily_action_counts_v1(uuid[],timestamptz)
  to service_role;

create or replace function public.auto_restart_latest_session_runs_v1(p_account_ids uuid[])
returns table (
  id uuid,
  account_id uuid,
  status text,
  finished_at timestamptz,
  updated_at timestamptz,
  performance_summary jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (r.account_id)
    r.id, r.account_id, r.status::text, r.finished_at, r.updated_at,
    coalesce(r.performance_summary, '{}'::jsonb)
  from public.ig_runs r
  where r.account_id = any(coalesce(p_account_ids, '{}'::uuid[]))
  order by r.account_id, r.created_at desc, r.id desc
$$;

revoke all on function public.auto_restart_latest_session_runs_v1(uuid[])
  from public, anon, authenticated;
grant execute on function public.auto_restart_latest_session_runs_v1(uuid[])
  to service_role;

create or replace function public.auto_restart_latest_resume_plans_v1(p_account_ids uuid[])
returns table (
  run_id uuid,
  account_id uuid,
  restart_allowed boolean,
  restart_block_reason text,
  resume_state text,
  attempts_in_window integer,
  plan jsonb,
  last_updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (p.account_id)
    p.run_id, p.account_id, p.restart_allowed, p.restart_block_reason,
    p.resume_state, p.attempts_in_window::integer,
    coalesce(p.plan, '{}'::jsonb), p.last_updated_at
  from public.account_session_resume_plans p
  where p.account_id = any(coalesce(p_account_ids, '{}'::uuid[]))
  order by p.account_id, p.last_updated_at desc nulls last, p.created_at desc, p.id desc
$$;

revoke all on function public.auto_restart_latest_resume_plans_v1(uuid[])
  from public, anon, authenticated;
grant execute on function public.auto_restart_latest_resume_plans_v1(uuid[])
  to service_role;
