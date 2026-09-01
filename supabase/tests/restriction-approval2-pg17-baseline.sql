\set ON_ERROR_STOP on

create table public.ig_accounts (
  id uuid primary key,
  admin_lifecycle_status text not null default 'active'
);

create table public.account_incidents (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id),
  incident_type text not null,
  reason text,
  failure_reason text,
  severity text not null,
  status text not null,
  metadata jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.account_run_requests (
  id uuid primary key,
  account_id uuid not null references public.ig_accounts(id),
  request_kind text not null default 'scheduled',
  status text not null default 'queued',
  created_at timestamptz not null default clock_timestamp()
);

create or replace function public.admit_account_run_attempt_v1(
  p_request_id uuid,
  p_worker_id text,
  p_assignment_id uuid,
  p_device_id uuid,
  p_app_instance_id uuid,
  p_expected_package text,
  p_scheduled_window_start timestamptz default null,
  p_scheduled_window_end timestamptz default null,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_account public.ig_accounts%rowtype;
begin
  select account.* into v_account
  from public.ig_accounts as account
  join public.account_run_requests as request on request.account_id = account.id
  where request.id = p_request_id
  for update of account;
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;
  if exists (
    select 1 from public.account_incidents i
    where i.account_id = v_account.id
      and i.status in ('open','acknowledged')
      and (
        i.severity in ('error','critical')
        or i.incident_type in (
          'instagram_human_confirmation_required', 'instagram_account_restriction',
          'active_instagram_account_mismatch', 'assigned_instagram_package_unavailable',
          'account_login_required'
        )
      )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'active_blocking_incident');
  end if;
  update public.account_run_requests
  set status = 'admitted'
  where id = p_request_id;
  return jsonb_build_object('ok', true, 'request_id', p_request_id);
end;
$function$;

create or replace function public.certify_zero_work_and_enqueue_recovery_v1(
  p_source_run_id uuid,
  p_source_request_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_account public.ig_accounts%rowtype;
  v_new_request_id uuid := gen_random_uuid();
begin
  select account.* into v_account
  from public.ig_accounts as account
  join public.account_run_requests as request on request.account_id = account.id
  where request.id = p_source_request_id
  for update of account;
  if v_account.id is null then return jsonb_build_object('ok',false,'reason','request_not_found'); end if;
  if exists (
    select 1 from public.account_incidents i
    where i.account_id=v_account.id and i.status in ('open','acknowledged')
      and (i.severity in ('error','critical') or i.incident_type in (
        'instagram_human_confirmation_required','instagram_account_restriction',
        'active_instagram_account_mismatch','assigned_instagram_package_unavailable',
        'account_login_required'
      ))
  ) then return jsonb_build_object('ok',false,'reason','active_blocking_incident'); end if;
  insert into public.account_run_requests(id, account_id, request_kind, status)
  values (v_new_request_id, v_account.id, 'recovery', 'queued');
  return jsonb_build_object('ok',true,'enqueued',true,'request_id',v_new_request_id);
end;
$function$;

revoke all on function public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamptz,timestamptz,integer)
  from public, anon, authenticated;
grant execute on function public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamptz,timestamptz,integer)
  to service_role;
revoke all on function public.certify_zero_work_and_enqueue_recovery_v1(uuid,uuid,text,integer)
  from public, anon, authenticated;
grant execute on function public.certify_zero_work_and_enqueue_recovery_v1(uuid,uuid,text,integer)
  to service_role;

insert into public.ig_accounts(id)
values ('10000000-0000-0000-0000-000000000001');
