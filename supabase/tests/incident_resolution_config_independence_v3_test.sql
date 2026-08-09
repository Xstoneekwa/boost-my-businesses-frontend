\set ON_ERROR_STOP on

\ir incident_resolution_resume_authorization_v2_test.sql

alter table public.account_incidents
  add column if not exists reason text,
  add column if not exists failure_reason text,
  add column if not exists resolution_note text;

alter table public.account_session_resume_plans
  add column if not exists assignment_id uuid,
  add column if not exists device_id uuid,
  add column if not exists app_instance_id uuid,
  add column if not exists resume_window_key text,
  add column if not exists test boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists last_updated_at timestamptz not null default now();

alter table public.account_assignments
  add column if not exists device_id uuid,
  add column if not exists app_instance_id uuid;

create or replace function public.transition_account_incident_human_review_v1(
  p_incident_id uuid, p_action text, p_expected_version bigint, p_actor_type text,
  p_actor_id uuid, p_source text, p_note text, p_resolution_reason text,
  p_idempotency_key text, p_channel text default null, p_notification_id uuid default null
)
returns jsonb language plpgsql as $$
declare v_inc public.account_incidents%rowtype;
begin
  select * into v_inc from public.account_incidents where id = p_incident_id for update;
  if v_inc.lifecycle_version <> p_expected_version then
    raise exception 'incident_version_conflict';
  end if;
  update public.account_incidents
  set status = 'resolved', resolved_by = p_actor_id, resolved_at = now(),
      lifecycle_version = lifecycle_version + 1, resolution_note = p_note,
      updated_at = now()
  where id = p_incident_id;
  update public.account_dashboard_actions
  set status = 'resolved'
  where incident_id = p_incident_id;
  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'incident_id', p_incident_id,
    'status', 'resolved', 'version', p_expected_version + 1,
    'notification_ids', '[]'::jsonb
  );
end $$;

\ir ../migrations/20260809180222_incident_resolution_config_independence_v3.sql

do $$
declare
  v_account uuid := gen_random_uuid();
  v_run uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_incident uuid := gen_random_uuid();
  v_plan uuid := gen_random_uuid();
  v_assignment uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_result jsonb;
  v_auth uuid;
begin
  insert into public.account_run_requests values(v_request, v_account, 'completed');
  insert into public.account_assignments(
    id, account_id, status, starts_at, ends_at, schedule_mode, device_id, app_instance_id
  ) values(
    v_assignment, v_account, 'active', now() - interval '1 hour',
    now() + interval '5 hours', 'scheduled', gen_random_uuid(), gen_random_uuid()
  );
  insert into public.account_session_resume_plans(
    id, run_id, run_request_id, account_id, resume_state, restart_allowed,
    scheduled_window_start, scheduled_window_end, assignment_id
  ) values(
    v_plan, v_run, v_request, v_account, 'awaiting_human_resume_authorization', false,
    now() - interval '1 hour', now() + interval '5 hours', v_assignment
  );
  insert into public.account_incidents(
    id, account_id, run_id, status, severity, incident_type, reason, metadata,
    lifecycle_version, updated_at
  ) values(
    v_incident, v_account, v_run, 'open', 'critical',
    'generic_non_security_failure', 'identity_preflight_failed', '{}'::jsonb, 1, now()
  );
  insert into public.account_dashboard_actions values(
    gen_random_uuid(), v_incident, 'pending_verification'
  );

  v_result := public.transition_account_incident_human_review_v2(
    v_incident, 'resolve', 1, 'ops', v_actor, 'botapp_relay', null,
    'verified_fixed', 'v3:resolve', repeat('c', 40), 'worker:' || repeat('c', 40),
    null, null
  );

  if v_result ->> 'incident_resolved' <> 'true' then
    raise exception 'critical_non_security_incident_not_resolved: %', v_result;
  end if;
  if v_result ->> 'dashboard_action_resolved' <> 'true' then
    raise exception 'dashboard_action_not_resolved: %', v_result;
  end if;
  if not (select restart_allowed from public.account_session_resume_plans where id = v_plan) then
    raise exception 'restart_allowed_not_restored';
  end if;
  if (select count(*) from public.incident_resume_authorizations where incident_id = v_incident) <> 1 then
    raise exception 'resume_authorization_not_unique';
  end if;
  v_auth := (v_result ->> 'resume_authorization_id')::uuid;
  if v_auth is null or v_result ->> 'next_tick_eligible' <> 'true' then
    raise exception 'resolved_account_not_next_tick_eligible: %', v_result;
  end if;

  v_result := public.transition_account_incident_human_review_v2(
    v_incident, 'resolve', 1, 'ops', v_actor, 'botapp_relay', null,
    'verified_fixed', 'v3:resolve:again', repeat('c', 40), 'worker:' || repeat('c', 40),
    null, null
  );
  if v_result ->> 'idempotent' <> 'true' then
    raise exception 'second_resolve_not_idempotent: %', v_result;
  end if;
  if (select count(*) from public.incident_resume_authorizations where incident_id = v_incident) <> 1 then
    raise exception 'second_authorization_created';
  end if;
end $$;

do $$
declare
  v_account uuid := gen_random_uuid();
  v_incident uuid := gen_random_uuid();
begin
  insert into public.account_incidents(
    id, account_id, run_id, status, severity, incident_type, metadata,
    lifecycle_version, updated_at
  ) values(
    v_incident, v_account, gen_random_uuid(), 'open', 'error',
    'security_identity_violation', '{}'::jsonb, 1, now()
  );
  begin
    perform public.transition_account_incident_human_review_v2(
      v_incident, 'resolve', 1, 'ops', gen_random_uuid(), 'botapp_relay', null,
      'verified_fixed', 'v3:security', repeat('d', 40), 'worker:' || repeat('d', 40),
      null, null
    );
    raise exception 'explicit_security_incident_was_resolved';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$
begin
  if has_function_privilege('anon',
       'public.transition_account_incident_human_review_v2(uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid)',
       'execute') then
    raise exception 'anon_execute_grant_present';
  end if;
  if has_function_privilege('authenticated',
       'public.transition_account_incident_human_review_v2(uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid)',
       'execute') then
    raise exception 'authenticated_execute_grant_present';
  end if;
  if not has_function_privilege('service_role',
       'public.transition_account_incident_human_review_v2(uuid,text,bigint,text,uuid,text,text,text,text,text,text,text,uuid)',
       'execute') then
    raise exception 'service_role_execute_grant_missing';
  end if;
end $$;

select 'incident_resolution_config_independence_v3_test_ok' as result;
