-- CP0 — Single Scheduler toggle governs every automatic run request.
--
-- auto_restart_settings.auto_restart_enabled is the only business
-- authorization for automatic account_run_requests. This guard is enforced
-- atomically inside create_account_run_request for the automatic source
-- surfaces (schedule_session_cron daily starts + auto_restart resumes):
-- the settings row is locked FOR SHARE before the insert, so a concurrent
-- toggle OFF (row UPDATE) serializes against automatic inserts and no
-- automatic request can slip through the OFF transition.
--
-- Manual runs, Auto Login, login provisioning and code-resume surfaces are
-- intentionally NOT gated: Scheduler OFF must never block explicit operator
-- or client actions.
--
-- Rejection is a stable reason: raise exception 'scheduler_disabled'.

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
  v_resume_action_id text;
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

  -- CP0 atomic guard: automatic scheduler sources require the canonical
  -- Scheduler toggle to be ON. FOR SHARE serializes against a concurrent
  -- toggle update; a missing settings row fails closed.
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
