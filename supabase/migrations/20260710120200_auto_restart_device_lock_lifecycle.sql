-- Auto Restart device lock lifecycle: bind to request, renew, transfer, release by owner/request.

alter table public.auto_restart_device_locks
  add column if not exists request_id uuid null,
  add column if not exists run_id uuid null;

create index if not exists auto_restart_device_locks_request_id_idx
  on public.auto_restart_device_locks (request_id)
  where request_id is not null;

create or replace function public.auto_restart_bind_device_lock_to_request(
  p_device_id uuid,
  p_worker_id text,
  p_request_id uuid,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => greatest(p_lease_seconds, 30));
  v_row public.auto_restart_device_locks%rowtype;
begin
  select * into v_row
  from public.auto_restart_device_locks
  where device_id = p_device_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'bound', false, 'reason', 'device_lock_missing');
  end if;

  if v_row.worker_id <> p_worker_id then
    return jsonb_build_object(
      'ok', false,
      'bound', false,
      'reason', 'device_lock_owner_mismatch',
      'holder_worker_id', v_row.worker_id
    );
  end if;

  update public.auto_restart_device_locks
  set request_id = p_request_id,
      lease_expires_at = v_expires,
      updated_at = v_now,
      metadata_safe = coalesce(metadata_safe, '{}'::jsonb) || jsonb_build_object('bound_request_id', p_request_id::text)
  where device_id = p_device_id;

  return jsonb_build_object('ok', true, 'bound', true, 'request_id', p_request_id);
end;
$$;

create or replace function public.auto_restart_renew_device_lock(
  p_device_id uuid,
  p_worker_id text,
  p_request_id uuid,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => greatest(p_lease_seconds, 30));
  v_row public.auto_restart_device_locks%rowtype;
begin
  delete from public.auto_restart_device_locks
  where device_id = p_device_id
    and lease_expires_at <= v_now
    and request_id is null;

  select * into v_row
  from public.auto_restart_device_locks
  where device_id = p_device_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'renewed', false, 'reason', 'device_lock_missing');
  end if;

  if v_row.worker_id <> p_worker_id then
    return jsonb_build_object('ok', false, 'renewed', false, 'reason', 'device_lock_owner_mismatch');
  end if;

  if v_row.request_id is not null and v_row.request_id <> p_request_id then
    return jsonb_build_object('ok', false, 'renewed', false, 'reason', 'device_lock_request_mismatch');
  end if;

  update public.auto_restart_device_locks
  set lease_expires_at = v_expires,
      request_id = coalesce(request_id, p_request_id),
      updated_at = v_now
  where device_id = p_device_id;

  return jsonb_build_object('ok', true, 'renewed', true);
end;
$$;

create or replace function public.auto_restart_release_device_lock(
  p_device_id uuid,
  p_worker_id text,
  p_request_id uuid default null
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
    and worker_id = p_worker_id
    and (p_request_id is null or request_id = p_request_id);
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'released', v_deleted > 0);
end;
$$;

create or replace function public.auto_restart_transfer_device_lock(
  p_device_id uuid,
  p_request_id uuid,
  p_new_worker_id text,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_expires timestamptz := v_now + make_interval(secs => greatest(p_lease_seconds, 30));
  v_row public.auto_restart_device_locks%rowtype;
begin
  select * into v_row
  from public.auto_restart_device_locks
  where device_id = p_device_id
    and request_id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'transferred', false, 'reason', 'device_lock_missing');
  end if;

  update public.auto_restart_device_locks
  set worker_id = p_new_worker_id,
      lease_expires_at = v_expires,
      updated_at = v_now
  where device_id = p_device_id
    and request_id = p_request_id;

  return jsonb_build_object('ok', true, 'transferred', true, 'worker_id', p_new_worker_id);
end;
$$;

revoke all on function public.auto_restart_bind_device_lock_to_request(uuid, text, uuid, integer) from public;
revoke all on function public.auto_restart_renew_device_lock(uuid, text, uuid, integer) from public;
revoke all on function public.auto_restart_transfer_device_lock(uuid, uuid, text, integer) from public;
grant execute on function public.auto_restart_bind_device_lock_to_request(uuid, text, uuid, integer) to service_role;
grant execute on function public.auto_restart_renew_device_lock(uuid, text, uuid, integer) to service_role;
grant execute on function public.auto_restart_transfer_device_lock(uuid, uuid, text, integer) to service_role;
