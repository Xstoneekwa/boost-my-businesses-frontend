-- Incidents overview + professional retention V1.
-- Scoped to the incident control plane. No scheduler, request, run or Worker
-- function is changed by this migration.

alter table public.account_incidents
  add column if not exists archived_at timestamptz,
  add column if not exists legal_hold boolean not null default false,
  add column if not exists retention_class text not null default 'normal',
  add column if not exists retention_policy_version text,
  add column if not exists purge_after timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.account_incidents'::regclass
      and conname = 'account_incidents_retention_class_check'
  ) then
    alter table public.account_incidents
      add constraint account_incidents_retention_class_check
      check (retention_class in ('normal', 'critical', 'technical_nonblocking', 'legal_audit'));
  end if;
end
$$;

create table if not exists public.incident_retention_policies (
  policy_key text primary key,
  policy_version text not null,
  enabled boolean not null default true,
  normal_resolved_days integer not null default 180 check (normal_resolved_days between 1 and 3650),
  critical_resolved_days integer not null default 365 check (critical_resolved_days between 1 and 3650),
  technical_nonblocking_days integer not null default 90 check (technical_nonblocking_days between 1 and 3650),
  delivery_log_days integer not null default 90 check (delivery_log_days between 1 and 3650),
  physical_delete_grace_days integer not null default 30 check (physical_delete_grace_days between 1 and 3650),
  cleanup_batch_size integer not null default 250 check (cleanup_batch_size between 1 and 1000),
  legal_audit_logical_archive_only boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.incident_retention_policies (
  policy_key,
  policy_version,
  normal_resolved_days,
  critical_resolved_days,
  technical_nonblocking_days,
  delivery_log_days,
  physical_delete_grace_days,
  cleanup_batch_size,
  legal_audit_logical_archive_only
) values ('default', 'incident-retention-v1', 180, 365, 90, 90, 30, 250, true)
on conflict (policy_key) do nothing;

create table if not exists public.incident_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'skipped_locked', 'disabled')),
  policy_version text not null,
  batch_size integer not null,
  dry_run boolean not null default false,
  rows_examined integer not null default 0,
  incidents_archived integer not null default 0,
  incidents_deleted integer not null default 0,
  deliveries_deleted integer not null default 0,
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

alter table public.incident_retention_policies enable row level security;
alter table public.incident_cleanup_runs enable row level security;
revoke all on table public.incident_retention_policies from public, anon, authenticated;
revoke all on table public.incident_cleanup_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.incident_retention_policies to service_role;
grant select on table public.incident_cleanup_runs to service_role;

create index if not exists account_incidents_overview_cursor_idx
  on public.account_incidents (last_seen_at desc, id desc)
  where archived_at is null;
create index if not exists account_incidents_retention_due_idx
  on public.account_incidents (purge_after, id)
  where status in ('resolved', 'ignored') and archived_at is null and legal_hold = false;
create index if not exists account_incident_notifications_retention_idx
  on public.account_incident_notifications (created_at, incident_id);
create index if not exists incident_cleanup_runs_started_idx
  on public.incident_cleanup_runs (started_at desc);

create or replace function public.set_account_incident_retention_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_policy public.incident_retention_policies%rowtype;
  v_days integer;
begin
  select * into v_policy
  from public.incident_retention_policies
  where policy_key = 'default';

  if new.legal_hold then
    new.retention_class := 'legal_audit';
    new.purge_after := null;
  elsif new.severity = 'critical' then
    new.retention_class := 'critical';
  elsif new.severity = 'info' and coalesce(new.action_required, '') = '' then
    new.retention_class := 'technical_nonblocking';
  else
    new.retention_class := 'normal';
  end if;

  if new.status in ('resolved', 'ignored') and not new.legal_hold then
    v_days := case new.retention_class
      when 'critical' then v_policy.critical_resolved_days
      when 'technical_nonblocking' then v_policy.technical_nonblocking_days
      else v_policy.normal_resolved_days
    end;
    new.retention_policy_version := v_policy.policy_version;
    new.purge_after := coalesce(new.resolved_at, now()) + make_interval(days => v_days);
  elsif new.status in ('open', 'acknowledged') then
    new.archived_at := null;
    new.purge_after := null;
    new.retention_policy_version := v_policy.policy_version;
  end if;
  return new;
end
$$;

drop trigger if exists account_incidents_retention_v1 on public.account_incidents;
create trigger account_incidents_retention_v1
before insert or update of status, severity, action_required, resolved_at, legal_hold
on public.account_incidents
for each row execute function public.set_account_incident_retention_v1();

update public.account_incidents
set legal_hold = legal_hold
where retention_policy_version is null;

