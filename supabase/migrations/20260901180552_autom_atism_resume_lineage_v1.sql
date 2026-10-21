-- AUTOM_ATISM_RESUME_LINEAGE_V1
-- Preserve the existing canonical request-admission path while allowing one
-- operator-authorized resume to inherit its source request root atomically.

begin;

create or replace function public.auto_restart_phase_plan_v2_error(p_plan jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_phase text;
  v_enabled boolean := false;
  v_recovery_first boolean := false;
begin
  if jsonb_typeof(p_plan) <> 'object'
     or p_plan ->> 'schema' <> 'AUTO_RESTART_RESUME_PLAN_V2'
     or coalesce((p_plan ->> 'plan_version')::integer, 0) <> 2 then
    return 'phase_plan_unknown';
  end if;
  if nullif(p_plan ->> 'account_id', '') is null then
    return 'phase_plan_account_missing';
  end if;
  if jsonb_typeof(p_plan -> 'phases_to_run') <> 'object'
     or jsonb_typeof(p_plan -> 'quota_remaining') <> 'object' then
    return 'phase_plan_unknown';
  end if;

  if coalesce((p_plan ->> 'restriction_preflight_only')::boolean, false) then
    if p_plan -> 'phase_order' <> '["welcome","follow","unfollow"]'::jsonb
       or p_plan ->> 'resume_kind' <> 'instagram_restriction_preflight'
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
  v_recovery_first := p_plan -> 'phase_order'
    = '["post_follow_recovery","welcome","follow","unfollow"]'::jsonb;
  if not v_recovery_first
     and p_plan -> 'phase_order' <> '["welcome","follow","unfollow"]'::jsonb then
    return 'phase_plan_order_invalid';
  end if;
  if v_recovery_first and (
    coalesce((p_plan -> 'phases_to_run' ->> 'post_follow_recovery')::boolean, false) is not true
    or p_plan ->> 'safe_next_step' <> 'post_follow_recovery'
    or coalesce((p_plan -> 'phases_to_run' ->> 'follow')::boolean, false) is not true
  ) then
    return 'post_follow_recovery_contract_invalid';
  end if;
  if not v_recovery_first
     and coalesce((p_plan -> 'phases_to_run' ->> 'post_follow_recovery')::boolean, false) then
    return 'post_follow_recovery_contract_invalid';
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
  if not v_enabled then return 'resume_phase_plan_not_actionable'; end if;
  return null;
exception when invalid_text_representation or numeric_value_out_of_range then
  return 'phase_plan_invalid_field';
end
$$;

revoke all on function public.auto_restart_phase_plan_v2_error(jsonb)
  from public, anon, authenticated;
grant execute on function public.auto_restart_phase_plan_v2_error(jsonb) to service_role;

create or replace function public.apply_authorized_resume_request_lineage_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth public.incident_resume_authorizations%rowtype;
  v_plan public.account_session_resume_plans%rowtype;
  v_source public.account_run_requests%rowtype;
  v_next_attempt integer;
begin
  if new.source_surface <> 'auto_restart_tick'
     or coalesce((new.metadata_safe ->> 'resume_lineage_contract_v1')::boolean, false) is not true then
    return new;
  end if;
  select * into v_auth from public.incident_resume_authorizations
  where id = (new.metadata_safe ->> 'authorization_id')::uuid for update;
  select * into v_plan from public.account_session_resume_plans
  where id = v_auth.resume_plan_id and account_id = new.account_id for update;
  select * into v_source from public.account_run_requests
  where id = v_plan.run_request_id and account_id = new.account_id for share;
  v_next_attempt := v_source.execution_attempt_no + 1;
  if v_auth.id is null or v_plan.id is null or v_source.id is null
     or v_auth.status <> 'consumed'
     or new.metadata_safe ->> 'parent_request_id' <> v_source.id::text
     or new.metadata_safe ->> 'root_business_session_id' <> v_source.root_business_session_id::text
     or (new.metadata_safe ->> 'execution_attempt_no')::integer <> v_next_attempt then
    raise exception 'resume_request_lineage_reconciliation_required' using errcode = '22023';
  end if;
  new.root_business_session_id := v_source.root_business_session_id;
  new.execution_attempt_no := v_next_attempt;
  new.retry_index := v_next_attempt - 1;
  return new;
exception when invalid_text_representation or null_value_not_allowed then
  raise exception 'resume_request_lineage_reconciliation_required' using errcode = '22023';
end
$$;

revoke all on function public.apply_authorized_resume_request_lineage_v1()
  from public, anon, authenticated;

drop trigger if exists account_run_request_00_resume_lineage_v1
  on public.account_run_requests;
create trigger account_run_request_00_resume_lineage_v1
before insert on public.account_run_requests
for each row execute function public.apply_authorized_resume_request_lineage_v1();

create or replace function public.consume_resume_authorization_and_create_request_v4(
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
  v_plan public.account_session_resume_plans%rowtype;
  v_source public.account_run_requests%rowtype;
  v_next_attempt integer;
  v_metadata jsonb := coalesce(p_metadata_safe, '{}'::jsonb);
  v_embedded jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if coalesce((v_metadata -> 'resume_plan' ->> 'restriction_preflight_only')::boolean, false) then
    return public.consume_resume_authorization_and_create_request_v3(
      p_authorization_id, p_worker_id, p_device_id, v_metadata
    );
  end if;

  select * into v_auth from public.incident_resume_authorizations
  where id = p_authorization_id for update;
  if v_auth.id is null then
    raise exception 'resume_authorization_missing' using errcode = '22023';
  end if;
  if v_auth.status = 'consumed' and v_auth.consumed_by_request_id is not null then
    return public.consume_resume_authorization_and_create_request_v3(
      p_authorization_id, p_worker_id, p_device_id, v_metadata
    );
  end if;
  select * into v_plan from public.account_session_resume_plans
  where id = v_auth.resume_plan_id and account_id = v_auth.account_id and run_id = v_auth.run_id
  for update;
  select * into v_source from public.account_run_requests
  where id = v_plan.run_request_id and account_id = v_auth.account_id for share;
  v_next_attempt := v_source.execution_attempt_no + 1;
  if v_plan.id is null or v_source.id is null or v_source.root_business_session_id is null
     or v_next_attempt not between 2 and 3 then
    raise exception 'resume_plan_lineage_incomplete' using errcode = '22023';
  end if;

  v_embedded := v_metadata -> 'resume_plan';
  if (nullif(v_metadata ->> 'business_session_id', '') is not null
      and v_metadata ->> 'business_session_id' <> v_source.root_business_session_id::text)
     or (nullif(v_embedded ->> 'business_session_id', '') is not null
      and v_embedded ->> 'business_session_id' <> v_source.root_business_session_id::text)
     or (nullif(v_embedded ->> 'root_business_session_id', '') is not null
      and v_embedded ->> 'root_business_session_id' <> v_source.root_business_session_id::text)
     or (nullif(v_embedded ->> 'parent_request_id', '') is not null
      and v_embedded ->> 'parent_request_id' <> v_source.id::text)
     or (nullif(v_embedded ->> 'attempt_id', '') is not null
      and (v_embedded ->> 'attempt_id')::integer <> v_next_attempt)
     or (nullif(v_embedded ->> 'execution_attempt_no', '') is not null
      and (v_embedded ->> 'execution_attempt_no')::integer <> v_next_attempt) then
    raise exception 'resume_plan_lineage_mismatch' using errcode = '22023';
  end if;

  v_embedded := v_embedded || jsonb_build_object(
    'business_session_id', v_source.root_business_session_id::text,
    'root_business_session_id', v_source.root_business_session_id::text,
    'parent_request_id', v_source.id::text,
    'source_request_id', v_source.id::text,
    'attempt_id', v_next_attempt,
    'execution_attempt_no', v_next_attempt,
    'retry_index', v_next_attempt - 1
  );
  v_metadata := v_metadata || jsonb_build_object(
    'resume_lineage_contract_v1', true,
    'business_session_id', v_source.root_business_session_id::text,
    'root_business_session_id', v_source.root_business_session_id::text,
    'parent_request_id', v_source.id::text,
    'source_request_id', v_source.id::text,
    'attempt_id', v_next_attempt,
    'execution_attempt_no', v_next_attempt,
    'retry_index', v_next_attempt - 1,
    'resume_plan', v_embedded
  );
  return public.consume_resume_authorization_and_create_request_v3(
    p_authorization_id, p_worker_id, p_device_id, v_metadata
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'resume_plan_lineage_mismatch' using errcode = '22023';
end
$$;

revoke all on function public.consume_resume_authorization_and_create_request_v4(uuid,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.consume_resume_authorization_and_create_request_v4(uuid,text,uuid,jsonb)
  to service_role;

comment on function public.consume_resume_authorization_and_create_request_v4(uuid,text,uuid,jsonb) is
  'Atomically consumes a human resume authorization through V3 admission while preserving source root, explicit parent and monotone attempt lineage.';

commit;
