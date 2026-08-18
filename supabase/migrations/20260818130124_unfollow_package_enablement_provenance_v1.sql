-- Stage A: canonical Unfollow package enablement inheritance.
--
-- Contract:
--   * package capability is derived from the active commercial package;
--   * no override row means package inheritance;
--   * an override row is an explicit human/admin decision;
--   * runtime blocks, candidate availability and phase executability remain
--     separate gates and are not materialized here;
--   * ig_account_unfollow_settings.unfollow_enabled is the effective,
--     Worker-readable materialization; ig_account_settings is a legacy mirror.

create table if not exists public.ig_account_unfollow_enablement_overrides (
  account_id uuid primary key references public.ig_accounts(id) on delete cascade,
  override_enabled boolean not null,
  source text not null,
  source_surface text,
  updated_by uuid,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ig_account_unfollow_enablement_overrides_source_bounded
    check (source in ('admin', 'support', 'migration_confirmed'))
);

comment on table public.ig_account_unfollow_enablement_overrides is
  'Explicit human Unfollow enablement overrides. No row means active-package inheritance.';

alter table public.ig_account_unfollow_enablement_overrides enable row level security;
alter table public.ig_account_unfollow_enablement_overrides force row level security;
revoke all on table public.ig_account_unfollow_enablement_overrides from public, anon, authenticated;
grant select, insert, update, delete on table public.ig_account_unfollow_enablement_overrides to service_role;

-- The settings endpoint has emitted a canonical audit event for each explicit
-- enable/disable change. Preserve the latest such decision. Accounts whose
-- boolean was only written by provisioning/package materializers intentionally
-- receive no override row and therefore inherit their package.
insert into public.ig_account_unfollow_enablement_overrides (
  account_id,
  override_enabled,
  source,
  source_surface,
  updated_by,
  reason,
  created_at,
  updated_at
)
select distinct on (al.account_id)
  al.account_id,
  (al.payload -> 'new_summary' ->> 'unfollow_enabled')::boolean,
  'migration_confirmed',
  coalesce(nullif(al.payload ->> 'source_surface', ''), 'ig_action_logs:unfollow_domain_settings_saved'),
  case
    when coalesce(al.payload ->> 'actor_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (al.payload ->> 'actor_id')::uuid
    else null
  end,
  'confirmed_human_enablement_save',
  al.created_at,
  al.created_at
from public.ig_action_logs al
where al.action_type = 'unfollow_domain_settings_saved'
  and al.status = 'success'
  and coalesce(al.payload -> 'fields_changed', '[]'::jsonb) ? 'unfollow_enabled'
  and jsonb_typeof(al.payload -> 'new_summary' -> 'unfollow_enabled') = 'boolean'
order by al.account_id, al.created_at desc
on conflict (account_id) do nothing;

create or replace function public.apply_account_unfollow_enablement_provenance_v1(
  p_account_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_override public.ig_account_unfollow_enablement_overrides%rowtype;
  v_package_supports boolean := false;
  v_effective boolean := false;
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
begin
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.account_package_summary aps
    where aps.account_id = p_account_id
      and coalesce(nullif(aps.package_caps ->> 'unfollow_day', '')::integer, 0) > 0
      and coalesce(nullif(aps.package_caps ->> 'unfollow_session', '')::integer, 0) > 0
  ) into v_package_supports;

  select * into v_override
  from public.ig_account_unfollow_enablement_overrides o
  where o.account_id = p_account_id;

  -- An explicit true never grants a capability absent from the package.
  v_effective := v_package_supports and coalesce(v_override.override_enabled, true);

  perform set_config('bmb.package_contract_reconcile', 'on', true);
  update public.ig_account_unfollow_settings u
  set unfollow_enabled = v_effective,
      updated_at = case when u.unfollow_enabled is distinct from v_effective then now() else u.updated_at end
  where u.account_id = p_account_id;

  update public.ig_account_settings s
  set unfollow_enabled = v_effective,
      updated_at = case when s.unfollow_enabled is distinct from v_effective then now() else s.updated_at end
  where s.account_id = p_account_id;
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);

  return jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'package_supports_unfollow', v_package_supports,
    'override_present', v_override.account_id is not null,
    'override_enabled', case when v_override.account_id is null then null else v_override.override_enabled end,
    'effective_unfollow_enabled', v_effective,
    'source', case when v_override.account_id is null then 'package_inherited' else 'explicit_override' end
  );
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$$;

