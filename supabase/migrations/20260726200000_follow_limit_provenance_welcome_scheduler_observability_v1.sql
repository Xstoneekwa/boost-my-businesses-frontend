-- Follow limits: explicit override provenance and preserved unclassified legacy
-- values. No row means package inheritance. Warmup never writes here.
create table if not exists public.ig_account_follow_limit_overrides (
  account_id uuid primary key references public.ig_accounts(id) on delete cascade,
  classification text not null default 'explicit',
  follow_day_cap_override integer,
  follow_session_cap_override integer,
  max_follow_per_run_legacy integer,
  source text not null,
  source_surface text,
  updated_by uuid,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ig_account_follow_limit_overrides_classification_bounded
    check (classification in ('explicit','legacy_unclassified')),
  constraint ig_account_follow_limit_overrides_day_positive
    check (follow_day_cap_override is null or follow_day_cap_override > 0),
  constraint ig_account_follow_limit_overrides_session_positive
    check (follow_session_cap_override is null or follow_session_cap_override > 0),
  constraint ig_account_follow_limit_overrides_run_positive
    check (max_follow_per_run_legacy is null or max_follow_per_run_legacy > 0),
  constraint ig_account_follow_limit_overrides_cap_present
    check (
      follow_day_cap_override is not null
      or follow_session_cap_override is not null
      or max_follow_per_run_legacy is not null
    ),
  constraint ig_account_follow_limit_overrides_source_bounded
    check (source in ('admin','support','migration_confirmed','migration_unclassified'))
);

comment on table public.ig_account_follow_limit_overrides is
  'Explicit human Follow cap overrides and preserved unclassified legacy values. No row means package inheritance. Warmup never writes here.';
alter table public.ig_account_follow_limit_overrides enable row level security;
revoke all on table public.ig_account_follow_limit_overrides from public, anon, authenticated;
grant select, insert, update, delete on table public.ig_account_follow_limit_overrides to service_role;

-- Preserve existing lower values whose origin cannot be proved.  This is a
-- provenance backfill only: it does not change ig_account_settings.  Fields
-- already equal to the package are left null so future package changes remain
-- inherited rather than becoming accidental overrides.
insert into public.ig_account_follow_limit_overrides (
  account_id,
  classification,
  follow_day_cap_override,
  follow_session_cap_override,
  max_follow_per_run_legacy,
  source,
  source_surface,
  reason
)
select
  s.account_id,
  'legacy_unclassified',
  case when s.max_actions_per_day between 1 and caps.follow_day - 1
    then s.max_actions_per_day end,
  case when s.follow_limit between 1 and caps.follow_session - 1
    then s.follow_limit end,
  case when s.max_follow_per_run between 1 and caps.follow_session - 1
    then s.max_follow_per_run end,
  'migration_unclassified',
  'legacy_current_state_audit',
  'current_lower_value_without_provenance'
from public.ig_account_settings s
join public.account_package_summary aps on aps.account_id = s.account_id
cross join lateral (
  select
    nullif(aps.package_caps ->> 'follow_day', '')::integer as follow_day,
    nullif(aps.package_caps ->> 'follow_session', '')::integer as follow_session
) caps
where caps.follow_day > 0
  and caps.follow_session > 0
  and (
    s.max_actions_per_day between 1 and caps.follow_day - 1
    or s.follow_limit between 1 and caps.follow_session - 1
    or s.max_follow_per_run between 1 and caps.follow_session - 1
  )
on conflict (account_id) do nothing;

create or replace function public.apply_account_follow_limit_provenance_v1(
  p_account_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.ig_account_follow_limit_overrides%rowtype;
  v_package_day integer;
  v_package_session integer;
  v_day integer;
  v_session integer;
  v_run integer;
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
begin
  select
    nullif(aps.package_caps ->> 'follow_day', '')::integer,
    nullif(aps.package_caps ->> 'follow_session', '')::integer
  into v_package_day, v_package_session
  from public.account_package_summary aps
  where aps.account_id = p_account_id;

  if coalesce(v_package_day, 0) <= 0 or coalesce(v_package_session, 0) <= 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'package_settings_incomplete',
      'account_id', p_account_id
    );
  end if;

  select * into v_policy
  from public.ig_account_follow_limit_overrides o
  where o.account_id = p_account_id;

  v_day := least(v_package_day, coalesce(v_policy.follow_day_cap_override, v_package_day));
  v_session := least(v_package_session, coalesce(v_policy.follow_session_cap_override, v_package_session));
  v_run := least(
    v_session,
    coalesce(v_policy.max_follow_per_run_legacy, v_session)
  );

  perform set_config('bmb.package_contract_reconcile', 'on', true);
  update public.ig_account_settings s
  set max_actions_per_day = v_day,
      follow_limit = v_session,
      max_follow_per_run = v_run,
      updated_at = case
        when (s.max_actions_per_day, s.follow_limit, s.max_follow_per_run)
          is distinct from (v_day, v_session, v_run)
        then now()
        else s.updated_at
      end
  where s.account_id = p_account_id;
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);

  return jsonb_build_object(
    'ok', true,
    'reason', case
      when v_policy.account_id is null then 'package_inherited'
      else v_policy.classification
    end,
    'account_id', p_account_id,
    'package_day', v_package_day,
    'package_session', v_package_session,
    'configured_day', v_day,
    'configured_session', v_session,
    'legacy_run_cap', v_run
  );
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$$;
revoke all on function public.apply_account_follow_limit_provenance_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.apply_account_follow_limit_provenance_v1(uuid)
  to service_role;

