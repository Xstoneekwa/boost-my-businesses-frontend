-- Auto Restart V1 execution: audit, tick idempotency, device locks, phone rest overrides.

create table if not exists public.auto_restart_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  idempotency_key text not null,
  actor text not null default 'system',
  account_id uuid null references public.ig_accounts (id) on delete set null,
  device_id uuid null,
  app_instance_id uuid null,
  business_session_id text null,
  prior_run_id uuid null,
  new_request_id uuid null,
  action text not null,
  decision text not null,
  reason text not null default '',
  mode text not null default 'disabled',
  restart_count_day integer not null default 0,
  restart_count_window integer not null default 0,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists auto_restart_decisions_created_at_idx
  on public.auto_restart_decisions (created_at desc);

create index if not exists auto_restart_decisions_account_created_idx
  on public.auto_restart_decisions (account_id, created_at desc);

create unique index if not exists auto_restart_decisions_idempotency_key_uidx
  on public.auto_restart_decisions (idempotency_key);

create table if not exists public.auto_restart_tick_locks (
  idempotency_key text primary key,
  worker_id text not null,
  tick_started_at timestamptz not null default now(),
  tick_completed_at timestamptz null,
  status text not null default 'started',
  metadata_safe jsonb not null default '{}'::jsonb,
  constraint auto_restart_tick_locks_status_check
    check (status in ('started', 'completed', 'failed'))
);

create table if not exists public.auto_restart_device_locks (
  device_id uuid primary key,
  worker_id text not null,
  account_id uuid null,
  app_instance_id uuid null,
  lease_expires_at timestamptz not null,
  reason text not null default 'auto_restart',
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists auto_restart_device_locks_lease_idx
  on public.auto_restart_device_locks (lease_expires_at);

create table if not exists public.phone_rest_overrides (
  device_id uuid primary key,
  status text not null default 'paused',
  reason text not null default 'operator_pause',
  updated_at timestamptz not null default now(),
  metadata_safe jsonb not null default '{}'::jsonb,
  constraint phone_rest_overrides_status_check
    check (status in ('paused', 'resumed'))
);

alter table public.auto_restart_decisions enable row level security;
alter table public.auto_restart_tick_locks enable row level security;
alter table public.auto_restart_device_locks enable row level security;
alter table public.phone_rest_overrides enable row level security;

do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'auto_restart_decisions'
      and policyname = 'auto_restart_decisions_service_role_all'
  ) then
    create policy auto_restart_decisions_service_role_all
      on public.auto_restart_decisions for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'auto_restart_tick_locks'
      and policyname = 'auto_restart_tick_locks_service_role_all'
  ) then
    create policy auto_restart_tick_locks_service_role_all
      on public.auto_restart_tick_locks for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'auto_restart_device_locks'
      and policyname = 'auto_restart_device_locks_service_role_all'
  ) then
    create policy auto_restart_device_locks_service_role_all
      on public.auto_restart_device_locks for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'phone_rest_overrides'
      and policyname = 'phone_rest_overrides_service_role_all'
  ) then
    create policy phone_rest_overrides_service_role_all
      on public.phone_rest_overrides for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end
$policy$;

revoke all on table public.auto_restart_decisions from public, anon, authenticated;
revoke all on table public.auto_restart_tick_locks from public, anon, authenticated;
revoke all on table public.auto_restart_device_locks from public, anon, authenticated;
revoke all on table public.phone_rest_overrides from public, anon, authenticated;
grant all on table public.auto_restart_decisions to service_role;
grant all on table public.auto_restart_tick_locks to service_role;
grant all on table public.auto_restart_device_locks to service_role;
grant all on table public.phone_rest_overrides to service_role;

create or replace function public.auto_restart_acquire_device_lock(
  p_device_id uuid,
  p_worker_id text,
  p_account_id uuid,
  p_app_instance_id uuid,
  p_lease_seconds integer default 900,
  p_reason text default 'auto_restart'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => greatest(p_lease_seconds, 30));
  v_existing public.auto_restart_device_locks%rowtype;
begin
  delete from public.auto_restart_device_locks
  where device_id = p_device_id
    and lease_expires_at <= v_now;

  select * into v_existing
  from public.auto_restart_device_locks
  where device_id = p_device_id
  for update;

  if found then
    if v_existing.worker_id = p_worker_id then
      update public.auto_restart_device_locks
      set lease_expires_at = v_expires,
          account_id = p_account_id,
          app_instance_id = p_app_instance_id,
          reason = coalesce(nullif(p_reason, ''), v_existing.reason),
          updated_at = v_now
      where device_id = p_device_id;
      return jsonb_build_object('ok', true, 'acquired', true, 'renewed', true);
    end if;
    return jsonb_build_object(
      'ok', false,
      'acquired', false,
      'reason', 'device_lock_held',
      'holder_worker_id', v_existing.worker_id
    );
  end if;

  insert into public.auto_restart_device_locks (
    device_id, worker_id, account_id, app_instance_id, lease_expires_at, reason
  ) values (
    p_device_id, p_worker_id, p_account_id, p_app_instance_id, v_expires, coalesce(nullif(p_reason, ''), 'auto_restart')
  );

  return jsonb_build_object('ok', true, 'acquired', true, 'renewed', false);
end;
$$;

create or replace function public.auto_restart_release_device_lock(
  p_device_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.auto_restart_device_locks
  where device_id = p_device_id
    and worker_id = p_worker_id;
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'released', v_deleted > 0);
end;
$$;

revoke all on function public.auto_restart_acquire_device_lock(uuid, text, uuid, uuid, integer, text) from public;
revoke all on function public.auto_restart_release_device_lock(uuid, text) from public;
grant execute on function public.auto_restart_acquire_device_lock(uuid, text, uuid, uuid, integer, text) to service_role;
grant execute on function public.auto_restart_release_device_lock(uuid, text) to service_role;
