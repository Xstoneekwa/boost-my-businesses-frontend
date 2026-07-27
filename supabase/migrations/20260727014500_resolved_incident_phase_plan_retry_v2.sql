-- Generic resolved-incident resume contract V2.
--
-- Guarantees:
--   * an auto-restart account session cannot be inserted without one explicit,
--     actionable V2 phase plan;
--   * a human resume authorization is consumed in the same transaction as
--     request creation and all canonical linkage writes;
--   * phase_plan_unknown before any business action restores one retry credit
--     in the next active assignment window, idempotently and without a new
--     human click.

alter table public.incident_resume_authorizations
  add column if not exists retry_generation integer not null default 0,
  add column if not exists retry_credit_restored_at timestamptz,
  add column if not exists retry_credit_restore_reason text,
  add column if not exists frozen_phase_plan jsonb;

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
  if coalesce((p_plan ->> 'package_contract_ready')::boolean, false) is not true then
    return 'phase_plan_package_unknown';
  end if;
  if p_plan -> 'phase_order' <> '["welcome","follow","unfollow"]'::jsonb then
    return 'phase_plan_order_invalid';
  end if;
  if jsonb_typeof(p_plan -> 'phases_to_run') <> 'object'
     or jsonb_typeof(p_plan -> 'quota_remaining') <> 'object' then
    return 'phase_plan_unknown';
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

revoke all on function public.auto_restart_phase_plan_v2_error(jsonb) from public, anon, authenticated;
grant execute on function public.auto_restart_phase_plan_v2_error(jsonb) to service_role;

create or replace function public.enforce_auto_restart_phase_plan_v2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_error text;
begin
  if new.source_surface = 'auto_restart_tick'
     and new.requested_run_type = 'account_session' then
    v_error := public.auto_restart_phase_plan_v2_error(new.metadata_safe -> 'resume_plan');
    if v_error is not null then
      raise exception '%', v_error using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_auto_restart_phase_plan_v2() from public, anon, authenticated;
grant execute on function public.enforce_auto_restart_phase_plan_v2() to service_role;

drop trigger if exists account_run_requests_auto_restart_phase_plan_v2
  on public.account_run_requests;
create trigger account_run_requests_auto_restart_phase_plan_v2
before insert on public.account_run_requests
for each row execute function public.enforce_auto_restart_phase_plan_v2();

create or replace function public.consume_resume_authorization_and_create_request_v2(
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
  v_plan public.account_session_resume_plans%rowtype;
  v_request public.account_run_requests%rowtype;
  v_plan_error text;
begin
  select * into v_auth
  from public.incident_resume_authorizations
  where id = p_authorization_id
  for update;

  if v_auth.id is null then
    raise exception 'resume_authorization_missing' using errcode = '22023';
  end if;
  if v_auth.status = 'consumed' and v_auth.consumed_by_request_id is not null then
    return jsonb_build_object(
      'request_id', v_auth.consumed_by_request_id,
      'authorization_id', v_auth.id,
      'idempotent', true
    );
  end if;
  if v_auth.status <> 'armed' then
    raise exception 'resume_authorization_consumed' using errcode = '40001';
  end if;
  if v_auth.test then
    raise exception 'test_authorization_excluded' using errcode = '22023';
  end if;
  if v_auth.scheduled_window_start is null or v_auth.scheduled_window_end is null
     or not (v_auth.scheduled_window_start <= now() and now() < v_auth.scheduled_window_end) then
    raise exception 'resume_authorization_expired' using errcode = '22023';
  end if;

  select * into v_incident from public.account_incidents
  where id = v_auth.incident_id and account_id = v_auth.account_id
  for share;
  if v_incident.id is null or v_incident.status <> 'resolved' then
    raise exception 'resume_incident_not_resolved' using errcode = '22023';
  end if;

  select * into v_plan from public.account_session_resume_plans
  where id = v_auth.resume_plan_id
    and account_id = v_auth.account_id
    and run_id = v_auth.run_id
  for update;
  if v_plan.id is null
     or v_plan.resume_state <> 'awaiting_human_resume_authorization' then
    raise exception 'resume_plan_not_recoverable' using errcode = '22023';
  end if;

  if p_metadata_safe ->> 'incident_id' <> v_auth.incident_id::text
     or p_metadata_safe ->> 'authorization_id' <> v_auth.id::text
     or p_metadata_safe -> 'resume_plan' ->> 'account_id' <> v_auth.account_id::text then
    raise exception 'resume_phase_plan_identity_mismatch' using errcode = '22023';
  end if;
  v_plan_error := public.auto_restart_phase_plan_v2_error(p_metadata_safe -> 'resume_plan');
  if v_plan_error is not null then
    raise exception '%', v_plan_error using errcode = '22023';
  end if;

  if p_device_id is not null and not exists (
    select 1 from public.auto_restart_device_locks l
    where l.device_id = p_device_id
      and l.account_id = v_auth.account_id
      and l.worker_id = p_worker_id
      and l.lease_expires_at > now()
    for update
  ) then
    raise exception 'resume_device_lock_missing' using errcode = '40001';
  end if;

  update public.incident_resume_authorizations
  set status = 'consumed', consumed_at = now(), consume_error = null,
      frozen_phase_plan = p_metadata_safe -> 'resume_plan', updated_at = now()
  where id = v_auth.id;

  v_request := public.create_account_run_request(
    p_account_id => v_auth.account_id,
    p_requested_by => null,
    p_actor_type => 'system',
    p_source_surface => 'auto_restart_tick',
    p_requested_run_type => 'account_session',
    p_idempotency_key => 'resume-auth:' || v_auth.id::text || ':g' || v_auth.retry_generation::text,
    p_priority => 0,
    p_metadata_safe => p_metadata_safe
  );

  update public.incident_resume_authorizations
  set consumed_by_request_id = v_request.id, updated_at = now()
  where id = v_auth.id;

  update public.account_session_resume_plans
  set resume_state = 'resume_requested', plan = coalesce(plan, '{}'::jsonb) || jsonb_build_object(
        'frozen_phase_plan', p_metadata_safe -> 'resume_plan',
        'resume_request_id', v_request.id,
        'retry_generation', v_auth.retry_generation
      ), last_updated_at = now()
  where id = v_plan.id;

  update public.account_incidents
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'recovery', coalesce(metadata -> 'recovery', '{}'::jsonb) || jsonb_build_object(
          'state', 'resume_requested', 'resume_request_id', v_request.id,
          'authorization_id', v_auth.id, 'retry_generation', v_auth.retry_generation,
          'updated_at', now()
        )
      ), updated_at = now()
  where id = v_incident.id;

  if p_device_id is not null then
    update public.auto_restart_device_locks
    set request_id = v_request.id, updated_at = now()
    where device_id = p_device_id and worker_id = p_worker_id;
  end if;

  return jsonb_build_object(
    'request_id', v_request.id,
    'authorization_id', v_auth.id,
    'retry_generation', v_auth.retry_generation,
    'idempotent', false
  );