-- The previous reconciler preserved every positive lower legacy value because
-- provenance did not yet exist. Keep it as an implementation detail, then
-- enforce the new provenance policy in the canonical wrapper.
alter function public.reconcile_account_package_runtime_contract(uuid, text)
  rename to reconcile_account_package_runtime_contract_legacy_limit_restore_v1;

revoke all on function public.reconcile_account_package_runtime_contract_legacy_limit_restore_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_account_package_runtime_contract_legacy_limit_restore_v1(uuid, text)
  to service_role;

create or replace function public.reconcile_account_package_runtime_contract(
  p_account_id uuid,
  p_source text default 'canonical_reconcile'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_limits jsonb;
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
begin
  perform set_config('bmb.package_contract_reconcile', 'on', true);
  v_result := public.reconcile_account_package_runtime_contract_legacy_limit_restore_v1(
    p_account_id,
    p_source
  );
  v_limits := public.apply_account_follow_limit_provenance_v1(p_account_id);
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  return coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('follow_limit_provenance', v_limits);
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$$;
revoke all on function public.reconcile_account_package_runtime_contract(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_account_package_runtime_contract(uuid, text)
  to service_role;

create or replace function public.set_account_follow_limit_override_v1(
  p_account_id uuid,
  p_follow_day_cap integer,
  p_follow_session_cap integer,
  p_source text default 'admin',
  p_source_surface text default 'instagram_dashboard_settings',
  p_updated_by uuid default null,
  p_reason text default 'explicit_settings_save'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package_day integer;
  v_package_session integer;
  v_source text := case when p_source in ('admin','support') then p_source else 'admin' end;
  v_result jsonb;
begin
  select
    nullif(aps.package_caps ->> 'follow_day', '')::integer,
    nullif(aps.package_caps ->> 'follow_session', '')::integer
  into v_package_day, v_package_session
  from public.account_package_summary aps
  where aps.account_id = p_account_id;

  if coalesce(v_package_day, 0) <= 0 or coalesce(v_package_session, 0) <= 0 then
    raise exception 'package_settings_incomplete' using errcode = '22023';
  end if;
  if p_follow_day_cap not between 1 and v_package_day
     or p_follow_session_cap not between 1 and v_package_session then
    raise exception 'follow_cap_outside_package' using errcode = '22023';
  end if;

  if p_follow_day_cap = v_package_day and p_follow_session_cap = v_package_session then
    delete from public.ig_account_follow_limit_overrides where account_id = p_account_id;
  else
    insert into public.ig_account_follow_limit_overrides (
      account_id,
      classification,
      follow_day_cap_override,
      follow_session_cap_override,
      max_follow_per_run_legacy,
      source,
      source_surface,
      updated_by,
      reason,
      updated_at
    ) values (
      p_account_id,
      'explicit',
      p_follow_day_cap,
      p_follow_session_cap,
      p_follow_session_cap,
      v_source,
      nullif(trim(p_source_surface), ''),
      p_updated_by,
      nullif(trim(p_reason), ''),
      now()
    )
    on conflict (account_id) do update
    set classification = 'explicit',
        follow_day_cap_override = excluded.follow_day_cap_override,
        follow_session_cap_override = excluded.follow_session_cap_override,
        max_follow_per_run_legacy = excluded.max_follow_per_run_legacy,
        source = excluded.source,
        source_surface = excluded.source_surface,
        updated_by = excluded.updated_by,
        reason = excluded.reason,
        updated_at = excluded.updated_at;
  end if;

  v_result := public.apply_account_follow_limit_provenance_v1(p_account_id);
  return v_result || jsonb_build_object(
    'override_active', p_follow_day_cap <> v_package_day or p_follow_session_cap <> v_package_session
  );
end;
$$;
revoke all on function public.set_account_follow_limit_override_v1(uuid, integer, integer, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_account_follow_limit_override_v1(uuid, integer, integer, text, text, uuid, text)
  to service_role;

create table if not exists public.schedule_session_cron_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  worker_id text not null,
  dry_run boolean not null default false,
  state text not null,
  evaluated_accounts jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  constraint schedule_session_cron_runs_accounts_array check (jsonb_typeof(evaluated_accounts) = 'array'),
  constraint schedule_session_cron_runs_summary_object check (jsonb_typeof(summary) = 'object')
);
create index if not exists schedule_session_cron_runs_created_at_idx
  on public.schedule_session_cron_runs (created_at desc);
alter table public.schedule_session_cron_runs enable row level security;
revoke all on table public.schedule_session_cron_runs from public, anon, authenticated;
grant select, insert on table public.schedule_session_cron_runs to service_role;

create or replace function public.resolve_welcome_template_missing_incidents_v1(
  p_account_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident record;
  v_count integer := 0;
begin
  for v_incident in
    select id, lifecycle_version
      from public.account_incidents
     where account_id = p_account_id
       and incident_type = 'account_configuration_failure'
       and reason = 'welcome_template_missing'
       and status in ('open','acknowledged')
     for update
  loop
    perform public.transition_account_incident_human_review_v1(
      v_incident.id,
      'resolve',
      v_incident.lifecycle_version,
      'system',
      null,
      'system',
      'Welcome configuration revalidated by Scheduler.',
      'configuration_corrected',
      'welcome-template-resolved:' || v_incident.id::text || ':' || v_incident.lifecycle_version::text,
      null,
      null
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.resolve_welcome_template_missing_incidents_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_welcome_template_missing_incidents_v1(uuid)
  to service_role;
