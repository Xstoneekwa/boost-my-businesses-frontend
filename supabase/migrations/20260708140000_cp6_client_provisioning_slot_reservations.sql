-- CP6 — Client provisioning slot reservations (30-minute future capacity promise).
-- Not a CP3 lease, not an account_run_request, not a Scheduler session.

create extension if not exists btree_gist;

create table if not exists public.client_provisioning_slot_reservations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  client_id uuid not null references public.clients (id) on delete cascade,
  client_instagram_account_id uuid not null references public.client_instagram_accounts (id) on delete cascade,
  ig_account_id uuid not null references public.ig_accounts (id) on delete cascade,
  assignment_id uuid not null references public.account_assignments (id) on delete cascade,
  device_id uuid not null references public.phone_devices (id) on delete cascade,
  app_instance_id uuid not null references public.phone_app_instances (id) on delete cascade,
  expected_package text not null default '',

  window_start_utc timestamptz not null,
  window_end_utc timestamptz not null,
  expires_at timestamptz not null,

  status text not null default 'reserved',
  reservation_source text not null default 'client_connect',
  assisted_connect_requested_at timestamptz null,
  dedupe_key text not null,
  safe_metadata jsonb not null default '{}'::jsonb,

  constraint client_provisioning_slot_reservations_status_check
    check (status in (
      'reserved',
      'window_open',
      'assisted_requested',
      'consumed',
      'expired',
      'cancelled',
      'invalidated'
    )),
  constraint client_provisioning_slot_reservations_window_order_check
    check (window_end_utc > window_start_utc),
  constraint client_provisioning_slot_reservations_expires_check
    check (expires_at >= window_end_utc),
  constraint client_provisioning_slot_reservations_dedupe_nonempty
    check (char_length(trim(dedupe_key)) > 0),
  constraint client_provisioning_slot_reservations_metadata_object_check
    check (jsonb_typeof(safe_metadata) = 'object')
);

-- One active reservation per client Instagram account.
create unique index if not exists client_provisioning_slot_reservations_active_account_uidx
  on public.client_provisioning_slot_reservations (client_instagram_account_id)
  where status in ('reserved', 'window_open', 'assisted_requested');

-- Atomic anti-overlap on device capacity (phone-level exclusivity for provisioning windows).
alter table public.client_provisioning_slot_reservations
  drop constraint if exists client_provisioning_slot_reservations_device_window_excl;

alter table public.client_provisioning_slot_reservations
  add constraint client_provisioning_slot_reservations_device_window_excl
  exclude using gist (
    device_id with =,
    tstzrange(window_start_utc, window_end_utc, '[)') with &&
  )
  where (status in ('reserved', 'window_open', 'assisted_requested'));

create index if not exists client_provisioning_slot_reservations_device_window_idx
  on public.client_provisioning_slot_reservations (device_id, window_start_utc, window_end_utc)
  where status in ('reserved', 'window_open', 'assisted_requested');

create index if not exists client_provisioning_slot_reservations_ig_account_status_idx
  on public.client_provisioning_slot_reservations (ig_account_id, status, window_start_utc desc);

create index if not exists client_provisioning_slot_reservations_expires_at_idx
  on public.client_provisioning_slot_reservations (expires_at)
  where status in ('reserved', 'window_open', 'assisted_requested');

drop trigger if exists client_provisioning_slot_reservations_set_updated_at
  on public.client_provisioning_slot_reservations;
create trigger client_provisioning_slot_reservations_set_updated_at
  before update on public.client_provisioning_slot_reservations
  for each row execute function public.set_updated_at();

alter table public.client_provisioning_slot_reservations enable row level security;

do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'client_provisioning_slot_reservations'
      and policyname = 'client_provisioning_slot_reservations_service_role_all'
  ) then
    create policy client_provisioning_slot_reservations_service_role_all
      on public.client_provisioning_slot_reservations for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end
$policy$;

revoke all on table public.client_provisioning_slot_reservations from public, anon, authenticated;
grant all on table public.client_provisioning_slot_reservations to service_role;

-- =============================================================================
-- Expire stale reservations (logical release only — no lease/run side effects).
-- =============================================================================
create or replace function public.expire_client_provisioning_slot_reservations(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  update public.client_provisioning_slot_reservations
  set status = 'expired',
      updated_at = p_now
  where status in ('reserved', 'window_open', 'assisted_requested')
    and expires_at <= p_now;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'expired_count', v_count);
end;
$$;

revoke all on function public.expire_client_provisioning_slot_reservations(timestamptz) from public, anon, authenticated;
grant execute on function public.expire_client_provisioning_slot_reservations(timestamptz) to service_role;

