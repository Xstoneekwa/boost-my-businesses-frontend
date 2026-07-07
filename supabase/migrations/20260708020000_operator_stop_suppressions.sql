-- CP5: operator stop suppresses automatic restarts until the materialized window ends.

create table if not exists public.operator_stop_suppressions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  assignment_id uuid null,
  scheduled_window_start timestamptz not null,
  scheduled_window_end timestamptz not null,
  request_id uuid null references public.account_run_requests(id) on delete set null,
  run_id uuid null references public.ig_runs(id) on delete set null,
  status text not null default 'active',
  reason_code text not null default 'operator_stop_suppressed',
  suppressed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_stop_suppressions_status_check check (
    status in ('active', 'expired')
  )
);

create unique index if not exists operator_stop_suppressions_account_window_uidx
  on public.operator_stop_suppressions (account_id, scheduled_window_start)
  where status = 'active';

create index if not exists operator_stop_suppressions_account_status_idx
  on public.operator_stop_suppressions (account_id, status, expires_at);

alter table public.operator_stop_suppressions enable row level security;

do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'operator_stop_suppressions'
      and policyname = 'operator_stop_suppressions_service_role_all'
  ) then
    create policy operator_stop_suppressions_service_role_all
      on public.operator_stop_suppressions for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end
$policy$;

revoke all on table public.operator_stop_suppressions from public, anon, authenticated;
grant all on table public.operator_stop_suppressions to service_role;

create or replace function public.upsert_operator_stop_suppression(
  p_account_id uuid,
  p_assignment_id uuid,
  p_scheduled_window_start timestamptz,
  p_scheduled_window_end timestamptz,
  p_request_id uuid default null,
  p_run_id uuid default null,
  p_reason_code text default 'operator_stop_suppressed',
  p_expires_at timestamptz default null,
  p_metadata_safe jsonb default '{}'::jsonb
)
returns public.operator_stop_suppressions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.operator_stop_suppressions%rowtype;
  v_expires timestamptz := coalesce(p_expires_at, p_scheduled_window_end);
begin
  update public.operator_stop_suppressions
  set status = 'expired',
      released_at = coalesce(released_at, now()),
      updated_at = now()
  where account_id = p_account_id
    and status = 'active'
    and scheduled_window_start <> p_scheduled_window_start;

  select * into v_row
  from public.operator_stop_suppressions
  where account_id = p_account_id
    and scheduled_window_start = p_scheduled_window_start
    and status = 'active'
  limit 1;

  if found then
    update public.operator_stop_suppressions
    set assignment_id = coalesce(p_assignment_id, assignment_id),
        scheduled_window_end = p_scheduled_window_end,
        request_id = coalesce(p_request_id, request_id),
        run_id = coalesce(p_run_id, run_id),
        reason_code = coalesce(p_reason_code, reason_code),
        expires_at = v_expires,
        metadata_safe = metadata_safe || coalesce(p_metadata_safe, '{}'::jsonb),
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  insert into public.operator_stop_suppressions (
    account_id, assignment_id, scheduled_window_start, scheduled_window_end,
    request_id, run_id, status, reason_code, expires_at, metadata_safe, updated_at
  ) values (
    p_account_id, p_assignment_id, p_scheduled_window_start, p_scheduled_window_end,
    p_request_id, p_run_id, 'active', coalesce(p_reason_code, 'operator_stop_suppressed'),
    v_expires, coalesce(p_metadata_safe, '{}'::jsonb), now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.get_active_operator_stop_suppression(
  p_account_id uuid,
  p_now timestamptz default now()
)
returns public.operator_stop_suppressions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.operator_stop_suppressions%rowtype;
begin
  update public.operator_stop_suppressions
  set status = 'expired',
      released_at = coalesce(released_at, now()),
      updated_at = now()
  where account_id = p_account_id
    and status = 'active'
    and expires_at <= p_now;

  select * into v_row
  from public.operator_stop_suppressions
  where account_id = p_account_id
    and status = 'active'
    and expires_at > p_now
  order by suppressed_at desc
  limit 1;

  return v_row;
end;
$$;

grant execute on function public.upsert_operator_stop_suppression to service_role;
grant execute on function public.get_active_operator_stop_suppression to service_role;
