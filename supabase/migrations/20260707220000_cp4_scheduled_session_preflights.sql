-- CP4: scheduled session preflight state + lease reservation handoff support.

create table if not exists public.scheduled_session_preflights (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.client_instagram_accounts(account_id) on delete cascade,
  assignment_id uuid not null,
  device_id uuid not null,
  app_instance_id uuid not null,
  expected_package text not null default '',
  expected_username text not null default '',
  scheduled_window_start timestamptz not null,
  scheduled_window_end timestamptz not null,
  business_action_deadline timestamptz not null,
  preflight_start timestamptz not null,
  status text not null default 'preflight_due',
  reason_code text null,
  checked_at timestamptz null,
  expires_at timestamptz not null,
  lease_id uuid null,
  request_id uuid null references public.account_run_requests(id) on delete set null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_session_preflights_status_check check (
    status in (
      'preflight_due',
      'preflight_running',
      'preflight_ready',
      'preflight_blocked',
      'preflight_lease_unavailable',
      'preflight_expired',
      'preflight_invalidated',
      'preflight_skipped_scheduler_off'
    )
  )
);

create unique index if not exists scheduled_session_preflights_assignment_window_uidx
  on public.scheduled_session_preflights (assignment_id, scheduled_window_start);

create index if not exists scheduled_session_preflights_device_status_idx
  on public.scheduled_session_preflights (device_id, status, expires_at);

create index if not exists scheduled_session_preflights_account_status_idx
  on public.scheduled_session_preflights (account_id, status);

alter table public.scheduled_session_preflights enable row level security;

do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'scheduled_session_preflights'
      and policyname = 'scheduled_session_preflights_service_role_all'
  ) then
    create policy scheduled_session_preflights_service_role_all
      on public.scheduled_session_preflights for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end
$policy$;

revoke all on table public.scheduled_session_preflights from public, anon, authenticated;
grant all on table public.scheduled_session_preflights to service_role;

create or replace function public.upsert_scheduled_session_preflight(
  p_account_id uuid,
  p_assignment_id uuid,
  p_device_id uuid,
  p_app_instance_id uuid,
  p_expected_package text,
  p_expected_username text,
  p_scheduled_window_start timestamptz,
  p_scheduled_window_end timestamptz,
  p_business_action_deadline timestamptz,
  p_preflight_start timestamptz,
  p_status text default 'preflight_due',
  p_reason_code text default null,
  p_expires_at timestamptz default null,
  p_metadata_safe jsonb default '{}'::jsonb
)
returns public.scheduled_session_preflights
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scheduled_session_preflights%rowtype;
  v_expires timestamptz := coalesce(p_expires_at, p_scheduled_window_start);
begin
  insert into public.scheduled_session_preflights (
    account_id, assignment_id, device_id, app_instance_id,
    expected_package, expected_username,
    scheduled_window_start, scheduled_window_end,
    business_action_deadline, preflight_start,
    status, reason_code, expires_at, metadata_safe, updated_at
  ) values (
    p_account_id, p_assignment_id, p_device_id, p_app_instance_id,
    coalesce(p_expected_package, ''), coalesce(p_expected_username, ''),
    p_scheduled_window_start, p_scheduled_window_end,
    p_business_action_deadline, p_preflight_start,
    coalesce(p_status, 'preflight_due'), p_reason_code, v_expires,
    coalesce(p_metadata_safe, '{}'::jsonb), now()
  )
  on conflict (assignment_id, scheduled_window_start) do update set
    device_id = excluded.device_id,
    app_instance_id = excluded.app_instance_id,
    expected_package = excluded.expected_package,
    expected_username = excluded.expected_username,
    scheduled_window_end = excluded.scheduled_window_end,
    business_action_deadline = excluded.business_action_deadline,
    preflight_start = excluded.preflight_start,
    status = case
      when scheduled_session_preflights.status in ('preflight_ready', 'preflight_running')
        then scheduled_session_preflights.status
      else excluded.status
    end,
    reason_code = case
      when scheduled_session_preflights.status in ('preflight_ready', 'preflight_running')
        then scheduled_session_preflights.reason_code
      else excluded.reason_code
    end,
    expires_at = excluded.expires_at,
    metadata_safe = scheduled_session_preflights.metadata_safe || excluded.metadata_safe,
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.bind_scheduled_session_preflight_request(
  p_preflight_id uuid,
  p_request_id uuid,
  p_lease_id uuid default null
)
returns public.scheduled_session_preflights
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scheduled_session_preflights%rowtype;
begin
  update public.scheduled_session_preflights
  set request_id = p_request_id,
      lease_id = coalesce(p_lease_id, lease_id),
      status = 'preflight_running',
      updated_at = now()
  where id = p_preflight_id
    and status in ('preflight_due', 'preflight_lease_unavailable')
  returning * into v_row;
  if not found then
    raise exception 'preflight_not_bindable';
  end if;
  return v_row;
