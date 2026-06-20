-- Dedicated strict scheduler lock for low-FBR target auto-archive cron.
-- Unlike claim_ct_target_verification_scheduler_lock, this lock does NOT renew
-- while active: concurrent invocations with the same worker_id are rejected.

create table if not exists public.target_auto_archive_low_fbr_scheduler_locks (
  lock_key text primary key,
  worker_id text not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint target_auto_archive_low_fbr_scheduler_locks_worker_id_check
    check (
      char_length(worker_id) <= 120
      and worker_id !~* '(token|secret|authorization|cookie|service_role|vault)'
    )
);

alter table public.target_auto_archive_low_fbr_scheduler_locks enable row level security;

drop policy if exists target_auto_archive_low_fbr_scheduler_locks_service_role_all
  on public.target_auto_archive_low_fbr_scheduler_locks;
create policy target_auto_archive_low_fbr_scheduler_locks_service_role_all
  on public.target_auto_archive_low_fbr_scheduler_locks
  for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

revoke all on public.target_auto_archive_low_fbr_scheduler_locks from public;
revoke all on public.target_auto_archive_low_fbr_scheduler_locks from anon;
revoke all on public.target_auto_archive_low_fbr_scheduler_locks from authenticated;
grant all on public.target_auto_archive_low_fbr_scheduler_locks to service_role;

create or replace function public.claim_target_auto_archive_low_fbr_scheduler_lock(
  worker_id text default 'target_auto_archive_low_fbr_cron',
  ttl_seconds integer default 900
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_worker_id text := left(
    regexp_replace(coalesce(worker_id, 'target_auto_archive_low_fbr_cron'), '[^a-zA-Z0-9_.:-]', '_', 'g'),
    120
  );
  safe_ttl integer := least(greatest(coalesce(ttl_seconds, 900), 60), 3600);
  lock_name constant text := 'target_auto_archive_low_fbr';
begin
  if safe_worker_id is null or safe_worker_id = '' then
    safe_worker_id := 'target_auto_archive_low_fbr_cron';
  end if;

  insert into public.target_auto_archive_low_fbr_scheduler_locks (
    lock_key,
    worker_id,
    locked_at,
    expires_at
  )
  values (
    lock_name,
    safe_worker_id,
    now(),
    now() - interval '1 second'
  )
  on conflict (lock_key) do nothing;

  update public.target_auto_archive_low_fbr_scheduler_locks
  set
    worker_id = safe_worker_id,
    locked_at = now(),
    expires_at = now() + make_interval(secs => safe_ttl)
  where lock_key = lock_name
    and expires_at <= now();

  return found;
end;
$$;

create or replace function public.release_target_auto_archive_low_fbr_scheduler_lock(
  worker_id text default 'target_auto_archive_low_fbr_cron'
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_worker_id text := left(
    regexp_replace(coalesce(worker_id, 'target_auto_archive_low_fbr_cron'), '[^a-zA-Z0-9_.:-]', '_', 'g'),
    120
  );
  lock_name constant text := 'target_auto_archive_low_fbr';
begin
  if safe_worker_id is null or safe_worker_id = '' then
    safe_worker_id := 'target_auto_archive_low_fbr_cron';
  end if;

  update public.target_auto_archive_low_fbr_scheduler_locks
  set expires_at = now()
  where lock_key = lock_name
    and target_auto_archive_low_fbr_scheduler_locks.worker_id = safe_worker_id;

  return found;
end;
$$;

revoke all on function public.claim_target_auto_archive_low_fbr_scheduler_lock(text, integer) from public;
revoke all on function public.claim_target_auto_archive_low_fbr_scheduler_lock(text, integer) from anon;
revoke all on function public.claim_target_auto_archive_low_fbr_scheduler_lock(text, integer) from authenticated;
grant execute on function public.claim_target_auto_archive_low_fbr_scheduler_lock(text, integer) to service_role;

revoke all on function public.release_target_auto_archive_low_fbr_scheduler_lock(text) from public;
revoke all on function public.release_target_auto_archive_low_fbr_scheduler_lock(text) from anon;
revoke all on function public.release_target_auto_archive_low_fbr_scheduler_lock(text) from authenticated;
grant execute on function public.release_target_auto_archive_low_fbr_scheduler_lock(text) to service_role;

comment on table public.target_auto_archive_low_fbr_scheduler_locks is
  'Single-row strict lock for low-FBR target auto-archive cron. No renewal while active; TTL auto-expires stale locks.';

comment on function public.claim_target_auto_archive_low_fbr_scheduler_lock(text, integer) is
  'Claims the low-FBR auto-archive scheduler lock only when free or expired. Returns false when another active run holds the lock.';

comment on function public.release_target_auto_archive_low_fbr_scheduler_lock(text) is
  'Releases the low-FBR auto-archive scheduler lock for the matching worker_id by expiring it immediately.';
