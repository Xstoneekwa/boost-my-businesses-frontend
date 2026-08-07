-- Canonical manual incident resolution -> one-shot natural-tick resume V2.
--
-- This migration extends the existing authorization table and scheduler
-- contract.  It never deletes or reuses a consumed schedule-session key.

alter table public.incident_resume_authorizations
  add column if not exists source_run_id uuid,
  add column if not exists source_request_id uuid,
  add column if not exists resolved_by uuid,
  add column if not exists resolved_at timestamptz,
  add column if not exists cause_fixed_version text,
  add column if not exists business_date date,
  add column if not exists expected_worker_sha text,
  add column if not exists expires_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists canceled_at timestamptz;

update public.incident_resume_authorizations a
set source_run_id = coalesce(a.source_run_id, a.run_id),
    source_request_id = coalesce(a.source_request_id, p.run_request_id),
    expires_at = coalesce(a.expires_at, a.scheduled_window_end),
    business_date = coalesce(
      a.business_date,
      (coalesce(a.armed_at, a.created_at) at time zone 'Africa/Johannesburg')::date
    ),
    updated_at = now()
from public.account_session_resume_plans p
where p.id = a.resume_plan_id
  and (
    a.source_run_id is null or a.source_request_id is null
    or a.expires_at is null or a.business_date is null
  );

create unique index if not exists incident_resume_authorizations_v2_idempotency_idx
  on public.incident_resume_authorizations (idempotency_key)
  where idempotency_key is not null;

alter table public.incident_resume_authorizations
  drop constraint if exists incident_resume_authorizations_expected_worker_sha_check;
alter table public.incident_resume_authorizations
  add constraint incident_resume_authorizations_expected_worker_sha_check
  check (expected_worker_sha is null or expected_worker_sha ~ '^[0-9a-f]{40}$');

create or replace view public.incident_resume_authorizations_v2
with (security_invoker = true)
as
select
  a.id as authorization_id,
  a.incident_id,
  a.account_id,
  coalesce(a.source_run_id, a.run_id) as source_run_id,
  a.source_request_id,
  a.resolved_by,
  a.resolved_at,
  a.cause_fixed_version,
  a.business_date,
  a.expected_worker_sha,
  coalesce(a.expires_at, a.scheduled_window_end) as expires_at,
  case a.status
    when 'armed' then 'pending'
    when 'revoked' then 'canceled'
    else a.status
  end as status,
  a.idempotency_key,
  a.created_at,
  a.updated_at,
  a.consumed_at,
  a.consumed_by_request_id,
  a.canceled_at,
  a.resume_window_key,
  a.resume_plan_id,
  a.metadata_safe
from public.incident_resume_authorizations a;

revoke all on public.incident_resume_authorizations_v2 from public, anon, authenticated;
grant select on public.incident_resume_authorizations_v2 to service_role;

create or replace function public.incident_resume_authorization_preflight_v2(
  p_authorization_id uuid
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
  v_reason text;
begin
  select * into v_auth
  from public.incident_resume_authorizations
  where id = p_authorization_id;

  if v_auth.id is null then v_reason := 'resume_authorization_missing';
  elsif v_auth.status <> 'armed' then v_reason := 'resume_authorization_not_pending';
  elsif coalesce(v_auth.expires_at, v_auth.scheduled_window_end) <= now() then v_reason := 'resume_authorization_expired';
  elsif v_auth.expected_worker_sha is null then v_reason := 'resume_worker_sha_missing';
  elsif v_auth.cause_fixed_version is null then v_reason := 'resume_cause_fixed_version_missing';
  else
    select * into v_incident from public.account_incidents
    where id = v_auth.incident_id and account_id = v_auth.account_id;
    select * into v_plan from public.account_session_resume_plans
    where id = v_auth.resume_plan_id and account_id = v_auth.account_id;

    if v_incident.id is null or v_incident.status <> 'resolved' then v_reason := 'resume_incident_not_resolved';
    elsif v_incident.severity = 'critical'
       or v_incident.incident_type ilike '%security%'
       or lower(coalesce(v_incident.metadata ->> 'security_incident', 'false')) in ('true', '1', 'yes') then
      v_reason := 'resume_security_incident_forbidden';
    elsif v_plan.id is null or v_plan.resume_state <> 'awaiting_human_resume_authorization' then
      v_reason := 'resume_plan_not_recoverable';
    elsif not coalesce(v_plan.restart_allowed, false) then v_reason := 'resume_restart_not_allowed';
    elsif not exists (
      select 1 from public.account_assignments aa
      where aa.account_id = v_auth.account_id
        and aa.status in ('reserved', 'active')
        and aa.starts_at <= now() and now() < aa.ends_at
        and coalesce(aa.schedule_mode, '') <> 'manual_only'
    ) then v_reason := 'resume_assignment_not_scheduler_eligible';
    elsif exists (
      select 1 from public.account_run_requests q
      where q.account_id = v_auth.account_id
        and q.status in ('queued', 'claimed', 'starting', 'running')
    ) then v_reason := 'resume_active_request_exists';
    elsif exists (
      select 1 from public.ig_runs r
      where r.account_id = v_auth.account_id and r.status in ('pending', 'running')
    ) then v_reason := 'resume_active_run_exists';
    elsif exists (
      select 1 from public.auto_restart_device_locks l
      where l.account_id = v_auth.account_id and l.lease_expires_at > now()
    ) then v_reason := 'resume_active_device_lock_exists';
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'authorization_id', p_authorization_id,
    'next_tick_eligible', v_reason is null,
    'blocked_reason', v_reason,
    'expires_at', coalesce(v_auth.expires_at, v_auth.scheduled_window_end),
    'expected_worker_sha', v_auth.expected_worker_sha
  ));