end;
$$;

create or replace function public.complete_scheduled_session_preflight(
  p_preflight_id uuid,
  p_status text,
  p_reason_code text default null,
  p_checked_at timestamptz default now(),
  p_metadata_safe jsonb default '{}'::jsonb
)
returns public.scheduled_session_preflights
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scheduled_session_preflights%rowtype;
begin
  if p_status not in (
    'preflight_ready', 'preflight_blocked', 'preflight_expired',
    'preflight_invalidated', 'preflight_lease_unavailable'
  ) then
    raise exception 'invalid_preflight_terminal_status';
  end if;
  update public.scheduled_session_preflights
  set status = p_status,
      reason_code = p_reason_code,
      checked_at = coalesce(p_checked_at, now()),
      metadata_safe = metadata_safe || coalesce(p_metadata_safe, '{}'::jsonb),
      updated_at = now()
  where id = p_preflight_id
    and status in ('preflight_due', 'preflight_running')
  returning * into v_row;
  if not found then
    raise exception 'preflight_not_completable';
  end if;
  return v_row;
end;
$$;

create or replace function public.get_valid_scheduled_session_preflight(
  p_account_id uuid,
  p_assignment_id uuid,
  p_device_id uuid,
  p_app_instance_id uuid,
  p_expected_package text,
  p_scheduled_window_start timestamptz,
  p_scheduled_window_end timestamptz,
  p_now timestamptz default now()
)
returns public.scheduled_session_preflights
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scheduled_session_preflights%rowtype;
begin
  select * into v_row
  from public.scheduled_session_preflights
  where account_id = p_account_id
    and assignment_id = p_assignment_id
    and device_id = p_device_id
    and app_instance_id = p_app_instance_id
    and expected_package = coalesce(p_expected_package, '')
    and scheduled_window_start = p_scheduled_window_start
    and scheduled_window_end = p_scheduled_window_end
    and status = 'preflight_ready'
    and expires_at > p_now
  limit 1;
  return v_row;
end;
$$;

create or replace function public.handoff_preflight_device_lock_to_request(
  p_device_id uuid,
  p_preflight_request_id uuid,
  p_scheduler_request_id uuid,
  p_new_worker_id text,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer jsonb;
begin
  v_transfer := public.auto_restart_transfer_device_lock(
    p_device_id,
    p_preflight_request_id,
    p_new_worker_id,
    p_lease_seconds
  );
  if coalesce((v_transfer->>'ok')::boolean, false) is not true then
    return v_transfer;
  end if;
  update public.auto_restart_device_locks
  set request_id = p_scheduler_request_id,
      owner_kind = 'scheduler',
      operation_phase = 'queued',
      reason = 'scheduler_run',
      updated_at = now()
  where device_id = p_device_id
    and request_id = p_preflight_request_id;
  return jsonb_build_object('ok', true, 'transferred', true, 'request_id', p_scheduler_request_id);
end;
$$;

revoke all on function public.upsert_scheduled_session_preflight from public;
revoke all on function public.bind_scheduled_session_preflight_request from public;
revoke all on function public.complete_scheduled_session_preflight from public;
revoke all on function public.get_valid_scheduled_session_preflight from public;
revoke all on function public.handoff_preflight_device_lock_to_request from public;

grant execute on function public.upsert_scheduled_session_preflight to service_role;
grant execute on function public.bind_scheduled_session_preflight_request to service_role;
grant execute on function public.complete_scheduled_session_preflight to service_role;
grant execute on function public.get_valid_scheduled_session_preflight to service_role;
grant execute on function public.handoff_preflight_device_lock_to_request to service_role;
