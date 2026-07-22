-- Auto Login terminalization V1.
--
-- Keep the public/projectable error vocabulary compatible with the existing
-- anti-leak constraints while retaining the exact worker reason in a
-- service-role-only relation. Request + linked run are terminalized in the
-- same PostgreSQL transaction; notification delivery remains downstream.

create table if not exists public.auto_login_internal_failure_details (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.account_run_requests(id) on delete cascade,
  run_id uuid references public.ig_runs(id) on delete set null,
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  internal_worker_reason text not null,
  phase text not null,
  exit_code integer,
  source text not null default 'run_dispatcher',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auto_login_internal_failure_reason_canonical
    check (
      char_length(internal_worker_reason) between 1 and 160
      and internal_worker_reason ~ '^[a-z][a-z0-9_]*$'
    ),
  constraint auto_login_internal_failure_phase_canonical
    check (
      char_length(phase) between 1 and 80
      and phase ~ '^[a-z][a-z0-9_]*$'
    ),
  constraint auto_login_internal_failure_source_safe
    check (
      char_length(source) between 1 and 80
      and source !~* '(token|secret|authorization|cookie|service_role|vault|password)'
    )
);

comment on table public.auto_login_internal_failure_details is
  'Server-only exact Auto Login worker failure diagnostics. Never project to client or notification payloads.';
comment on column public.auto_login_internal_failure_details.internal_worker_reason is
  'Exact internal worker reason. Service-role/operator diagnostics only; never use as account_run_requests.error_code.';

alter table public.auto_login_internal_failure_details enable row level security;
alter table public.auto_login_internal_failure_details force row level security;

revoke all on table public.auto_login_internal_failure_details from public, anon, authenticated;
grant select, insert, update on table public.auto_login_internal_failure_details to service_role;

create or replace function public.finalize_auto_login_failure_v1(
  p_request_id uuid,
  p_worker_id text,
  p_account_id uuid,
  p_run_id uuid,
  p_persisted_error_code text,
  p_error_message_safe text,
  p_internal_worker_reason text,
  p_phase text,
  p_exit_code integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_worker_id text := left(
    regexp_replace(coalesce(nullif(trim(p_worker_id), ''), 'run-dispatcher'), '[^a-zA-Z0-9_.:-]', '_', 'g'),
    160
  );
  v_error_code text := lower(trim(coalesce(p_persisted_error_code, '')));
  v_internal_reason text := lower(trim(coalesce(p_internal_worker_reason, '')));
  v_phase text := lower(trim(coalesce(p_phase, '')));
  v_message text := trim(coalesce(p_error_message_safe, ''));
  v_request public.account_run_requests;
  v_request_updated public.account_run_requests;
  v_run_status text;
begin
  if v_error_code !~ '^[a-z][a-z0-9_]{0,119}$'
     or v_error_code ~* '(token|secret|authorization|cookie|service_role|vault|password)' then
    raise exception 'unsafe_auto_login_error_code' using errcode = '22023';
  end if;
  if v_internal_reason !~ '^[a-z][a-z0-9_]{0,159}$' then
    raise exception 'invalid_internal_worker_reason' using errcode = '22023';
  end if;
  if v_phase !~ '^[a-z][a-z0-9_]{0,79}$' then
    raise exception 'invalid_auto_login_phase' using errcode = '22023';
  end if;
  if char_length(v_message) < 1
     or char_length(v_message) > 500
     or v_message ~* '(token|secret|authorization|cookie|service_role|vault|password)' then
    raise exception 'unsafe_auto_login_error_message' using errcode = '22023';
  end if;

  select arr.*
    into v_request
  from public.account_run_requests arr
  where arr.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'auto_login_request_not_found' using errcode = 'P0002';
  end if;
  if v_request.account_id <> p_account_id
     or v_request.run_id is distinct from p_run_id
     or v_request.claimed_by is distinct from v_worker_id
     or v_request.requested_run_type not in ('login_provisioning', 'login_email_code_resume') then
    raise exception 'auto_login_terminalization_scope_mismatch' using errcode = '22023';
  end if;

  if v_request.status = 'failed' then
    return jsonb_build_object(
      'request_id', v_request.id,
      'request_status', v_request.status,
      'run_id', v_request.run_id,
      'persisted_error_code', v_request.error_code,
      'terminalized', false,
      'reason', 'already_terminal'
    );
  end if;
  if v_request.status not in ('claimed', 'starting', 'running') then
    raise exception 'auto_login_request_not_active' using errcode = '22023';
  end if;

  perform 1
  from public.ig_runs r
  where r.id = p_run_id
    and r.account_id = p_account_id
  for update;
  if not found then
    raise exception 'auto_login_run_scope_mismatch' using errcode = '22023';
  end if;

  insert into public.auto_login_internal_failure_details (
    request_id,
    run_id,
    account_id,
    internal_worker_reason,
    phase,
    exit_code,
    source
  ) values (
    p_request_id,
    p_run_id,
    p_account_id,
    v_internal_reason,
    v_phase,
    p_exit_code,
    'run_dispatcher'
  )
  on conflict (request_id) do update set
    run_id = excluded.run_id,
    account_id = excluded.account_id,
    internal_worker_reason = excluded.internal_worker_reason,
    phase = excluded.phase,
    exit_code = excluded.exit_code,
    updated_at = now();

  update public.ig_runs r
  set
    status = 'failed',
    finished_at = coalesce(r.finished_at, now()),
    completed_at = coalesce(r.completed_at, now()),
    updated_at = now(),
    performance_summary = coalesce(r.performance_summary, '{}'::jsonb) || jsonb_build_object(
      'domain', 'auto_login',
      'phase', v_phase,
      'reason_code', v_error_code,
      'exit_code', p_exit_code,
      'terminalization_contract', 'auto_login_failure_v1'
    )
  where r.id = p_run_id
    and r.account_id = p_account_id
    and r.status in ('queued', 'pending', 'in_progress', 'active', 'starting', 'running');

  select r.status into v_run_status
  from public.ig_runs r
  where r.id = p_run_id;
  if v_run_status <> 'failed' then
    raise exception 'auto_login_run_not_terminalized' using errcode = '22023';
  end if;

  update public.account_run_requests arr
  set
    status = 'failed',
    completed_at = coalesce(arr.completed_at, now()),
    error_code = v_error_code,
    error_message_safe = v_message,
    lease_expires_at = null,
    updated_at = now()
  where arr.id = p_request_id
    and arr.claimed_by = v_worker_id
    and arr.status in ('claimed', 'starting', 'running')
  returning * into v_request_updated;

  if v_request_updated.id is null then
    raise exception 'auto_login_request_not_terminalized' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'request_id', v_request_updated.id,
    'request_status', v_request_updated.status,
    'run_id', v_request_updated.run_id,
    'run_status', v_run_status,
    'persisted_error_code', v_request_updated.error_code,
    'terminalized', true,
    'reason', 'terminalized'
  );
end;
$$;

comment on function public.finalize_auto_login_failure_v1(uuid, text, uuid, uuid, text, text, text, text, integer) is
  'Service-role-only atomic Auto Login failure terminalization. Exact internal reason is retained outside projectable request/run fields.';

revoke all on function public.finalize_auto_login_failure_v1(uuid, text, uuid, uuid, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.finalize_auto_login_failure_v1(uuid, text, uuid, uuid, text, text, text, text, integer) to service_role;
