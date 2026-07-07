-- CP3: canonical device UI lease (phone-level exclusivity) built on auto_restart_device_locks.

alter table public.auto_restart_device_locks
  add column if not exists lease_id uuid not null default gen_random_uuid(),
  add column if not exists owner_kind text not null default 'worker',
  add column if not exists operation_phase text not null default 'executing',
  add column if not exists heartbeat_at timestamptz not null default now(),
  add column if not exists release_reason text null;

create unique index if not exists auto_restart_device_locks_lease_id_uidx
  on public.auto_restart_device_locks (lease_id);

create table if not exists public.device_ui_lease_events (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null,
  device_id uuid not null,
  event_type text not null,
  owner_kind text null,
  worker_id text null,
  request_id uuid null,
  run_id uuid null,
  reason text not null default '',
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint device_ui_lease_events_event_type_check
    check (event_type in ('acquired', 'renewed', 'released', 'expired', 'stale_reconciled', 'bind_request'))
);

create index if not exists device_ui_lease_events_device_created_idx
  on public.device_ui_lease_events (device_id, created_at desc);

alter table public.device_ui_lease_events enable row level security;

do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'device_ui_lease_events'
      and policyname = 'device_ui_lease_events_service_role_all'
  ) then
    create policy device_ui_lease_events_service_role_all
      on public.device_ui_lease_events for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end
$policy$;

revoke all on table public.device_ui_lease_events from public, anon, authenticated;
grant all on table public.device_ui_lease_events to service_role;