end
$$;

revoke all on function public.incident_resume_authorization_preflight_v2(uuid)
  from public, anon, authenticated;
grant execute on function public.incident_resume_authorization_preflight_v2(uuid)
  to service_role;

create or replace function public.transition_account_incident_human_review_v2(
  p_incident_id uuid,
  p_action text,
  p_expected_version bigint,
  p_actor_type text,
  p_actor_id uuid,
  p_source text,
  p_note text,
  p_resolution_reason text,
  p_idempotency_key text,
  p_expected_worker_sha text,
  p_cause_fixed_version text,
  p_channel text default null,
  p_notification_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_incident public.account_incidents%rowtype;
  v_transition jsonb;
  v_auth public.incident_resume_authorizations%rowtype;
  v_preflight jsonb;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_sha text := lower(btrim(coalesce(p_expected_worker_sha, '')));
  v_fixed text := nullif(btrim(coalesce(p_cause_fixed_version, '')), '');
  v_resolution_version bigint;
  v_now timestamptz := now();
begin
  select * into v_incident from public.account_incidents
  where id = p_incident_id and archived_at is null
  for update;
  if v_incident.id is null then
    raise exception 'incident_not_found' using errcode = 'P0002';
  end if;

  if v_action = 'resolve' then
    if v_incident.severity = 'critical'
       or v_incident.incident_type ilike '%security%'
       or lower(coalesce(v_incident.metadata ->> 'security_incident', 'false')) in ('true', '1', 'yes') then
      raise exception 'incident_security_resolution_forbidden' using errcode = '42501';
    end if;
    if v_sha !~ '^[0-9a-f]{40}$' then
      raise exception 'incident_resolution_expected_worker_sha_invalid' using errcode = '22023';
    end if;
    if v_fixed is null or char_length(v_fixed) > 160 then
      raise exception 'incident_resolution_cause_fixed_version_invalid' using errcode = '22023';
    end if;
  end if;

  if v_action = 'resolve' and v_incident.status = 'resolved' then
    v_transition := jsonb_build_object(
      'ok', true, 'idempotent', true, 'incident_id', v_incident.id,
      'status', v_incident.status, 'version', v_incident.lifecycle_version,
      'notification_ids', '[]'::jsonb
    );
  else
    v_transition := public.transition_account_incident_human_review_v1(
      p_incident_id, p_action, p_expected_version, p_actor_type, p_actor_id,
      p_source, p_note, p_resolution_reason, p_idempotency_key,
      p_channel, p_notification_id
    );
  end if;

  if v_action <> 'resolve' then
    return v_transition || jsonb_build_object(
      'incident_resolved', false,
      'dashboard_action_resolved', false,
      'resume_authorization_created', false,
      'next_tick_eligible', false
    );
  end if;

  select * into v_incident from public.account_incidents where id = p_incident_id;
  v_resolution_version := v_incident.lifecycle_version;

  update public.account_incidents
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'manual_resolution_v2', jsonb_build_object(
          'resolved_by', p_actor_id,
          'resolved_at', coalesce(resolved_at, v_now),
          'cause_fixed_version', v_fixed,
          'expected_worker_sha', v_sha,
          'resolution_version', v_resolution_version
        )
      ),
      updated_at = v_now
  where id = p_incident_id;

  select a.* into v_auth
  from public.incident_resume_authorizations a
  where a.incident_id = p_incident_id
    and a.status in ('armed', 'consumed')
  order by a.created_at desc
  limit 1
  for update;

  if v_auth.id is not null then
    update public.incident_resume_authorizations a
    set source_run_id = coalesce(a.source_run_id, a.run_id, v_incident.run_id),
        source_request_id = coalesce(a.source_request_id, p.run_request_id),
        resolved_by = coalesce(a.resolved_by, p_actor_id),
        resolved_at = coalesce(a.resolved_at, v_incident.resolved_at, v_now),
        cause_fixed_version = v_fixed,
        business_date = coalesce(a.business_date, (coalesce(v_incident.resolved_at, v_now) at time zone 'Africa/Johannesburg')::date),
        expected_worker_sha = v_sha,
        expires_at = coalesce(a.expires_at, a.scheduled_window_end),
        idempotency_key = coalesce(a.idempotency_key, 'incident-resume:' || a.account_id::text || ':' || a.incident_id::text || ':v' || v_resolution_version::text),
        armed_by = coalesce(a.armed_by, p_actor_id::text),
        updated_at = v_now
    from public.account_session_resume_plans p
    where a.id = v_auth.id and p.id = a.resume_plan_id
    returning a.* into v_auth;
    v_preflight := public.incident_resume_authorization_preflight_v2(v_auth.id);
  else
    v_preflight := jsonb_build_object(
      'next_tick_eligible', false,
      'blocked_reason', 'resume_authorization_not_created'
    );
  end if;

  return v_transition || jsonb_strip_nulls(jsonb_build_object(
    'incident_resolved', true,
    'dashboard_action_resolved', not exists (
      select 1 from public.account_dashboard_actions a
      where a.incident_id = p_incident_id and a.status <> 'resolved'
    ),
    'resume_authorization_created', v_auth.id is not null,
    'resume_authorization_id', v_auth.id,
    'expires_at', coalesce(v_auth.expires_at, v_auth.scheduled_window_end),
    'next_tick_eligible', coalesce((v_preflight ->> 'next_tick_eligible')::boolean, false),
    'blocked_reason', v_preflight ->> 'blocked_reason',
    'expected_worker_sha', v_sha,
    'cause_fixed_version', v_fixed
  ));
