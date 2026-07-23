-- Auto Login app-instance binding v1.
--
-- Resolve the Android app instance atomically from the canonical assignment
-- when a login request is created.  The resulting metadata is immutable for
-- that request and is later verified fail-closed by the Worker before launch.

create or replace function public.create_account_run_request(
  p_account_id uuid,
  p_requested_by uuid default null::uuid,
  p_actor_type text default 'admin'::text,
  p_source_surface text default 'instagram_dashboard'::text,
  p_requested_run_type text default 'account_session'::text,
  p_idempotency_key text default null::text,
  p_priority integer default 0,
  p_metadata_safe jsonb default '{}'::jsonb
)
returns account_run_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_type text := lower(coalesce(nullif(trim(p_actor_type), ''), 'admin'));
  v_source_surface text := coalesce(nullif(trim(p_source_surface), ''), 'instagram_dashboard');
  v_requested_run_type text := lower(coalesce(nullif(trim(p_requested_run_type), ''), 'account_session'));
  v_idempotency_key text := coalesce(
    nullif(trim(p_idempotency_key), ''),
    'dashboard:' || p_account_id::text || ':' || gen_random_uuid()::text
  );
  v_metadata jsonb := coalesce(p_metadata_safe, '{}'::jsonb);
  v_existing public.account_run_requests;
  v_row public.account_run_requests;
  v_assignment public.account_assignments;
  v_app_instance public.phone_app_instances;
  v_parent_binding jsonb;
  v_resume_action_id text;
  v_parent_request_id text;
  v_scheduler_enabled boolean;
