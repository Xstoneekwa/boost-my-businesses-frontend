CREATE OR REPLACE FUNCTION public.evaluate_account_schedule_gate(p_account_id uuid, p_requested_run_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid := p_account_id;
  v_requested_run_type text := nullif(lower(trim(p_requested_run_type)), '');
  v_assignment record;
  v_device record;
  v_now timestamptz := now();
  v_window_active boolean;
  v_phone_rest_active boolean;
  v_outreach_rest_reserved boolean;
  v_next_slot timestamptz;
  v_reason text := null;
  v_ok boolean := true;
  v_technical_run_types text[] := array[
    'check_login',
    'login_check',
    'login_provisioning',
    'login_email_code_resume',
    'reconnect_instagram',
    'credential_verification',
    'provisioning_only',
    'account_status_check'
  ];
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'assignment_missing');
  end if;

  select
    aa.id,
    aa.device_id,
    aa.clone_id,
    aa.app_instance_id,
    aa.assignment_type,
    aa.slot_kind,
    aa.schedule_mode,
    aa.status,
    aa.starts_at,
    aa.ends_at,
    aa.assignment_source
  into v_assignment
  from public.account_assignments aa
  where aa.account_id = v_account_id
    and aa.status in ('pending', 'reserved', 'active')
  order by aa.created_at desc
  limit 1;

  if v_assignment.id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'assignment_missing',
      'window_active', false,
      'phone_rest_active', false,
      'next_eligible_starts_at', null
    );
  end if;

  select pd.id, pd.name, pd.status, pd.timezone, pd.pool_type
  into v_device
  from public.phone_devices pd
  where pd.id = v_assignment.device_id;

  if v_device.id is null or v_device.status not in ('available', 'active', 'online', 'occupied') then
    return jsonb_build_object(
      'ok', false,
      'reason', 'device_unavailable',
      'assignment_id', v_assignment.id,
      'app_instance_id', v_assignment.app_instance_id,
      'schedule_mode', v_assignment.schedule_mode,
      'window_active', false,
      'phone_rest_active', false,
      'next_eligible_starts_at', null
    );
  end if;

  if v_requested_run_type = any(v_technical_run_types) then
    return jsonb_build_object(
      'ok', true,
      'reason', 'technical_run_allowed_outside_campaign_window',
      'assignment_id', v_assignment.id,
      'clone_id', v_assignment.clone_id,
      'app_instance_id', v_assignment.app_instance_id,
      'assignment_type', v_assignment.assignment_type,
      'slot_kind', v_assignment.slot_kind,
      'schedule_mode', v_assignment.schedule_mode,
      'starts_at', v_assignment.starts_at,
      'ends_at', v_assignment.ends_at,
      'assignment_source', v_assignment.assignment_source,
      'device_id', v_assignment.device_id,
      'device_label', v_device.name,
      'device_timezone', v_device.timezone,
      'window_active', false,
      'phone_rest_active', false,
      'next_eligible_starts_at', null
    );
  end if;

  if v_assignment.schedule_mode = 'manual_only' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'manual_only_runtime_disabled',
      'assignment_id', v_assignment.id,
      'clone_id', v_assignment.clone_id,
      'app_instance_id', v_assignment.app_instance_id,
      'assignment_type', v_assignment.assignment_type,
      'slot_kind', v_assignment.slot_kind,
      'schedule_mode', v_assignment.schedule_mode,
      'starts_at', null,
      'ends_at', null,
      'assignment_source', v_assignment.assignment_source,
      'device_id', v_assignment.device_id,
      'device_label', v_device.name,
      'device_timezone', v_device.timezone,
      'window_active', false,
      'phone_rest_active', false,
      'next_eligible_starts_at', null
    );
  end if;

  if v_requested_run_type = 'account_session' and v_assignment.assignment_type = 'outreach_only' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'assignment_profile_mismatch',
      'assignment_id', v_assignment.id,
      'app_instance_id', v_assignment.app_instance_id,
      'schedule_mode', v_assignment.schedule_mode,
      'window_active', false,
      'phone_rest_active', false,
      'next_eligible_starts_at', null
    );
  end if;

  if exists (
    select 1
    from public.account_assignments aa
    where aa.device_id = v_assignment.device_id
      and aa.account_id <> v_account_id
      and aa.id <> v_assignment.id
      and aa.status in ('pending', 'reserved', 'active')
      and aa.schedule_mode = 'scheduled'
      and tstzrange(aa.starts_at, aa.ends_at, '[)') && tstzrange(v_assignment.starts_at, v_assignment.ends_at, '[)')
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'assignment_slot_conflict',
      'assignment_id', v_assignment.id,
      'app_instance_id', v_assignment.app_instance_id,
      'schedule_mode', v_assignment.schedule_mode,
      'window_active', false,
      'phone_rest_active', false,
      'next_eligible_starts_at', null
    );
  end if;

  v_window_active := v_assignment.starts_at <= v_now and v_now < v_assignment.ends_at;
  v_phone_rest_active := public.slot_overlaps_phone_rest(
    v_assignment.device_id,
    v_now,
    v_now + interval '1 minute',
    coalesce(v_device.timezone, 'UTC')
  );
  v_outreach_rest_reserved := v_assignment.assignment_type = 'outreach_only'
    and public.slot_reserved_for_outreach_rest(
      v_assignment.device_id,
      ((extract(hour from (v_assignment.starts_at at time zone coalesce(v_device.timezone, 'UTC')))::integer * 60
        + extract(minute from (v_assignment.starts_at at time zone coalesce(v_device.timezone, 'UTC')))::integer) / 40) + 1
    );

  if v_phone_rest_active then
    v_ok := false;
    v_reason := 'phone_rest_active';
  elsif v_outreach_rest_reserved then
    v_ok := false;
    v_reason := 'outreach_rest_reserved';
  elsif not v_window_active then
    v_ok := false;
    v_reason := 'assignment_window_closed';
  end if;

  if not v_ok then
    select min(slot.starts_at)
    into v_next_slot
    from public.generate_assignment_slot_catalog(
      v_assignment.assignment_type,
      (v_now at time zone coalesce(v_device.timezone, 'UTC'))::date,
      coalesce(v_device.timezone, 'UTC')
    ) as slot
    where slot.starts_at > v_now
      and not exists (
        select 1
        from public.account_assignments aa
        where aa.device_id = v_assignment.device_id
          and aa.account_id <> v_account_id
          and aa.status in ('pending', 'reserved', 'active')
          and aa.schedule_mode = 'scheduled'
          and tstzrange(aa.starts_at, aa.ends_at, '[)') && tstzrange(slot.starts_at, slot.ends_at, '[)')
      )
      and not public.slot_overlaps_phone_rest(
        v_assignment.device_id,
        slot.starts_at,
        slot.ends_at,
        coalesce(v_device.timezone, 'UTC')
      )
      and not (
        v_assignment.assignment_type = 'outreach_only'
        and public.slot_reserved_for_outreach_rest(v_assignment.device_id, slot.slot_index)
      );
  end if;

  return jsonb_build_object(
    'ok', v_ok,
    'reason', coalesce(v_reason, 'assignment_window_open'),
    'assignment_id', v_assignment.id,
    'clone_id', v_assignment.clone_id,
    'app_instance_id', v_assignment.app_instance_id,
    'assignment_type', v_assignment.assignment_type,
    'slot_kind', v_assignment.slot_kind,
    'schedule_mode', v_assignment.schedule_mode,
    'starts_at', v_assignment.starts_at,
    'ends_at', v_assignment.ends_at,
    'assignment_source', v_assignment.assignment_source,
    'device_id', v_assignment.device_id,
    'device_label', v_device.name,
    'device_timezone', v_device.timezone,
    'window_active', v_window_active,
    'phone_rest_active', v_phone_rest_active,
    'next_eligible_starts_at', v_next_slot
  );
end;
$function$;
