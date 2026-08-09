-- Canonical Unfollow limit provenance.
--
-- The historical ig_account_unfollow_settings schema defaults (50/session,
-- 200/day) are created before a client onboarding account has an assignment.
-- The first package reconciliation therefore used to mistake a positive
-- schema default for an explicit lower account override. This migration gives
-- explicit/ambiguous overrides their own source of truth and makes absence of
-- an override mean package inheritance, matching the existing Follow contract.

create table if not exists public.ig_account_unfollow_limit_overrides (
  account_id uuid primary key references public.ig_accounts(id) on delete cascade,
  classification text not null default 'explicit',
  unfollow_day_cap_override integer,
  unfollow_session_cap_override integer,
  source text not null,
  source_surface text,
  updated_by uuid,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ig_account_unfollow_limit_overrides_classification_bounded
    check (classification in ('explicit', 'legacy_unclassified')),
  constraint ig_account_unfollow_limit_overrides_day_positive
    check (unfollow_day_cap_override is null or unfollow_day_cap_override > 0),
  constraint ig_account_unfollow_limit_overrides_session_positive
    check (unfollow_session_cap_override is null or unfollow_session_cap_override > 0),
  constraint ig_account_unfollow_limit_overrides_cap_present
    check (unfollow_day_cap_override is not null or unfollow_session_cap_override is not null),
  constraint ig_account_unfollow_limit_overrides_source_bounded
    check (source in ('admin', 'support', 'migration_confirmed', 'migration_unclassified'))
);

comment on table public.ig_account_unfollow_limit_overrides is
  'Explicit human Unfollow cap overrides and preserved ambiguous legacy values. No row means package inheritance.';

alter table public.ig_account_unfollow_limit_overrides enable row level security;
alter table public.ig_account_unfollow_limit_overrides force row level security;
revoke all on table public.ig_account_unfollow_limit_overrides from public, anon, authenticated;
grant select, insert, update, delete on table public.ig_account_unfollow_limit_overrides to service_role;

-- Preserve every existing lower value whose origin cannot be proven. The one
-- excluded shape is narrowly proven canonical-onboarding contamination:
-- schema-default 50/session, package day already materialized, canonical
-- onboarding timestamps, package snapshot, assignment reconcile, and no
-- settings-save audit. This is generic and contains no account or username.
insert into public.ig_account_unfollow_limit_overrides (
  account_id,
  classification,
  unfollow_day_cap_override,
  unfollow_session_cap_override,
  source,
  source_surface,
  reason
)
select
  s.account_id,
  'legacy_unclassified',
  case when s.unfollow_per_day_limit between 1 and caps.unfollow_day - 1
    then s.unfollow_per_day_limit end,
  case when s.unfollow_per_session_limit between 1 and caps.unfollow_session - 1
    then s.unfollow_per_session_limit end,
  'migration_unclassified',
  'legacy_current_state_audit',
  'current_lower_value_without_provenance'
from public.ig_account_unfollow_settings s
join public.ig_accounts a on a.id = s.account_id
join public.account_package_summary aps on aps.account_id = s.account_id
cross join lateral (
  select
    nullif(aps.package_caps ->> 'unfollow_day', '')::integer as unfollow_day,
    nullif(aps.package_caps ->> 'unfollow_session', '')::integer as unfollow_session
) caps
where caps.unfollow_day > 0
  and caps.unfollow_session > 0
  and (
    s.unfollow_per_day_limit between 1 and caps.unfollow_day - 1
    or s.unfollow_per_session_limit between 1 and caps.unfollow_session - 1
  )
  and not (
    s.unfollow_per_day_limit = caps.unfollow_day
    and s.unfollow_per_session_limit = 50
    and caps.unfollow_session > 50
    and s.runtime_cap_mode = 'prod_normal'
    and s.runtime_safety_cap is null
    and s.package_default_snapshot ->> 'source' = 'commercial_packages'
    and nullif(s.package_default_snapshot ->> 'unfollow_day', '')::integer = caps.unfollow_day
    and nullif(s.package_default_snapshot ->> 'unfollow_session', '')::integer = caps.unfollow_session
    and abs(extract(epoch from (s.created_at - a.created_at))) < 1
    and exists (
      select 1
      from public.client_instagram_onboarding_sessions onb
      where onb.account_id = s.account_id
        and onb.status = 'completed'
        and abs(extract(epoch from (onb.created_at - a.created_at))) < 1
    )
    and exists (
      select 1
      from public.account_package_runtime_contract_events ev
      where ev.account_id = s.account_id
        and ev.event_type = 'package_runtime_contract_reconciled'
        and ev.source = 'assignment_trigger'
        and ev.details_safe ->> 'override_policy' = 'positive_account_override_lte_package'
        and abs(extract(epoch from (ev.created_at - s.updated_at))) < 1
    )
    and not exists (
      select 1
      from public.ig_action_logs al
      where al.account_id = s.account_id
        and al.action_type = 'unfollow_domain_settings_saved'
        and al.status = 'success'
        and al.created_at <= s.updated_at
    )
  )
on conflict (account_id) do nothing;