begin
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;

  if v_actor_type not in ('admin', 'assistant', 'ops', 'system', 'internal', 'client') then
    raise exception 'invalid_actor_type' using errcode = '22023';
  end if;

  if not public.run_control_metadata_is_safe(v_metadata) then
    raise exception 'metadata_forbidden_key' using errcode = '22023';
  end if;

  if v_requested_run_type = 'login_email_code_resume' then
    v_resume_action_id := coalesce(
      nullif(trim(v_metadata ->> 'action_id'), ''),
      nullif(trim(v_metadata ->> 'verification_action_id'), '')
    );
    if v_resume_action_id is null then
      raise exception 'login_resume_action_id_required' using errcode = '22023';
    end if;
  end if;

  select *
    into v_existing
  from public.account_run_requests arr
  where arr.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    return v_existing;
  end if;

  if v_source_surface in ('auto_restart_tick', 'instagram_schedule_session_cron') then
    select s.auto_restart_enabled
      into v_scheduler_enabled
    from public.auto_restart_settings s
    where s.id = 'global'
    for share;

    if not coalesce(v_scheduler_enabled, false) then
      raise exception 'scheduler_disabled' using errcode = '22023';
    end if;
  end if;

  if v_requested_run_type in ('login_provisioning', 'login_email_code_resume') then
    select aa.*
      into v_assignment
    from public.account_assignments aa
    where aa.account_id = p_account_id
      and aa.status in ('reserved', 'active')
    order by aa.created_at desc
    limit 1
    for share;

    if v_assignment.id is null then
      raise exception 'login_assignment_binding_missing' using errcode = '22023';
    end if;
    if v_assignment.app_instance_id is null then
      raise exception 'login_app_instance_binding_missing' using errcode = '22023';
    end if;

    select pai.*
      into v_app_instance
    from public.phone_app_instances pai
    where pai.id = v_assignment.app_instance_id
    for share;

    if v_app_instance.id is null then
      raise exception 'login_app_instance_binding_missing' using errcode = '22023';
    end if;
    if v_app_instance.device_id <> v_assignment.device_id then
      raise exception 'login_app_instance_device_mismatch' using errcode = '22023';
    end if;
    if nullif(trim(v_app_instance.package_name), '') is null
       or v_app_instance.package_name !~ '^[A-Za-z0-9_.]+$' then
      raise exception 'login_package_binding_missing' using errcode = '22023';
    end if;
    if not v_app_instance.is_launchable
       or not v_app_instance.usable_for_auto_login
       or v_app_instance.status not in ('available', 'active', 'occupied', 'reserved') then
      raise exception 'login_app_instance_unavailable' using errcode = '22023';
    end if;
    if v_app_instance.current_account_id is not null
       and v_app_instance.current_account_id <> p_account_id then
      raise exception 'login_app_instance_account_mismatch' using errcode = '22023';
    end if;

    -- Reject caller-provided routing that disagrees with the canonical rows.
    if nullif(trim(v_metadata ->> 'assignment_id'), '') is not null
       and v_metadata ->> 'assignment_id' <> v_assignment.id::text then
      raise exception 'login_assignment_binding_mismatch' using errcode = '22023';
    end if;
    if nullif(trim(v_metadata ->> 'device_id'), '') is not null
       and v_metadata ->> 'device_id' <> v_assignment.device_id::text then
      raise exception 'login_device_binding_mismatch' using errcode = '22023';
    end if;
    if nullif(trim(v_metadata ->> 'app_instance_id'), '') is not null
       and v_metadata ->> 'app_instance_id' <> v_app_instance.id::text then
      raise exception 'login_app_instance_binding_mismatch' using errcode = '22023';
    end if;
    if nullif(trim(v_metadata ->> 'package_name'), '') is not null
       and v_metadata ->> 'package_name' <> v_app_instance.package_name then
      raise exception 'login_package_binding_mismatch' using errcode = '22023';
    end if;
    if v_metadata ? 'clone_index' then
      if coalesce(v_metadata ->> 'clone_index', '') !~ '^[0-9]+$'
         or (v_metadata ->> 'clone_index')::integer <> v_app_instance.instance_index then
        raise exception 'login_clone_index_binding_mismatch' using errcode = '22023';
      end if;
    end if;

    v_metadata := v_metadata || jsonb_build_object(
      'binding_version', 'auto_login_app_instance_v1',
      'assignment_id', v_assignment.id,
      'device_id', v_assignment.device_id,
      'app_instance_id', v_app_instance.id,
      'package_name', v_app_instance.package_name,
      'clone_index', v_app_instance.instance_index
    );

    -- A verification-code resume must remain on the exact parent binding.
    if v_requested_run_type = 'login_email_code_resume' then
      v_parent_request_id := nullif(trim(v_metadata ->> 'parent_request_id'), '');
      if v_parent_request_id is not null then
        select arr.metadata_safe
          into v_parent_binding
        from public.account_run_requests arr
        where arr.id::text = v_parent_request_id
          and arr.account_id = p_account_id
          and arr.requested_run_type = 'login_provisioning'
        limit 1;

        if v_parent_binding is null
           or v_parent_binding ->> 'binding_version' <> 'auto_login_app_instance_v1'
           or nullif(trim(v_parent_binding ->> 'assignment_id'), '') is null
           or nullif(trim(v_parent_binding ->> 'device_id'), '') is null
           or nullif(trim(v_parent_binding ->> 'app_instance_id'), '') is null
           or nullif(trim(v_parent_binding ->> 'package_name'), '') is null
           or not (v_parent_binding ? 'clone_index') then
          raise exception 'login_parent_binding_missing' using errcode = '22023';
        end if;
        if v_parent_binding ->> 'assignment_id' <> v_metadata ->> 'assignment_id'
           or v_parent_binding ->> 'device_id' <> v_metadata ->> 'device_id'
           or v_parent_binding ->> 'app_instance_id' <> v_metadata ->> 'app_instance_id'
           or v_parent_binding ->> 'package_name' <> v_metadata ->> 'package_name'
           or (v_parent_binding ->> 'clone_index')::integer <> (v_metadata ->> 'clone_index')::integer then
          raise exception 'login_parent_binding_changed' using errcode = '22023';
        end if;
      end if;
    end if;
  end if;

  if v_requested_run_type not in ('login_provisioning', 'login_email_code_resume')
     and public.account_has_active_ig_run(p_account_id) then
    raise exception 'account_already_running' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.account_run_requests arr
    where arr.account_id = p_account_id
      and arr.status in ('queued', 'claimed', 'starting', 'running')
  ) then
    raise exception 'account_run_already_requested' using errcode = '22023';
  end if;

  insert into public.account_run_requests (
    account_id,
    requested_by,
    actor_type,
    source_surface,
    requested_run_type,
    status,
    priority,
    idempotency_key,
    metadata_safe
  )
  values (
    p_account_id,
    p_requested_by,
    v_actor_type,
    v_source_surface,
    v_requested_run_type,
    'queued',
    coalesce(p_priority, 0),
    v_idempotency_key,
    v_metadata
  )
  returning * into v_row;

  return v_row;
end;
$function$;
