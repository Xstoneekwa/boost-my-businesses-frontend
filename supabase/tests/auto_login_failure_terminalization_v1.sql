\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema if not exists public;

create table public.ig_accounts (
  id uuid primary key
);

create table public.ig_runs (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id),
  status text not null,
  finished_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  performance_summary jsonb
);

create table public.account_run_requests (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id),
  run_id uuid references public.ig_runs(id),
  claimed_by text,
  requested_run_type text not null,
  status text not null,
  completed_at timestamptz,
  error_code text,
  error_message_safe text,
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint account_run_requests_error_code_safe
    check (
      error_code is null
      or error_code !~* '(token|secret|authorization|cookie|service_role|vault|password)'
    )
);

\ir ../migrations/20260722200447_auto_login_failure_terminalization_v1.sql

do $$
begin
  if has_table_privilege('anon', 'public.auto_login_internal_failure_details', 'select') then
    raise exception 'anon_internal_failure_access_granted';
  end if;
  if has_table_privilege('authenticated', 'public.auto_login_internal_failure_details', 'select') then
    raise exception 'authenticated_internal_failure_access_granted';
  end if;
  if not has_table_privilege('service_role', 'public.auto_login_internal_failure_details', 'select') then
    raise exception 'service_role_internal_failure_access_missing';
  end if;
  if has_function_privilege(
    'anon',
    'public.finalize_auto_login_failure_v1(uuid,text,uuid,uuid,text,text,text,text,integer)',
    'execute'
  ) then
    raise exception 'anon_terminalization_execute_granted';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.finalize_auto_login_failure_v1(uuid,text,uuid,uuid,text,text,text,text,integer)',
    'execute'
  ) then
    raise exception 'authenticated_terminalization_execute_granted';
  end if;
end;
$$;

insert into public.ig_accounts (id)
values ('00000000-0000-4000-8000-000000000201');

insert into public.ig_runs (id, account_id, status)
values (
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000201',
  'running'
);

insert into public.account_run_requests (
  id,
  account_id,
  run_id,
  claimed_by,
  requested_run_type,
  status,
  lease_expires_at
) values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  'run-dispatcher:test',
  'login_provisioning',
  'running',
  now() + interval '2 minutes'
);

do $$
begin
  begin
    perform public.finalize_auto_login_failure_v1(
      '00000000-0000-4000-8000-000000000101',
      'run-dispatcher:test',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      'password_field_not_found',
      'Auto Login failed.',
      'password_field_not_found',
      'login_form',
      1
    );
    raise exception 'unsafe_error_code_was_accepted';
  exception
    when sqlstate '22023' then null;
  end;

  if (select status from public.account_run_requests where id = '00000000-0000-4000-8000-000000000101') <> 'running' then
    raise exception 'request_changed_after_rejected_terminalization';
  end if;
  if (select status from public.ig_runs where id = '00000000-0000-4000-8000-000000000301') <> 'running' then
    raise exception 'run_changed_after_rejected_terminalization';
  end if;
end;
$$;

select public.finalize_auto_login_failure_v1(
  '00000000-0000-4000-8000-000000000101',
  'run-dispatcher:test',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  'credential_input_field_unavailable',
  'Auto Login could not be completed. Review the correlated incident.',
  'password_field_not_found',
  'login_form',
  1
);

do $$
declare
  v_request public.account_run_requests;
  v_run public.ig_runs;
  v_internal public.auto_login_internal_failure_details;
begin
  select * into v_request
  from public.account_run_requests
  where id = '00000000-0000-4000-8000-000000000101';
  select * into v_run
  from public.ig_runs
  where id = '00000000-0000-4000-8000-000000000301';
  select * into v_internal
  from public.auto_login_internal_failure_details
  where request_id = '00000000-0000-4000-8000-000000000101';

  if v_request.status <> 'failed'
     or v_request.error_code <> 'credential_input_field_unavailable'
     or v_request.completed_at is null
     or v_request.lease_expires_at is not null then
    raise exception 'request_not_terminalized';
  end if;
  if v_run.status <> 'failed'
     or v_run.completed_at is null
     or v_run.finished_at is null
     or v_run.performance_summary ->> 'reason_code' <> 'credential_input_field_unavailable' then
    raise exception 'run_not_terminalized';
  end if;
  if v_internal.internal_worker_reason <> 'password_field_not_found'
     or v_internal.phase <> 'login_form'
     or v_internal.exit_code <> 1 then
    raise exception 'internal_reason_not_preserved';
  end if;
end;
$$;

-- Idempotency: a notifier retry or dispatcher reconciliation cannot reopen or
-- duplicate the already terminal result.
select public.finalize_auto_login_failure_v1(
  '00000000-0000-4000-8000-000000000101',
  'run-dispatcher:test',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  'credential_input_field_unavailable',
  'Auto Login could not be completed. Review the correlated incident.',
  'password_field_not_found',
  'login_form',
  1
);

do $$
begin
  if (select count(*) from public.auto_login_internal_failure_details) <> 1 then
    raise exception 'internal_failure_detail_not_deduplicated';
  end if;
end;
$$;