end
$$;

revoke all on function public.consume_resume_authorization_and_create_request_v2(uuid,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.consume_resume_authorization_and_create_request_v2(uuid,text,uuid,jsonb)
  to service_role;

-- Periodic generic materialization. This intentionally keys eligibility on a
-- resolved canonical incident plus a recoverable resume plan, not on a fixed
-- incident-type list or account name. It also covers an assignment that only
-- becomes available in a later window.
create or replace function public.reconcile_resolved_incident_resume_windows_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_assignment public.account_assignments%rowtype;
  v_authorization_id uuid;
  v_count integer := 0;
begin
  for v_row in
    select i.id as incident_id, i.account_id, i.run_id, i.incident_type,
           i.reason, i.failure_reason, p.id as resume_plan_id,
           coalesce(p.test, false) as test
    from public.account_incidents i
    join lateral (
      select rp.* from public.account_session_resume_plans rp
      where rp.account_id = i.account_id and rp.run_id = i.run_id
        and rp.resume_state = 'awaiting_human_resume_authorization'
      order by rp.last_updated_at desc nulls last, rp.created_at desc
      limit 1
    ) p on true
    where i.status = 'resolved'
      and not exists (
        select 1 from public.incident_resume_authorizations a
        where a.incident_id = i.id and a.status = 'armed'
      )
    for update of i skip locked
  loop
    select aa.* into v_assignment
    from public.account_assignments aa
    where aa.account_id = v_row.account_id
      and aa.status in ('reserved','active')
      and aa.starts_at <= now() and now() < aa.ends_at
      and coalesce(aa.schedule_mode, '') <> 'manual_only'
    order by aa.starts_at desc
    limit 1;
    if v_assignment.id is null then continue; end if;

    v_authorization_id := null;
    insert into public.incident_resume_authorizations (
      incident_id, account_id, run_id, resume_plan_id, resume_window_key,
      scheduled_window_start, scheduled_window_end, status, armed_source,
      metadata_safe, test
    ) values (
      v_row.incident_id, v_row.account_id, v_row.run_id, v_row.resume_plan_id,
      v_row.account_id::text || ':' || v_assignment.starts_at::text,
      v_assignment.starts_at, v_assignment.ends_at, 'armed',
      'resolved_incident_reconciliation',
      jsonb_build_object(
        'incident_type', v_row.incident_type,
        'reason_code', coalesce(v_row.reason, v_row.failure_reason),
        'generic_resolved_incident_rule', true
      ), v_row.test
    ) on conflict do nothing returning id into v_authorization_id;

    if v_authorization_id is not null then
      update public.account_session_resume_plans
      set assignment_id = v_assignment.id, device_id = v_assignment.device_id,
          app_instance_id = v_assignment.app_instance_id,
          scheduled_window_start = v_assignment.starts_at,
          scheduled_window_end = v_assignment.ends_at,
          resume_window_key = v_row.account_id::text || ':' || v_assignment.starts_at::text,
          last_updated_at = now()
      where id = v_row.resume_plan_id;
      update public.account_incidents
      set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'recovery', coalesce(metadata -> 'recovery', '{}'::jsonb) || jsonb_build_object(
              'state', 'ready_to_resume', 'authorization_id', v_authorization_id,
              'source', 'resolved_incident_reconciliation', 'updated_at', now()
            )
          ), updated_at = now()
      where id = v_row.incident_id;
      v_count := v_count + 1;
    end if;
  end loop;
  return jsonb_build_object('armed_count', v_count);