create or replace function public.apply_account_unfollow_limit_provenance_v1(
  p_account_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.ig_account_unfollow_limit_overrides%rowtype;
  v_package_day integer;
  v_package_session integer;
  v_day integer;
  v_session integer;
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
begin
  select
    nullif(aps.package_caps ->> 'unfollow_day', '')::integer,
    nullif(aps.package_caps ->> 'unfollow_session', '')::integer
  into v_package_day, v_package_session
  from public.account_package_summary aps
  where aps.account_id = p_account_id;

  if coalesce(v_package_day, 0) <= 0 or coalesce(v_package_session, 0) <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'package_settings_incomplete', 'account_id', p_account_id);
  end if;

  select * into v_policy
  from public.ig_account_unfollow_limit_overrides o
  where o.account_id = p_account_id;

  v_day := least(v_package_day, coalesce(v_policy.unfollow_day_cap_override, v_package_day));
  v_session := least(v_package_session, coalesce(v_policy.unfollow_session_cap_override, v_package_session));

  perform set_config('bmb.package_contract_reconcile', 'on', true);
  update public.ig_account_unfollow_settings s
  set unfollow_per_day_limit = v_day,
      unfollow_per_session_limit = v_session,
      updated_at = case
        when (s.unfollow_per_day_limit, s.unfollow_per_session_limit) is distinct from (v_day, v_session)
          then now()
        else s.updated_at
      end
  where s.account_id = p_account_id;
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);

  return jsonb_build_object(
    'ok', true,
    'reason', case when v_policy.account_id is null then 'package_inherited' else v_policy.classification end,
    'account_id', p_account_id,
    'package_day', v_package_day,
    'package_session', v_package_session,
    'configured_day', v_day,
    'configured_session', v_session
  );
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$$;

revoke all on function public.apply_account_unfollow_limit_provenance_v1(uuid) from public, anon, authenticated;
grant execute on function public.apply_account_unfollow_limit_provenance_v1(uuid) to service_role;

-- Wrap the existing canonical reconciler. Follow provenance remains fully
-- authoritative inside the predecessor; this final layer applies the parallel
-- Unfollow provenance after legacy values have been observed/materialized.
alter function public.reconcile_account_package_runtime_contract(uuid, text)
  rename to reconcile_account_package_runtime_contract_follow_provenance_v1;

revoke all on function public.reconcile_account_package_runtime_contract_follow_provenance_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_account_package_runtime_contract_follow_provenance_v1(uuid, text)
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
  v_result := public.reconcile_account_package_runtime_contract_follow_provenance_v1(p_account_id, p_source);
  v_limits := public.apply_account_unfollow_limit_provenance_v1(p_account_id);
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('unfollow_limit_provenance', v_limits);
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$$;

revoke all on function public.reconcile_account_package_runtime_contract(uuid, text) from public, anon, authenticated;
grant execute on function public.reconcile_account_package_runtime_contract(uuid, text) to service_role;

create or replace function public.set_account_unfollow_limit_override_v1(
  p_account_id uuid,
  p_unfollow_day_cap integer,
  p_unfollow_session_cap integer,
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
  v_source text := case when p_source in ('admin', 'support') then p_source else 'admin' end;
  v_result jsonb;
begin
  select
    nullif(aps.package_caps ->> 'unfollow_day', '')::integer,
    nullif(aps.package_caps ->> 'unfollow_session', '')::integer
  into v_package_day, v_package_session
  from public.account_package_summary aps
  where aps.account_id = p_account_id;

  if coalesce(v_package_day, 0) <= 0 or coalesce(v_package_session, 0) <= 0 then
    raise exception 'package_settings_incomplete' using errcode = '22023';
  end if;
  if p_unfollow_day_cap not between 1 and v_package_day
     or p_unfollow_session_cap not between 1 and v_package_session
     or p_unfollow_session_cap > p_unfollow_day_cap then
    raise exception 'unfollow_cap_outside_package' using errcode = '22023';
  end if;

  if p_unfollow_day_cap = v_package_day and p_unfollow_session_cap = v_package_session then
    delete from public.ig_account_unfollow_limit_overrides where account_id = p_account_id;
  else
    insert into public.ig_account_unfollow_limit_overrides (
      account_id, classification, unfollow_day_cap_override, unfollow_session_cap_override,
      source, source_surface, updated_by, reason, updated_at
    ) values (
      p_account_id, 'explicit', p_unfollow_day_cap, p_unfollow_session_cap,
      v_source, nullif(trim(p_source_surface), ''), p_updated_by, nullif(trim(p_reason), ''), now()
    )
    on conflict (account_id) do update
    set classification = 'explicit',
        unfollow_day_cap_override = excluded.unfollow_day_cap_override,
        unfollow_session_cap_override = excluded.unfollow_session_cap_override,
        source = excluded.source,
        source_surface = excluded.source_surface,
        updated_by = excluded.updated_by,
        reason = excluded.reason,
        updated_at = excluded.updated_at;
  end if;

  v_result := public.apply_account_unfollow_limit_provenance_v1(p_account_id);
  return v_result || jsonb_build_object(
    'override_active', p_unfollow_day_cap <> v_package_day or p_unfollow_session_cap <> v_package_session
  );
end;
$$;

revoke all on function public.set_account_unfollow_limit_override_v1(uuid, integer, integer, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_account_unfollow_limit_override_v1(uuid, integer, integer, text, text, uuid, text)
  to service_role;

-- Apply the provenance policy once. Ambiguous/explicit lower values were
-- preserved above; package-default contamination has no override row and is
-- therefore repaired from the package source of truth.
do $$
declare
  v_account_id uuid;
begin
  for v_account_id in
    select aps.account_id
    from public.account_package_summary aps
    where coalesce(nullif(aps.package_caps ->> 'unfollow_day', '')::integer, 0) > 0
      and coalesce(nullif(aps.package_caps ->> 'unfollow_session', '')::integer, 0) > 0
  loop
    perform public.apply_account_unfollow_limit_provenance_v1(v_account_id);
  end loop;
end;
$$;
