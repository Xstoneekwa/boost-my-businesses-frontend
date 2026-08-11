-- Device-level recurring schedule allocator collision prevention v1.
-- Canonical durable source remains public.account_assignments.

create or replace function public.recurring_daily_windows_overlap_v1(
  p_left_starts_at timestamptz,
  p_left_ends_at timestamptz,
  p_right_starts_at timestamptz,
  p_right_ends_at timestamptz,
  p_timezone text
) returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_timezone text := coalesce(nullif(trim(p_timezone), ''), 'Africa/Johannesburg');
  v_left_start integer;
  v_left_end integer;
  v_right_start integer;
  v_right_end integer;
begin
  if p_left_starts_at is null or p_left_ends_at is null
     or p_right_starts_at is null or p_right_ends_at is null
     or p_left_ends_at <= p_left_starts_at
     or p_right_ends_at <= p_right_starts_at
     or p_left_ends_at - p_left_starts_at > interval '24 hours'
     or p_right_ends_at - p_right_starts_at > interval '24 hours' then
    return false;
  end if;

  v_left_start := extract(hour from (p_left_starts_at at time zone v_timezone))::integer * 60
    + extract(minute from (p_left_starts_at at time zone v_timezone))::integer;
  v_left_end := extract(hour from (p_left_ends_at at time zone v_timezone))::integer * 60
    + extract(minute from (p_left_ends_at at time zone v_timezone))::integer;
  v_right_start := extract(hour from (p_right_starts_at at time zone v_timezone))::integer * 60
    + extract(minute from (p_right_starts_at at time zone v_timezone))::integer;
  v_right_end := extract(hour from (p_right_ends_at at time zone v_timezone))::integer * 60
    + extract(minute from (p_right_ends_at at time zone v_timezone))::integer;

  if v_left_end <= v_left_start then v_left_end := v_left_end + 1440; end if;
  if v_right_end <= v_right_start then v_right_end := v_right_end + 1440; end if;

  return (v_left_start < v_right_end and v_right_start < v_left_end)
      or (v_left_start < v_right_end + 1440 and v_right_start + 1440 < v_left_end)
      or (v_left_start < v_right_end - 1440 and v_right_start - 1440 < v_left_end);
end;
$$;