end
$$;

revoke all on function public.transition_account_incident_human_review_v2(
  uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.transition_account_incident_human_review_v2(
  uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid
) to service_role;

comment on function public.transition_account_incident_human_review_v2(
  uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid
) is 'Atomically synchronizes a non-security manual incident resolution and enriches exactly one SHA-scoped, expiring natural-tick resume authorization.';

create or replace function public.reconcile_resolved_incident_resume_windows_v2()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base jsonb;
  v_enriched integer := 0;
begin
  v_base := public.reconcile_resolved_incident_resume_windows_v1();

  update public.incident_resume_authorizations a
  set source_run_id = coalesce(a.source_run_id, a.run_id, i.run_id),
      source_request_id = coalesce(a.source_request_id, p.run_request_id),
      resolved_by = coalesce(a.resolved_by, i.resolved_by),
      resolved_at = coalesce(a.resolved_at, i.resolved_at),
      cause_fixed_version = coalesce(a.cause_fixed_version, i.metadata #>> '{manual_resolution_v2,cause_fixed_version}'),
      business_date = coalesce(a.business_date, (coalesce(i.resolved_at, a.armed_at) at time zone 'Africa/Johannesburg')::date),
      expected_worker_sha = coalesce(a.expected_worker_sha, lower(i.metadata #>> '{manual_resolution_v2,expected_worker_sha}')),
      expires_at = coalesce(a.expires_at, a.scheduled_window_end),
      idempotency_key = coalesce(a.idempotency_key, 'incident-resume:' || a.account_id::text || ':' || a.incident_id::text || ':v' || i.lifecycle_version::text),
      updated_at = now()
  from public.account_incidents i, public.account_session_resume_plans p
  where a.incident_id = i.id and a.resume_plan_id = p.id
    and a.status = 'armed'
    and i.status = 'resolved'
    and (i.metadata #>> '{manual_resolution_v2,expected_worker_sha}') ~ '^[0-9a-f]{40}$'
    and nullif(i.metadata #>> '{manual_resolution_v2,cause_fixed_version}', '') is not null
    and (a.expected_worker_sha is null or a.cause_fixed_version is null or a.idempotency_key is null);
  get diagnostics v_enriched = row_count;

  return coalesce(v_base, '{}'::jsonb) || jsonb_build_object('v2_enriched_count', v_enriched);
end
$$;

revoke all on function public.reconcile_resolved_incident_resume_windows_v2()
  from public, anon, authenticated;
grant execute on function public.reconcile_resolved_incident_resume_windows_v2()
  to service_role;