revoke all on function public.apply_account_unfollow_enablement_provenance_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.apply_account_unfollow_enablement_provenance_v1(uuid)
  to service_role;

create or replace function public.set_account_unfollow_enablement_override_v1(
  p_account_id uuid,
  p_override_enabled boolean,
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
  v_source text := case when p_source in ('admin', 'support') then p_source else 'admin' end;
  v_result jsonb;
begin
  if p_account_id is null or p_override_enabled is null then
    raise exception 'unfollow_enablement_override_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ig_accounts a where a.id = p_account_id) then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  insert into public.ig_account_unfollow_enablement_overrides (
    account_id, override_enabled, source, source_surface, updated_by, reason, updated_at
  ) values (
    p_account_id, p_override_enabled, v_source, nullif(trim(p_source_surface), ''),
    p_updated_by, nullif(trim(p_reason), ''), now()
  )
  on conflict (account_id) do update
  set override_enabled = excluded.override_enabled,
      source = excluded.source,
      source_surface = excluded.source_surface,
      updated_by = excluded.updated_by,
      reason = excluded.reason,
      updated_at = excluded.updated_at;

  v_result := public.apply_account_unfollow_enablement_provenance_v1(p_account_id);
  return v_result || jsonb_build_object('override_active', true);
end;
$$;