create or replace function public.get_account_incidents_overview_v1(
  p_filter text default 'open',
  p_limit integer default 50,
  p_cursor_last_seen_at timestamptz default null,
  p_cursor_id uuid default null,
  p_search text default null,
  p_include_test boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with latest_action as (
  select distinct on (a.incident_id)
    a.incident_id,
    a.id as action_id,
    a.status as action_status,
    a.blocking_campaign,
    a.created_at
  from public.account_dashboard_actions a
  where a.action_type = 'operator_review_required'
    and a.incident_id is not null
  order by a.incident_id, a.created_at desc, a.id desc
), base as (
  select
    i.*,
    la.action_id as operator_action_id,
    la.action_status as operator_action_status,
    coalesce(la.action_status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted'), false)
      or coalesce(i.metadata #>> '{recovery,state}', '') in ('reintervention_required', 'resume_authorization_expired')
      as action_required_derived,
    (i.incident_type = 'system_test_incident' or lower(coalesce(i.metadata ->> 'test', 'false')) in ('true', '1', 'yes')) as is_test
  from public.account_incidents i
  left join latest_action la on la.incident_id = i.id
  where i.archived_at is null
), operational as (
  select * from base where not is_test
), filtered as (
  select *
  from base b
  where (p_include_test or not b.is_test)
    and (
      nullif(trim(coalesce(p_search, '')), '') is null
      or coalesce(b.account_username, '') ilike '%' || trim(p_search) || '%'
      or coalesce(b.reason, '') ilike '%' || trim(p_search) || '%'
      or coalesce(b.failure_reason, '') ilike '%' || trim(p_search) || '%'
      or b.incident_type ilike '%' || trim(p_search) || '%'
    )
    and case lower(coalesce(p_filter, 'open'))
      when 'action_required' then b.status in ('open', 'acknowledged') and b.action_required_derived
      when 'resolved' then b.status in ('resolved', 'ignored')
      when 'all' then true
      else b.status in ('open', 'acknowledged') and not b.action_required_derived
    end
), cursor_filtered as (
  select *
  from filtered f
  where p_cursor_last_seen_at is null
    or p_cursor_id is null
    or (f.last_seen_at, f.id) < (p_cursor_last_seen_at, p_cursor_id)
), page_plus_one as (
  select * from cursor_filtered
  order by last_seen_at desc, id desc
  limit least(100, greatest(1, coalesce(p_limit, 50))) + 1
), page_rows as (
  select * from page_plus_one
  order by last_seen_at desc, id desc
  limit least(100, greatest(1, coalesce(p_limit, 50)))
), last_row as (
  select last_seen_at, id from page_rows order by last_seen_at asc, id asc limit 1
), global_counters as (
  select
    count(*) filter (where status in ('open', 'acknowledged') and not action_required_derived) as open_count,
    count(*) filter (where status in ('open', 'acknowledged') and action_required_derived) as action_required_count,
    count(*) filter (where status in ('resolved', 'ignored')) as resolved_count,
    count(*) as total_count,
    count(*) filter (where exists (
      select 1 from public.account_incident_notifications n
      where n.incident_id = operational.id and n.status = 'failed'
    )) as delivery_degraded_count
  from operational
)
select jsonb_build_object(
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'status', r.status,
      'severity', r.severity,
      'incident_type', r.incident_type,
      'reason', r.reason,
      'failure_reason', r.failure_reason,
      'action_required', r.action_required,
      'admin_message', r.admin_message,
      'account_id', r.account_id,
      'account_username', r.account_username,
      'run_id', r.run_id,
      'occurrence_count', r.occurrence_count,
      'first_seen_at', r.first_seen_at,
      'last_seen_at', r.last_seen_at,
      'resolved_at', r.resolved_at,
      'source', r.source,
      'metadata', r.metadata,
      'operator_action_id', r.operator_action_id,
      'operator_action_status', r.operator_action_status,
      'is_test', r.is_test
    ) order by r.last_seen_at desc, r.id desc) from page_rows r
  ), '[]'::jsonb),
  'filtered_total', (select count(*) from filtered),
  'has_more', (select count(*) from page_plus_one) > least(100, greatest(1, coalesce(p_limit, 50))),
  'next_cursor', case
    when (select count(*) from page_plus_one) > least(100, greatest(1, coalesce(p_limit, 50)))
    then (select jsonb_build_object('last_seen_at', last_seen_at, 'id', id) from last_row)
    else null
  end,
  'counters', (select jsonb_build_object(
    'open', open_count,
    'actionRequired', action_required_count,
    'resolved', resolved_count,
    'deliveryDegraded', delivery_degraded_count,
    'total', total_count
  ) from global_counters)
)
$$;

