-- Instagram action rate limit V2: prospective incident-only blocker.
-- Historical V1 incidents/holds are deliberately left untouched.

create or replace function public.apply_instagram_action_restriction_v1(
  p_account_id uuid,
  p_account_username text default null,
  p_run_id uuid default null,
  p_request_id uuid default null,
  p_stable_reason text default 'instagram_action_rate_limit',
  p_metadata_safe jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.ig_accounts%rowtype;
  v_incident public.account_incidents%rowtype;
  v_dedupe_key text;
  v_deduplicated boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;
  if coalesce(nullif(trim(p_stable_reason), ''), '') <> 'instagram_action_rate_limit' then
    raise exception 'stable_reason_invalid' using errcode = '22023';
  end if;

  select * into v_account from public.ig_accounts where id = p_account_id for update;
  if v_account.id is null then
    raise exception 'account_not_found' using errcode = '22023';
  end if;

  v_dedupe_key := 'account:' || p_account_id::text || ':instagram_action_rate_limit:v2';
  select exists (
    select 1 from public.account_incidents
    where dedupe_key = v_dedupe_key and status in ('open', 'acknowledged')
  ) into v_deduplicated;

  select * into v_incident from public.upsert_account_incident(
    p_incident_type => 'instagram_account_restriction',
    p_dedupe_key => v_dedupe_key,
    p_severity => 'error',
    p_status => 'open',
    p_account_id => p_account_id,
    p_account_username => coalesce(nullif(trim(p_account_username), ''), v_account.username),
    p_run_id => p_run_id,
    p_source => 'instagram_action_restriction_guard',
    p_reason => 'instagram_action_rate_limit',
    p_failure_reason => 'instagram_action_rate_limit',
    p_action_required => 'Wait approximately 48 hours, then resolve this incident manually. The account becomes eligible only through the next normal scheduler tick and its usual gates.',
    p_safe_client_message => 'Instagram has temporarily limited actions on this account. A 48h pause is required.',
    p_assistant_message => 'Temporary Instagram action limit detected. The open incident is the only new campaign blocker.',
    p_admin_message => 'Do not retry early. Resolve manually after the recommended pause; no special run, tick, preflight, or resume authorization is created.',
    p_metadata => coalesce(p_metadata_safe, '{}'::jsonb) || jsonb_build_object(
      'stable_reason', 'instagram_action_rate_limit',
      'risk_class', 'temporary_restriction',
      'severity', 'error',
      'blocking_campaign', true,
      'incident_only_blocker_v2', true,
      'operator_review_required', false,
      'requires_human_confirmation', false,
      'requires_credentials_update', false,
      'is_temporary_restriction', true,
      'manual_incident_resolution_required', true,
      'account_pause_required', false,
      'physical_preflight_required', false,
      'auto_restart_allowed', false,
      'pause_policy_source', 'bmb_operational_policy_48h',
      'instagram_exact_expiry_provided', false,
      'request_id', p_request_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'incident_id', v_incident.id,
    'dedupe_key', v_dedupe_key,
    'deduplicated', v_deduplicated,
    'incident_status', v_incident.status,
    'hold_id', null,
    'hold_status', null,
    'account_paused', false,
    'auto_restart_allowed', false,
    'operator_review_required', false,
    'physical_preflight_required', false,
    'resume_authorization_required', false,
    'dashboard_action', '{}'::jsonb
  );
end
$$;

revoke all on function public.apply_instagram_action_restriction_v1(uuid,text,uuid,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_instagram_action_restriction_v1(uuid,text,uuid,uuid,text,jsonb)
  to service_role;

create or replace function public.arm_incident_resolution_auto_resume_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.account_session_resume_plans%rowtype;
  v_assignment public.account_assignments%rowtype;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_window_key text;
  v_authorization_id uuid;
begin
  if coalesce(new.metadata ->> 'incident_only_blocker_v2', 'false') = 'true' then
    return new;
  end if;
  if new.status <> 'resolved' or old.status = 'resolved' or new.run_id is null
     or new.account_id is null or left(lower(coalesce(new.incident_type, '')), 9) = 'security_'
     or lower(coalesce(new.metadata ->> 'security_incident', 'false')) in ('true','1','yes') then
    return new;
  end if;
  select p.* into v_plan from public.account_session_resume_plans p
  where p.run_id = new.run_id and p.account_id = new.account_id
    and p.resume_state = 'awaiting_human_resume_authorization'
  order by p.last_updated_at desc nulls last, p.created_at desc limit 1;
  if v_plan.id is null then return new; end if;
  select a.* into v_assignment from public.account_assignments a
  where a.account_id = new.account_id and a.status in ('reserved','active')
    and (v_plan.assignment_id is null or a.id = v_plan.assignment_id)
    and a.starts_at <= now() and a.ends_at > now()
    and coalesce(a.schedule_mode, '') <> 'manual_only'
  order by case when a.id = v_plan.assignment_id then 0 else 1 end, a.starts_at desc limit 1;
  v_window_start := coalesce(v_plan.scheduled_window_start, v_assignment.starts_at);
  v_window_end := coalesce(v_plan.scheduled_window_end, v_assignment.ends_at);
  if v_window_start is null or v_window_end is null or not (v_window_start <= now() and now() < v_window_end) then
    return new;
  end if;
  v_window_key := coalesce(nullif(v_plan.resume_window_key, ''), new.account_id::text || ':' || v_window_start::text);
  insert into public.incident_resume_authorizations (
    incident_id, account_id, run_id, resume_plan_id, resume_window_key,
    scheduled_window_start, scheduled_window_end, status, armed_source,
    resolution_note, metadata_safe, test
  ) values (
    new.id, new.account_id, new.run_id, v_plan.id, v_window_key,
    v_window_start, v_window_end, 'armed', 'incident_resolution',
    left(coalesce(new.resolution_note, ''), 500),
    jsonb_build_object('incident_type',new.incident_type,'reason_code',coalesce(new.reason,new.failure_reason),'resolution_is_resume_authorization',true,'explicit_security_classification',false),
    lower(coalesce(new.metadata ->> 'test', 'false')) in ('true','1','yes')
  ) on conflict do nothing returning id into v_authorization_id;
  if v_authorization_id is not null then
    update public.account_session_resume_plans set scheduled_window_start=v_window_start,
      scheduled_window_end=v_window_end,resume_window_key=v_window_key,last_updated_at=now()
    where id=v_plan.id;
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object('recovery',coalesce(new.metadata->'recovery','{}'::jsonb) || jsonb_build_object('state','ready_to_resume','authorization_id',v_authorization_id,'armed_at',now(),'source','incident_resolution'));
  end if;
  return new;
end
$$;

create or replace function public.mark_instagram_restriction_preflight_required_v1()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.incident_type <> 'instagram_account_restriction'
     or coalesce(new.metadata ->> 'incident_only_blocker_v2', 'false') = 'true' then
    return new;
  end if;
  update public.instagram_account_restriction_holds
  set status='verification_required', human_resolved_at=coalesce(new.resolved_at,now()),
      verification_required_at=now(), metadata_safe=coalesce(metadata_safe,'{}'::jsonb)
        || jsonb_build_object('incident_resolved_but_physical_preflight_pending',true), updated_at=now()
  where incident_id=new.id and status='active';
  return new;
end
$$;

create or replace function public.instagram_action_rate_limit_next_tick_eligibility_v2(
  p_account_id uuid,
  p_incident_id uuid
)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'next_tick_eligible', not (
      exists (select 1 from public.account_incidents i where i.account_id=p_account_id and i.id<>p_incident_id
        and i.status in ('open','acknowledged') and i.archived_at is null
        and (coalesce((i.metadata->>'blocking_campaign')::boolean,false) or coalesce((i.metadata->>'operator_review_required')::boolean,false)))
      or exists (select 1 from public.account_dashboard_actions a where a.account_id=p_account_id
        and a.status in ('pending','acknowledged','pending_verification','code_submitted') and coalesce(a.blocking_campaign,false))
      or exists (select 1 from public.instagram_account_restriction_holds h where h.account_id=p_account_id and h.status in ('active','verification_required'))
    ),
    'blocked_reason', case
      when exists (select 1 from public.account_incidents i where i.account_id=p_account_id and i.id<>p_incident_id
        and i.status in ('open','acknowledged') and i.archived_at is null
        and (coalesce((i.metadata->>'blocking_campaign')::boolean,false) or coalesce((i.metadata->>'operator_review_required')::boolean,false))) then 'other_blocking_incident_exists'
      when exists (select 1 from public.account_dashboard_actions a where a.account_id=p_account_id
        and a.status in ('pending','acknowledged','pending_verification','code_submitted') and coalesce(a.blocking_campaign,false)) then 'other_blocking_dashboard_action_exists'
      when exists (select 1 from public.instagram_account_restriction_holds h where h.account_id=p_account_id and h.status in ('active','verification_required')) then 'historical_restriction_hold_exists'
      else null end
  )
$$;

revoke all on function public.instagram_action_rate_limit_next_tick_eligibility_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.instagram_action_rate_limit_next_tick_eligibility_v2(uuid,uuid) to service_role;

create or replace function public.transition_account_incident_human_review_v3(
  p_incident_id uuid, p_action text, p_expected_version bigint, p_actor_type text,
  p_actor_id uuid, p_source text, p_note text, p_resolution_reason text,
  p_idempotency_key text, p_expected_worker_sha text, p_cause_fixed_version text,
  p_channel text default null, p_notification_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_incident public.account_incidents%rowtype;
  v_transition jsonb;
  v_eligibility jsonb;
begin
  select * into v_incident from public.account_incidents where id=p_incident_id and archived_at is null;
  if v_incident.id is null then raise exception 'incident_not_found' using errcode='P0002'; end if;
  if lower(trim(coalesce(p_action,'')))='resolve'
     and coalesce(v_incident.metadata->>'incident_only_blocker_v2','false')='true'
     and coalesce(v_incident.reason,v_incident.failure_reason)='instagram_action_rate_limit' then
    v_transition := public.transition_account_incident_human_review_v1(
      p_incident_id,p_action,p_expected_version,p_actor_type,p_actor_id,p_source,p_note,
      p_resolution_reason,p_idempotency_key,p_channel,p_notification_id
    );
    v_eligibility := public.instagram_action_rate_limit_next_tick_eligibility_v2(v_incident.account_id,p_incident_id);
    return v_transition || jsonb_build_object(
      'incident_resolved',true,'dashboard_action_resolved',true,
      'resume_authorization_created',false,'next_tick_eligible',coalesce((v_eligibility->>'next_tick_eligible')::boolean,false),
      'blocked_reason',v_eligibility->>'blocked_reason','special_resume_path_created',false
    );
  end if;
  return public.transition_account_incident_human_review_v2(
    p_incident_id,p_action,p_expected_version,p_actor_type,p_actor_id,p_source,p_note,
    p_resolution_reason,p_idempotency_key,p_expected_worker_sha,p_cause_fixed_version,p_channel,p_notification_id
  );
end
$$;

revoke all on function public.transition_account_incident_human_review_v3(uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.transition_account_incident_human_review_v3(uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid)
  to service_role;