end
$$;

revoke all on function public.reconcile_resolved_incident_resume_windows_v1()
  from public, anon, authenticated;
grant execute on function public.reconcile_resolved_incident_resume_windows_v1()
  to service_role;

create or replace function public.restore_prebusiness_resume_retry_credits_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_assignment public.account_assignments%rowtype;
  v_count integer := 0;
begin
  for v_row in
    select a.*, q.run_id as retry_run_id, q.updated_at as request_updated_at
    from public.incident_resume_authorizations a
    join public.account_run_requests q on q.id = a.consumed_by_request_id
    join public.ig_runs r on r.id = q.run_id
    join public.account_incidents i on i.id = a.incident_id
    where a.status = 'consumed'
      and a.test is false
      and i.status = 'resolved'
      and q.status in ('failed','canceled')
      and (
        q.error_code = 'phase_plan_unknown'
        or r.error_message = 'phase_plan_unknown'
        or r.performance_summary ->> 'reason' = 'phase_plan_unknown'
        or r.performance_summary ->> 'root_failure_code' = 'phase_plan_unknown'
        or r.performance_summary ->> 'restart_block_reason' = 'phase_plan_unknown'
        or r.performance_summary #>> '{admin_reliability_snapshot,restart_block_reason}' = 'phase_plan_unknown'
      )
      and coalesce(r.total_follow, 0) = 0
      and coalesce(r.total_like, 0) = 0
      and coalesce(r.total_dm, 0) = 0
      and coalesce((r.performance_summary #>> '{unfollow,verified_unfollows}')::integer, 0) = 0
      and coalesce((r.performance_summary #>> '{session_counters,successful_interactions}')::integer, 0) = 0
      and not exists (
        select 1 from public.ig_action_logs l
        where l.run_id = r.id
          and l.status in ('success','completed','verified','persisted')
          and l.action_type in ('follow','unfollow','like','dm','welcome_dm','outreach_dm')
      )
      and not exists (
        select 1 from public.account_run_requests newer
        where newer.account_id = a.account_id
          and newer.created_at > q.created_at
          and newer.status in ('queued','claimed','starting','running')
      )
    order by q.updated_at
    for update of a skip locked
  loop
    select aa.* into v_assignment
    from public.account_assignments aa
    where aa.account_id = v_row.account_id
      and aa.status in ('reserved','active')
      and aa.starts_at <= now() and now() < aa.ends_at
      and coalesce(aa.schedule_mode, '') <> 'manual_only'
    order by aa.starts_at desc
    limit 1;
    if v_assignment.id is null then
      continue;
    end if;

    update public.incident_resume_authorizations
    set status = 'armed', retry_generation = retry_generation + 1,
        retry_credit_restored_at = now(),
        retry_credit_restore_reason = 'phase_plan_unknown_zero_business_actions',
        scheduled_window_start = v_assignment.starts_at,
        scheduled_window_end = v_assignment.ends_at,
        resume_window_key = account_id::text || ':' || v_assignment.starts_at::text,
        consumed_at = null, consumed_by_request_id = null, consume_error = null,
        frozen_phase_plan = null, armed_at = now(), updated_at = now()
    where id = v_row.id and status = 'consumed';
    if not found then continue; end if;

    update public.account_session_resume_plans
    set assignment_id = v_assignment.id, device_id = v_assignment.device_id,
        app_instance_id = v_assignment.app_instance_id,
        scheduled_window_start = v_assignment.starts_at,
        scheduled_window_end = v_assignment.ends_at,
        resume_window_key = v_row.account_id::text || ':' || v_assignment.starts_at::text,
        resume_state = 'awaiting_human_resume_authorization',
        restart_allowed = true,
        restart_block_reason = 'retry_credit_restored_prebusiness',
        last_updated_at = now()
    where id = v_row.resume_plan_id;

    update public.account_incidents
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'recovery', coalesce(metadata -> 'recovery', '{}'::jsonb) || jsonb_build_object(
            'state', 'ready_to_resume',
            'reason', 'phase_plan_unknown_zero_business_actions',
            'authorization_id', v_row.id,
            'retry_generation', v_row.retry_generation + 1,
            'updated_at', now()
          )
        ), updated_at = now()
    where id = v_row.incident_id and status = 'resolved';
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('restored_count', v_count);
end
$$;

revoke all on function public.restore_prebusiness_resume_retry_credits_v1()
  from public, anon, authenticated;
grant execute on function public.restore_prebusiness_resume_retry_credits_v1()
  to service_role;