create or replace function public.run_incident_retention_cleanup_v1(
  p_batch_size integer default null,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_policy public.incident_retention_policies%rowtype;
  v_run_id uuid;
  v_batch integer;
  v_examined integer := 0;
  v_archived integer := 0;
  v_deleted integer := 0;
  v_deliveries integer := 0;
begin
  select * into strict v_policy
  from public.incident_retention_policies
  where policy_key = 'default';
  v_batch := least(1000, greatest(1, coalesce(p_batch_size, v_policy.cleanup_batch_size)));

  insert into public.incident_cleanup_runs(policy_version, batch_size, dry_run)
  values (v_policy.policy_version, v_batch, p_dry_run)
  returning id into v_run_id;

  begin
    if not pg_try_advisory_xact_lock(hashtextextended('incident_retention_cleanup_v1', 0)) then
      update public.incident_cleanup_runs
      set status = 'skipped_locked', completed_at = now(), metadata = '{"reason":"advisory_lock_busy"}'::jsonb
      where id = v_run_id;
      return jsonb_build_object('ok', true, 'status', 'skipped_locked', 'run_id', v_run_id);
    end if;

    if not v_policy.enabled then
      update public.incident_cleanup_runs
      set status = 'disabled', completed_at = now()
      where id = v_run_id;
      return jsonb_build_object('ok', true, 'status', 'disabled', 'run_id', v_run_id);
    end if;

    select count(*) into v_examined
    from (
      select i.id
      from public.account_incidents i
      where i.status in ('resolved', 'ignored')
        and i.archived_at is null
        and i.legal_hold = false
        and i.purge_after <= now()
        and not exists (
          select 1 from public.account_dashboard_actions a
          where a.incident_id = i.id
            and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
        )
      order by i.purge_after, i.id
      limit v_batch
    ) candidates;

    if not p_dry_run then
      with candidates as (
        select i.id
        from public.account_incidents i
        where i.status in ('resolved', 'ignored')
          and i.archived_at is null
          and i.legal_hold = false
          and i.purge_after <= now()
          and not exists (
            select 1 from public.account_dashboard_actions a
            where a.incident_id = i.id
              and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
          )
        order by i.purge_after, i.id
        for update skip locked
        limit v_batch
      ), archived as (
        update public.account_incidents i
        set archived_at = now(), updated_at = now(), retention_policy_version = v_policy.policy_version
        from candidates c
        where i.id = c.id
        returning i.id
      ) select count(*) into v_archived from archived;

      with candidates as (
        select n.id
        from public.account_incident_notifications n
        join public.account_incidents i on i.id = n.incident_id
        where n.created_at < now() - make_interval(days => v_policy.delivery_log_days)
          and (i.status in ('resolved', 'ignored') or i.archived_at is not null)
          and not exists (
            select 1 from public.account_dashboard_actions a
            where a.incident_id = i.id
              and a.status in ('pending', 'acknowledged', 'pending_verification', 'code_submitted')
          )
        order by n.created_at, n.id
        for update of n skip locked
        limit v_batch
      ), deleted as (
        delete from public.account_incident_notifications n
        using candidates c where n.id = c.id returning n.id
      ) select count(*) into v_deliveries from deleted;

      with candidates as (
        select i.id
        from public.account_incidents i
        where i.archived_at < now() - make_interval(days => v_policy.physical_delete_grace_days)
          and i.legal_hold = false
          and i.run_id is null
          and i.source_event_id is null
          and coalesce(i.metadata ->> 'run_request_id', '') = ''
          and not exists (select 1 from public.account_dashboard_actions a where a.incident_id = i.id)
        order by i.archived_at, i.id
        for update skip locked
        limit v_batch
      ), deleted as (
        delete from public.account_incidents i
        using candidates c where i.id = c.id returning i.id
      ) select count(*) into v_deleted from deleted;
    end if;

    update public.incident_cleanup_runs
    set completed_at = now(), status = 'completed', rows_examined = v_examined,
        incidents_archived = v_archived, incidents_deleted = v_deleted,
        deliveries_deleted = v_deliveries
    where id = v_run_id;
  exception when others then
    update public.incident_cleanup_runs
    set completed_at = now(), status = 'failed', rows_examined = v_examined,
        incidents_archived = v_archived, incidents_deleted = v_deleted,
        deliveries_deleted = v_deliveries,
        errors = jsonb_build_array(jsonb_build_object('sqlstate', sqlstate, 'message', left(sqlerrm, 240)))
    where id = v_run_id;
  end;

  return (select jsonb_build_object(
    'ok', status = 'completed', 'status', status, 'run_id', id,
    'policy_version', policy_version, 'batch_size', batch_size,
    'dry_run', dry_run, 'rows_examined', rows_examined,
    'incidents_archived', incidents_archived, 'incidents_deleted', incidents_deleted,
    'deliveries_deleted', deliveries_deleted, 'errors', errors
  ) from public.incident_cleanup_runs where id = v_run_id);
end
$$;

revoke all on function public.set_account_incident_retention_v1() from public, anon, authenticated;
revoke all on function public.get_account_incidents_overview_v1(text, integer, timestamptz, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.run_incident_retention_cleanup_v1(integer, boolean) from public, anon, authenticated;
grant execute on function public.get_account_incidents_overview_v1(text, integer, timestamptz, uuid, text, boolean) to service_role;
grant execute on function public.run_incident_retention_cleanup_v1(integer, boolean) to service_role;

create extension if not exists pg_cron with schema extensions;
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'incident-retention-cleanup-daily-v1';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'incident-retention-cleanup-daily-v1',
    '17 3 * * *',
    'select public.run_incident_retention_cleanup_v1();'
  );
end
$$;