create or replace function public.find_device_recurring_assignment_conflict_v1(
  p_assignment_id uuid,
  p_device_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_conflict_id uuid;
begin
  select pd.timezone into v_timezone
  from public.phone_devices pd
  where pd.id = p_device_id;

  if v_timezone is null then return null; end if;

  select aa.id into v_conflict_id
  from public.account_assignments aa
  where aa.device_id = p_device_id
    and aa.id <> coalesce(p_assignment_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and aa.released_at is null
    and aa.status in ('pending', 'reserved', 'active')
    and aa.schedule_mode = 'scheduled'
    and public.recurring_daily_windows_overlap_v1(
      p_starts_at, p_ends_at, aa.starts_at, aa.ends_at, v_timezone
    )
  order by aa.created_at asc, aa.id asc
  limit 1;

  return v_conflict_id;
end;
$$;

create or replace function public.enforce_device_recurring_assignment_exclusivity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conflict_id uuid;
begin
  if new.released_at is not null
     or new.status not in ('pending', 'reserved', 'active')
     or new.schedule_mode <> 'scheduled' then
    return new;
  end if;

  if new.device_id is null or new.starts_at is null or new.ends_at is null then
    raise exception 'invalid_assignment_payload';
  end if;

  -- The physical phone row is the single transactional allocator mutex.
  perform 1 from public.phone_devices pd where pd.id = new.device_id for update;
  if not found then raise exception 'device_unavailable'; end if;

  v_conflict_id := public.find_device_recurring_assignment_conflict_v1(
    new.id, new.device_id, new.starts_at, new.ends_at
  );
  if v_conflict_id is not null then
    raise exception 'assignment_recurring_slot_conflict';
  end if;

  return new;
end;
$$;

drop trigger if exists account_assignments_device_recurring_exclusivity_v1 on public.account_assignments;
create trigger account_assignments_device_recurring_exclusivity_v1
before insert or update of device_id, starts_at, ends_at, status, schedule_mode, released_at
on public.account_assignments
for each row execute function public.enforce_device_recurring_assignment_exclusivity_v1();

alter function public.list_available_assignment_slots(uuid, uuid, text, date)
  rename to list_available_assignment_slots_absolute_legacy_v1;

create or replace function public.list_available_assignment_slots(
  p_account_id uuid,
  p_device_id uuid default null,
  p_assignment_type text default null,
  p_slot_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_device_id uuid;
  v_slot jsonb;
  v_slots jsonb := '[]'::jsonb;
  v_conflict_id uuid;
  v_occupied_by text;
  v_current_assignment_id uuid;
  v_current_instance_reusable boolean := false;
begin
  v_payload := public.list_available_assignment_slots_absolute_legacy_v1(
    p_account_id, p_device_id, p_assignment_type, p_slot_date
  );
  if coalesce((v_payload ->> 'ok')::boolean, false) is not true then return v_payload; end if;

  v_device_id := nullif(v_payload ->> 'device_id', '')::uuid;
  select aa.id into v_current_assignment_id
  from public.account_assignments aa
  where aa.account_id = p_account_id
    and aa.released_at is null
    and aa.status in ('pending', 'reserved', 'active')
  order by aa.created_at desc
  limit 1;
  select exists (
    select 1 from public.phone_app_instances pai
    where pai.device_id = v_device_id
      and pai.current_account_id = p_account_id
      and pai.status = 'occupied'
      and pai.usable_for_auto_login
      and pai.is_launchable
  ) into v_current_instance_reusable;

  for v_slot in select value from jsonb_array_elements(coalesce(v_payload -> 'slots', '[]'::jsonb))
  loop
    v_conflict_id := public.find_device_recurring_assignment_conflict_v1(
      v_current_assignment_id, v_device_id, (v_slot ->> 'starts_at')::timestamptz, (v_slot ->> 'ends_at')::timestamptz
    );
    if v_conflict_id is not null then
      select coalesce(nullif(trim(ia.username), ''), 'assigned account')
      into v_occupied_by
      from public.account_assignments aa
      left join public.ig_accounts ia on ia.id = aa.account_id
      where aa.id = v_conflict_id;
      v_slot := jsonb_set(jsonb_set(jsonb_set(v_slot, '{available}', 'false'::jsonb),
        '{reason}', to_jsonb('recurring_occupied'::text)),
        '{occupied_by}', to_jsonb(coalesce(v_occupied_by, 'assigned account')));
    elsif v_current_instance_reusable and v_slot ->> 'reason' = 'no_app_instance_available' then
      v_slot := jsonb_set(jsonb_set(v_slot, '{available}', 'true'::jsonb),
        '{reason}', to_jsonb('current_instance_reusable'::text));
    end if;
    v_slots := v_slots || jsonb_build_array(v_slot);
  end loop;

  return jsonb_set(
    jsonb_set(v_payload, '{slots}', v_slots),
    '{device_level_recurring_exclusivity}', 'true'::jsonb
  );
end;
$$;

create or replace function public.reconcile_account_assignment_schedule_v1(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment record;
  v_device record;
  v_payload jsonb;
  v_slot jsonb;
  v_result jsonb;
begin
  select aa.* into v_assignment
  from public.account_assignments aa
  where aa.account_id = p_account_id
    and aa.released_at is null
    and aa.status in ('pending', 'reserved', 'active')
  order by aa.created_at desc limit 1;

  if v_assignment.id is null then
    return jsonb_build_object('ok', false, 'reason', 'assignment_missing');
  end if;

  for v_device in
    select pd.id
    from public.phone_devices pd
    where pd.status in ('available', 'active')
      and pd.pool_type in (v_assignment.assignment_type, 'shared')
    order by case when pd.id = v_assignment.device_id then 0 else 1 end, pd.created_at asc
  loop
    v_payload := public.list_available_assignment_slots(
      p_account_id, v_device.id, v_assignment.assignment_type, null
    );
    for v_slot in
      select value from jsonb_array_elements(coalesce(v_payload -> 'slots', '[]'::jsonb))
      where coalesce((value ->> 'available')::boolean, false)
      order by (value ->> 'slot_index')::integer
    loop
      begin
        v_result := public.assign_account_slot(
          p_account_id,
          v_device.id,
          (v_slot ->> 'starts_at')::timestamptz,
          (v_slot ->> 'ends_at')::timestamptz,
          case when v_device.id = v_assignment.device_id then v_assignment.app_instance_id else null end,
          'ops',
          null
        );
        return v_result || jsonb_build_object('reconciled', true, 'reason', 'safe_slot_assigned');
      exception
        when others then
          if sqlerrm not like '%assignment_recurring_slot_conflict%'
             and sqlerrm not like '%assignment_slot_conflict%'
             and sqlerrm not like '%no_app_instance_available%' then
            raise;
          end if;
      end;
    end loop;
  end loop;

  return jsonb_build_object('ok', false, 'reason', 'NO_SAFE_PHONE_SCHEDULE_SLOT');
end;
$$;

comment on function public.recurring_daily_windows_overlap_v1(timestamptz,timestamptz,timestamptz,timestamptz,text)
  is 'Compares two daily recurring local-time windows on a physical phone; dates are intentionally ignored.';
comment on function public.list_available_assignment_slots(uuid,uuid,text,date)
  is 'Canonical device-level recurring slot catalog derived from current open account_assignments across every clone.';
comment on function public.reconcile_account_assignment_schedule_v1(uuid)
  is 'Generic fail-closed repair path using the same device-level slot catalog and atomic assignment RPC as onboarding.';

revoke all on function public.recurring_daily_windows_overlap_v1(timestamptz,timestamptz,timestamptz,timestamptz,text) from public, anon, authenticated;
revoke all on function public.find_device_recurring_assignment_conflict_v1(uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.enforce_device_recurring_assignment_exclusivity_v1() from public, anon, authenticated, service_role;
revoke all on function public.list_available_assignment_slots_absolute_legacy_v1(uuid,uuid,text,date) from public, anon, authenticated, service_role;
revoke all on function public.list_available_assignment_slots(uuid,uuid,text,date) from public, anon, authenticated;
revoke all on function public.reconcile_account_assignment_schedule_v1(uuid) from public, anon, authenticated;
grant execute on function public.list_available_assignment_slots(uuid,uuid,text,date) to service_role;
grant execute on function public.reconcile_account_assignment_schedule_v1(uuid) to service_role;