create or replace function public._device_ui_lease_audit(
  p_lease_id uuid,
  p_device_id uuid,
  p_event_type text,
  p_owner_kind text,
  p_worker_id text,
  p_request_id uuid,
  p_run_id uuid,
  p_reason text,
  p_metadata_safe jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.device_ui_lease_events (
    lease_id, device_id, event_type, owner_kind, worker_id, request_id, run_id, reason, metadata_safe
  ) values (
    p_lease_id, p_device_id, p_event_type, p_owner_kind, p_worker_id, p_request_id, p_run_id,
    coalesce(p_reason, ''), coalesce(p_metadata_safe, '{}'::jsonb)
  );
end;
$$;

create or replace function public.auto_restart_acquire_device_lock(
  p_device_id uuid,
  p_worker_id text,
  p_account_id uuid,
  p_app_instance_id uuid,
  p_lease_seconds integer default 900,
  p_reason text default 'auto_restart',
  p_owner_kind text default 'worker',
  p_operation_phase text default 'executing'
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
  v_lease_id uuid;
begin
  delete from public.auto_restart_device_locks
  where device_id = p_device_id
    and lease_expires_at <= v_now
    and request_id is null;

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
          owner_kind = coalesce(nullif(p_owner_kind, ''), v_existing.owner_kind),
          operation_phase = coalesce(nullif(p_operation_phase, ''), v_existing.operation_phase),
          heartbeat_at = v_now,
          updated_at = v_now
      where device_id = p_device_id
      returning lease_id into v_lease_id;
      perform public._device_ui_lease_audit(
        v_lease_id, p_device_id, 'renewed', p_owner_kind, p_worker_id, v_existing.request_id, v_existing.run_id, p_reason
      );
      return jsonb_build_object(
        'ok', true, 'acquired', true, 'renewed', true,
        'lease_id', v_lease_id, 'device_id', p_device_id
      );
    end if;
    return jsonb_build_object(
      'ok', false,
      'acquired', false,
      'reason', 'device_lease_unavailable',
      'legacy_reason', 'device_lock_held',
      'holder_worker_id', v_existing.worker_id,
      'lease_id', v_existing.lease_id
    );
  end if;

  insert into public.auto_restart_device_locks (
    device_id, worker_id, account_id, app_instance_id, lease_expires_at, reason,
    owner_kind, operation_phase, heartbeat_at
  ) values (
    p_device_id, p_worker_id, p_account_id, p_app_instance_id, v_expires,
    coalesce(nullif(p_reason, ''), 'auto_restart'),
    coalesce(nullif(p_owner_kind, ''), 'worker'),
    coalesce(nullif(p_operation_phase, ''), 'executing'),
    v_now
  )
  returning lease_id into v_lease_id;

  perform public._device_ui_lease_audit(
    v_lease_id, p_device_id, 'acquired', p_owner_kind, p_worker_id, null, null, p_reason
  );

  return jsonb_build_object(
    'ok', true, 'acquired', true, 'renewed', false,
    'lease_id', v_lease_id, 'device_id', p_device_id
  );
end;
$$;

create or replace function public.auto_restart_release_device_lock(
  p_device_id uuid,
  p_worker_id text,
  p_request_id uuid default null,
  p_release_reason text default 'terminal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
  v_row public.auto_restart_device_locks%rowtype;
begin
  select * into v_row
  from public.auto_restart_device_locks
  where device_id = p_device_id
    and worker_id = p_worker_id
    and (p_request_id is null or request_id = p_request_id)
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'released', false);
  end if;

  perform public._device_ui_lease_audit(
    v_row.lease_id, p_device_id, 'released', v_row.owner_kind, p_worker_id,
    v_row.request_id, v_row.run_id, coalesce(p_release_reason, 'terminal')
  );

  delete from public.auto_restart_device_locks
  where device_id = p_device_id
    and worker_id = p_worker_id
    and (p_request_id is null or request_id = p_request_id);
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'released', v_deleted > 0, 'lease_id', v_row.lease_id);
end;
$$;

create or replace function public.acquire_device_ui_lease(
  p_device_id uuid,
  p_worker_id text,
  p_account_id uuid,
  p_app_instance_id uuid default null,
  p_lease_seconds integer default 900,
  p_reason text default 'ui_operation',
  p_owner_kind text default 'worker',
  p_operation_phase text default 'executing'
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.auto_restart_acquire_device_lock(
    p_device_id, p_worker_id, p_account_id, p_app_instance_id,
    p_lease_seconds, p_reason, p_owner_kind, p_operation_phase
  );
$$;

create or replace function public.renew_device_ui_lease(
  p_device_id uuid,
  p_worker_id text,
  p_request_id uuid,
  p_lease_seconds integer default 900
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.auto_restart_renew_device_lock(
    p_device_id, p_worker_id, p_request_id, p_lease_seconds
  );
$$;

create or replace function public.release_device_ui_lease(
  p_device_id uuid,
  p_worker_id text,
  p_request_id uuid default null,
  p_release_reason text default 'terminal'
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.auto_restart_release_device_lock(
    p_device_id, p_worker_id, p_request_id, p_release_reason
  );
$$;

create or replace function public.reconcile_stale_device_ui_leases(
  p_grace_seconds integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_cutoff timestamptz := v_now - make_interval(secs => greatest(p_grace_seconds, 0));
  v_row public.auto_restart_device_locks%rowtype;
  v_reconciled integer := 0;
  v_skipped_active integer := 0;
begin
  for v_row in
    select *
    from public.auto_restart_device_locks
    where lease_expires_at <= v_cutoff
    for update
  loop
    if v_row.request_id is not null and exists (
      select 1 from public.account_run_requests r
      where r.id = v_row.request_id
        and r.status in ('queued', 'claimed', 'starting', 'running')
    ) then
      v_skipped_active := v_skipped_active + 1;
      continue;
    end if;

    if v_row.run_id is not null and exists (
      select 1 from public.ig_runs g
      where g.id = v_row.run_id
        and g.status in ('running', 'pending', 'starting', 'queued', 'in_progress', 'active')
    ) then
      v_skipped_active := v_skipped_active + 1;
      continue;
    end if;

    perform public._device_ui_lease_audit(
      v_row.lease_id, v_row.device_id, 'stale_reconciled', v_row.owner_kind, v_row.worker_id,
      v_row.request_id, v_row.run_id, 'lease_expired'
    );
    delete from public.auto_restart_device_locks where device_id = v_row.device_id;
    v_reconciled := v_reconciled + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'reconciled', v_reconciled,
    'skipped_active', v_skipped_active
  );
end;
$$;

revoke all on function public.acquire_device_ui_lease(uuid, text, uuid, uuid, integer, text, text, text) from public;
revoke all on function public.renew_device_ui_lease(uuid, text, uuid, integer) from public;
revoke all on function public.release_device_ui_lease(uuid, text, uuid, text) from public;
revoke all on function public.reconcile_stale_device_ui_leases(integer) from public;
grant execute on function public.acquire_device_ui_lease(uuid, text, uuid, uuid, integer, text, text, text) to service_role;
grant execute on function public.renew_device_ui_lease(uuid, text, uuid, integer) to service_role;
grant execute on function public.release_device_ui_lease(uuid, text, uuid, text) to service_role;
grant execute on function public.reconcile_stale_device_ui_leases(integer) to service_role;