revoke all on function public.set_account_unfollow_enablement_override_v1(uuid, boolean, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_account_unfollow_enablement_override_v1(uuid, boolean, text, text, uuid, text)
  to service_role;

-- Add the new policy after the existing Follow and Unfollow-limit provenance
-- layers without rewriting either predecessor.
do $$
begin
  if to_regprocedure('public.reconcile_package_runtime_before_unfollow_enablement_v1(uuid,text)') is null then
    if to_regprocedure('public.reconcile_account_package_runtime_contract(uuid,text)') is null then
      raise exception 'canonical_package_runtime_reconciler_missing';
    end if;
    alter function public.reconcile_account_package_runtime_contract(uuid, text)
      rename to reconcile_package_runtime_before_unfollow_enablement_v1;
  end if;
end;
$$;

revoke all on function public.reconcile_package_runtime_before_unfollow_enablement_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_package_runtime_before_unfollow_enablement_v1(uuid, text)
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
  v_enablement jsonb;
  v_previous_guard text := coalesce(current_setting('bmb.package_contract_reconcile', true), '');
begin
  perform set_config('bmb.package_contract_reconcile', 'on', true);
  v_result := public.reconcile_package_runtime_before_unfollow_enablement_v1(p_account_id, p_source);
  v_enablement := public.apply_account_unfollow_enablement_provenance_v1(p_account_id);
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('unfollow_enablement_provenance', v_enablement);
exception when others then
  perform set_config('bmb.package_contract_reconcile', v_previous_guard, true);
  raise;
end;
$$;

revoke all on function public.reconcile_account_package_runtime_contract(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_account_package_runtime_contract(uuid, text)
  to service_role;

-- Package cancellation can make the predecessor intentionally report
-- package_settings_incomplete. Apply the Unfollow capability transition
-- outside the caught predecessor subtransaction so cancellation still
-- disables the effective phase and reactivation can inherit again.
create or replace function public.reconcile_account_package_runtime_contract_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_account_id uuid;
begin
  if coalesce(current_setting('bmb.package_contract_reconcile', true), '') = 'on' then
    return new;
  end if;
  v_account_id := case
    when tg_table_name = 'client_account_entitlements' then coalesce(new.account_id, old.account_id)
    else new.account_id
  end;
  if v_account_id is null then return new; end if;

  perform public.apply_account_unfollow_enablement_provenance_v1(v_account_id);
  begin
    perform public.reconcile_account_package_runtime_contract(v_account_id, tg_table_name || '_trigger');
  exception when others then
    insert into public.account_package_runtime_contract_events (
      account_id, event_type, source, details_safe
    ) values (
      v_account_id, 'package_runtime_contract_blocked', tg_table_name || '_trigger',
      jsonb_build_object('reason', case when sqlerrm in ('package_settings_incomplete','assignment_package_mismatch','app_instance_package_mismatch','clone_package_mismatch','runtime_profile_mismatch') then sqlerrm else 'contract_reconcile_failed' end)
    );
  end;
  return new;
end;
$$;

-- The provisioning sync used to force false after the package contract was
-- already known. Preserve its unrelated safety defaults but finish by applying
-- the canonical package/override policy instead of hard-coding Unfollow off.
create or replace function public.sync_instagram_account_runtime_settings_after_provisioning(
  p_account_id uuid,
  p_actor_type text default 'system',
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor_type text := lower(coalesce(nullif(trim(p_actor_type), ''), 'system'));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_package_name text;
  v_app_instance_id uuid;
  v_device_id uuid;
  v_settings_updated boolean := false;
  v_dm_settings_updated boolean := false;
  v_unfollow_settings_updated boolean := false;
  v_enablement jsonb;
begin
  if p_account_id is null then
    raise exception 'account_id_required' using errcode = '22023';
  end if;
  if v_actor_type not in ('client', 'admin', 'assistant', 'ops', 'internal', 'system', 'worker', 'provisioner') then
    raise exception 'invalid_runtime_settings_actor_type' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'reason too long' using errcode = '22023';
  end if;
  if jsonb_typeof(v_metadata) is distinct from 'object' then
    raise exception 'metadata must be a json object' using errcode = '22023';
  end if;

  select pai.package_name, pai.id, pai.device_id
    into v_package_name, v_app_instance_id, v_device_id
  from public.account_assignments aa
  join public.phone_app_instances pai on pai.id = aa.app_instance_id
  where aa.account_id = p_account_id
    and aa.released_at is null
    and aa.status in ('reserved', 'active')
    and nullif(trim(coalesce(pai.package_name, '')), '') is not null
  order by aa.assigned_at desc nulls last, aa.created_at desc
  limit 1;

  if nullif(trim(coalesce(v_package_name, '')), '') is null then
    return jsonb_build_object('ok', false, 'applied', false, 'reason', 'active_assignment_package_missing', 'account_id', p_account_id);
  end if;

  update public.ig_account_settings s
  set app_package = v_package_name,
      follow_enabled = true,
      like_enabled = true,
      mute_posts_after_follow = true,
      mute_stories_after_follow = true,
      welcome_dm_enabled = false,
      cold_dm_enabled = false,
      updated_at = now()
  where s.account_id = p_account_id;
  get diagnostics v_settings_updated = row_count;

  update public.ig_account_dm_settings d
  set welcome_enabled = false,
      outreach_enabled = false,
      updated_at = now()
  where d.account_id = p_account_id;
  get diagnostics v_dm_settings_updated = row_count;

  v_enablement := public.apply_account_unfollow_enablement_provenance_v1(p_account_id);
  v_unfollow_settings_updated := coalesce((v_enablement ->> 'ok')::boolean, false);

  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'reason', 'runtime_settings_synced_after_provisioning',
    'account_id', p_account_id,
    'package_name', v_package_name,
    'app_instance_id', v_app_instance_id,
    'device_id', v_device_id,
    'settings_updated', v_settings_updated,
    'dm_settings_updated', v_dm_settings_updated,
    'unfollow_settings_updated', v_unfollow_settings_updated,
    'follow_enabled', true,
    'like_enabled', true,
    'mute_posts_after_follow', true,
    'mute_stories_after_follow', true,
    'welcome_enabled', false,
    'outreach_enabled', false,
    'unfollow_enabled', coalesce((v_enablement ->> 'effective_unfollow_enabled')::boolean, false),
    'unfollow_enablement_source', v_enablement ->> 'source'
  );
end;
$$;

revoke all on function public.sync_instagram_account_runtime_settings_after_provisioning(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_instagram_account_runtime_settings_after_provisioning(uuid, text, text, jsonb)
  to service_role;

-- One deterministic, account-agnostic reconciliation. Explicit overrides are
-- already preserved above; no caps, delays, candidates or receipts are touched.
do $$
declare
  v_account_id uuid;
begin
  for v_account_id in select a.id from public.ig_accounts a
  loop
    perform public.apply_account_unfollow_enablement_provenance_v1(v_account_id);
  end loop;
end;
$$;
