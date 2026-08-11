create role anon;
create role authenticated;
create role service_role;
create extension if not exists pgcrypto;
create schema if not exists public;

create table public.phone_devices (
  id uuid primary key,
  timezone text not null default 'Africa/Johannesburg',
  status text not null default 'active',
  pool_type text not null default 'full_cycle',
  created_at timestamptz not null default now()
);
create table public.ig_accounts (id uuid primary key, username text);
create table public.phone_app_instances (
  id uuid primary key,
  device_id uuid not null references public.phone_devices(id),
  current_account_id uuid,
  status text not null,
  usable_for_auto_login boolean not null default true,
  is_launchable boolean not null default true
);
create table public.account_assignments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  device_id uuid not null references public.phone_devices(id),
  app_instance_id uuid,
  assignment_type text not null default 'full_cycle',
  released_at timestamptz,
  status text not null,
  schedule_mode text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create function public.list_available_assignment_slots(
  p_account_id uuid, p_device_id uuid default null, p_assignment_type text default null, p_slot_date date default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_date date := coalesce(p_slot_date, date '2026-08-11'); v_slots jsonb := '[]'; v_i int; v_start timestamptz; v_end timestamptz;
begin
  for v_i in 0..3 loop
    v_start := ((v_date::text || ' 00:00 Africa/Johannesburg')::timestamptz + make_interval(hours => v_i * 6));
    v_end := v_start + interval '6 hours';
    v_slots := v_slots || jsonb_build_array(jsonb_build_object(
      'slot_index', v_i + 1, 'starts_at', v_start, 'ends_at', v_end,
      'available', true, 'reason', null, 'occupied_by', null
    ));
  end loop;
  return jsonb_build_object('ok',true,'device_id',p_device_id,'slots',v_slots);
end $$;

create function public.assign_account_slot(
  p_account_id uuid, p_device_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_clone_id uuid default null, p_assignment_source text default 'manual_dashboard', p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_id uuid;
begin
  select id into v_id from public.account_assignments where account_id=p_account_id and released_at is null limit 1;
  if v_id is null then
    insert into public.account_assignments(account_id,device_id,app_instance_id,status,schedule_mode,starts_at,ends_at)
    values(p_account_id,p_device_id,p_clone_id,'reserved','scheduled',p_starts_at,p_ends_at) returning id into v_id;
  else
    update public.account_assignments set device_id=p_device_id,app_instance_id=coalesce(p_clone_id,app_instance_id),
      starts_at=p_starts_at,ends_at=p_ends_at,status='reserved',schedule_mode='scheduled' where id=v_id;
  end if;
  return jsonb_build_object('ok',true,'assignment_id',v_id,'starts_at',p_starts_at,'ends_at',p_ends_at);
end $$;

\ir ../migrations/20260811150000_device_level_schedule_allocator_collision_prevention_v1.sql

do $$
declare
  phone_a uuid := '10000000-0000-0000-0000-000000000001';
  account_a uuid := '20000000-0000-0000-0000-000000000001';
  account_b uuid := '20000000-0000-0000-0000-000000000002';
  clone_a uuid := '30000000-0000-0000-0000-000000000001';
  clone_b uuid := '30000000-0000-0000-0000-000000000002';
  payload jsonb;
begin
  if not public.recurring_daily_windows_overlap_v1(
    '2026-08-10 22:00Z','2026-08-11 04:00Z','2026-08-11 22:00Z','2026-08-12 04:00Z','Africa/Johannesburg'
  ) then raise exception 'same recurring slot on different dates must overlap'; end if;
  if public.recurring_daily_windows_overlap_v1(
    '2026-08-11 16:00Z','2026-08-11 22:00Z','2026-08-11 22:00Z','2026-08-12 04:00Z','Africa/Johannesburg'
  ) then raise exception '18-00 and 00-06 boundary must not overlap'; end if;
  if not public.recurring_daily_windows_overlap_v1(
    '2026-08-11 21:00Z','2026-08-11 23:00Z','2026-08-11 22:00Z','2026-08-12 00:00Z','Africa/Johannesburg'
  ) then raise exception 'cross-midnight overlap was missed'; end if;

  insert into public.phone_devices(id) values(phone_a);
  insert into public.ig_accounts(id,username) values(account_a,'account_a'),(account_b,'account_b');
  insert into public.phone_app_instances(id,device_id,current_account_id,status) values
    (clone_a,phone_a,account_a,'occupied'),(clone_b,phone_a,account_b,'occupied');
  insert into public.account_assignments(account_id,device_id,app_instance_id,status,schedule_mode,starts_at,ends_at)
  values(account_a,phone_a,clone_a,'reserved','scheduled','2026-08-10 22:00Z','2026-08-11 04:00Z');

  begin
    insert into public.account_assignments(account_id,device_id,app_instance_id,status,schedule_mode,starts_at,ends_at)
    values(account_b,phone_a,clone_b,'reserved','scheduled','2026-08-11 22:00Z','2026-08-12 04:00Z');
    raise exception 'different clone on same phone bypassed recurring exclusivity';
  exception when others then
    if sqlerrm not like '%assignment_recurring_slot_conflict%' then raise; end if;
  end;

  update public.account_assignments set starts_at='2026-08-11 04:00Z',ends_at='2026-08-11 10:00Z' where account_id=account_a;
  payload := public.list_available_assignment_slots(account_b,phone_a,'full_cycle','2026-08-11');
  if coalesce((payload#>>'{slots,0,available}')::boolean,false) is not true then
    raise exception 'manual move did not free old 00-06 slot';
  end if;
  if coalesce((payload#>>'{slots,1,available}')::boolean,true) is not false then
    raise exception 'manual move did not occupy new 06-12 slot';
  end if;

  update public.account_assignments set status='released',released_at=now() where account_id=account_a;
  if public.find_device_recurring_assignment_conflict_v1(null,phone_a,'2026-08-11 04:00Z','2026-08-11 10:00Z') is not null then
    raise exception 'released assignment still blocks capacity';
  end if;
end $$;

select 'device_level_schedule_allocator_v1_ok';