-- =============================================================================
-- Reserve a 30-minute provisioning window (atomic insert / idempotent return).
-- =============================================================================
create or replace function public.reserve_client_provisioning_slot(
  p_client_id uuid,
  p_client_instagram_account_id uuid,
  p_ig_account_id uuid,
  p_assignment_id uuid,
  p_device_id uuid,
  p_app_instance_id uuid,
  p_expected_package text,
  p_window_start_utc timestamptz,
  p_reservation_source text default 'client_connect',
  p_dedupe_key text default null,
  p_safe_metadata jsonb default '{}'::jsonb
)
returns public.client_provisioning_slot_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.client_provisioning_slot_reservations;
  v_dedupe text;
  v_window_end timestamptz;
  v_row public.client_provisioning_slot_reservations;
begin
  perform public.expire_client_provisioning_slot_reservations(now());

  select *
  into v_existing
  from public.client_provisioning_slot_reservations r
  where r.client_instagram_account_id = p_client_instagram_account_id
    and r.status in ('reserved', 'window_open', 'assisted_requested')
  order by r.created_at desc
  limit 1;

  if found then
    return v_existing;
  end if;

  v_dedupe := coalesce(nullif(trim(p_dedupe_key), ''), format('client_provisioning:%s', p_client_instagram_account_id));
  v_window_end := p_window_start_utc + interval '30 minutes';

  insert into public.client_provisioning_slot_reservations (
    client_id,
    client_instagram_account_id,
    ig_account_id,
    assignment_id,
    device_id,
    app_instance_id,
    expected_package,
    window_start_utc,
    window_end_utc,
    expires_at,
    status,
    reservation_source,
    dedupe_key,
    safe_metadata
  ) values (
    p_client_id,
    p_client_instagram_account_id,
    p_ig_account_id,
    p_assignment_id,
    p_device_id,
    p_app_instance_id,
    coalesce(p_expected_package, ''),
    p_window_start_utc,
    v_window_end,
    v_window_end,
    case when p_window_start_utc <= now() then 'window_open' else 'reserved' end,
    coalesce(nullif(trim(p_reservation_source), ''), 'client_connect'),
    v_dedupe,
    coalesce(p_safe_metadata, '{}'::jsonb)
  )
  returning * into v_row;

  return v_row;
exception
  when exclusion_violation then
    raise exception 'provisioning_slot_device_overlap' using errcode = 'P0001';
  when unique_violation then
    select *
    into v_existing
    from public.client_provisioning_slot_reservations r
    where r.client_instagram_account_id = p_client_instagram_account_id
      and r.status in ('reserved', 'window_open', 'assisted_requested')
    order by r.created_at desc
    limit 1;
    if found then
      return v_existing;
    end if;
    raise;
end;
$$;

revoke all on function public.reserve_client_provisioning_slot(
  uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.reserve_client_provisioning_slot(
  uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, text, jsonb
) to service_role;

-- =============================================================================
-- Mark reservation consumed after a real Connect enqueue succeeds.
-- =============================================================================
create or replace function public.consume_client_provisioning_slot_reservation(
  p_reservation_id uuid,
  p_ig_account_id uuid
)
returns public.client_provisioning_slot_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.client_provisioning_slot_reservations;
begin
  update public.client_provisioning_slot_reservations
  set status = 'consumed',
      updated_at = now()
  where id = p_reservation_id
    and ig_account_id = p_ig_account_id
    and status in ('reserved', 'window_open', 'assisted_requested')
  returning * into v_row;

  if not found then
    raise exception 'provisioning_slot_reservation_not_consumable' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

revoke all on function public.consume_client_provisioning_slot_reservation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_client_provisioning_slot_reservation(uuid, uuid) to service_role;

-- =============================================================================
-- Assisted connect request marker on reservation.
-- =============================================================================
create or replace function public.mark_client_provisioning_assisted_requested(
  p_reservation_id uuid,
  p_ig_account_id uuid
)
returns public.client_provisioning_slot_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.client_provisioning_slot_reservations;
begin
  update public.client_provisioning_slot_reservations
  set status = 'assisted_requested',
      assisted_connect_requested_at = coalesce(assisted_connect_requested_at, now()),
      updated_at = now()
  where id = p_reservation_id
    and ig_account_id = p_ig_account_id
    and status in ('reserved', 'window_open', 'assisted_requested')
  returning * into v_row;

  if not found then
    raise exception 'provisioning_slot_reservation_not_assistable' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

revoke all on function public.mark_client_provisioning_assisted_requested(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_client_provisioning_assisted_requested(uuid, uuid) to service_role;
