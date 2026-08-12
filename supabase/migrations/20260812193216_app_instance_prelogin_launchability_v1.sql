begin;

-- Identity and review gates are business-runtime gates. They must never turn a
-- healthy, assigned Instagram app instance into a technically disabled clone,
-- because that would also prevent the login/recovery flow needed to satisfy
-- the gate.
create or replace function public.is_login_provisioning_business_gate_v1(p_reason text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(trim(coalesce(p_reason, ''))) in (
    'identity_required_unverified',
    'login_identity_not_verified',
    'instagram_identity_review_pending_identity_unverified',
    'instagram_review_pending',
    'identity_review_required',
    'review_required',
    'challenge_pending',
    'verification_required',
    'identity_mismatch',
    'login_identity_mismatch'
  );
$$;

comment on function public.is_login_provisioning_business_gate_v1(text) is
  'True only for business identity/review gates that block growth actions but allow login provisioning and recovery.';

alter table public.phone_app_instances
  drop constraint if exists phone_app_instances_business_gate_launchability_v1;

alter table public.phone_app_instances
  add constraint phone_app_instances_business_gate_launchability_v1
  check (
    not public.is_login_provisioning_business_gate_v1(metadata ->> 'runtime_block_reason')
    or lower(coalesce(metadata ->> 'generation', '')) = 'legacy_pre_reprovision'
    or nullif(trim(coalesce(metadata ->> 'replaced_by_app_instance_id', '')), '') is not null
    or coalesce((metadata ->> 'maintenance')::boolean, false) = true
    or coalesce((metadata ->> 'corrupt')::boolean, false) = true
    or coalesce((metadata ->> 'removed')::boolean, false) = true
    or coalesce((metadata ->> 'version_prohibited')::boolean, false) = true
    or lower(coalesce(metadata ->> 'technical_state', 'healthy'))
      in ('maintenance', 'corrupt', 'removed', 'package_missing', 'version_prohibited')
    or (
      status in ('available', 'occupied')
      and is_launchable = true
      and usable_for_auto_login = true
      and nullif(trim(coalesce(package_name, '')), '') is not null
      and nullif(trim(coalesce(launch_activity, '')), '') is not null
      and current_account_id is not null
    )
  ) not valid;

comment on constraint phone_app_instances_business_gate_launchability_v1
  on public.phone_app_instances is
  'Prevents identity/review business gates from disabling a technically healthy app instance. Technical blockers must use a technical runtime_block_reason.';

create or replace function public.reconcile_login_provisioning_app_instance_launchability_v1(
  p_app_instance_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reconciled_ids uuid[] := '{}'::uuid[];
  v_requested_found boolean := false;
begin
  if p_app_instance_id is not null then
    select exists (
      select 1
      from public.phone_app_instances as pai
      where pai.id = p_app_instance_id
    ) into v_requested_found;

    if not v_requested_found then
      raise exception 'phone_app_instance_not_found'
        using errcode = 'P0002';
    end if;
  end if;

  with eligible as (
    select pai.id
    from public.phone_app_instances as pai
    join public.phone_devices as pd
      on pd.id = pai.device_id
    join public.account_assignments as aa
      on aa.app_instance_id = pai.id
     and aa.account_id = pai.current_account_id
     and aa.released_at is null
     and aa.status in ('reserved', 'active')
    where (p_app_instance_id is null or pai.id = p_app_instance_id)
      and public.is_login_provisioning_business_gate_v1(
        pai.metadata ->> 'runtime_block_reason'
      )
      and nullif(trim(coalesce(pai.package_name, '')), '') is not null
      and nullif(trim(coalesce(pai.launch_activity, '')), '') is not null
      and nullif(trim(coalesce(pai.metadata ->> 'version_name', '')), '') is not null
      and nullif(trim(coalesce(pai.metadata ->> 'version_code', '')), '') is not null
      and lower(coalesce(pai.metadata ->> 'generation', '')) <> 'legacy_pre_reprovision'
      and nullif(trim(coalesce(pai.metadata ->> 'replaced_by_app_instance_id', '')), '') is null
      and lower(coalesce(pd.status, 'unknown')) not in ('maintenance', 'retired', 'disabled')
      and pd.retired_at is null
      and coalesce((pai.metadata ->> 'maintenance')::boolean, false) = false
      and coalesce((pai.metadata ->> 'corrupt')::boolean, false) = false
      and coalesce((pai.metadata ->> 'removed')::boolean, false) = false
      and coalesce((pai.metadata ->> 'version_prohibited')::boolean, false) = false
      and lower(coalesce(pai.metadata ->> 'technical_state', 'healthy'))
        not in ('maintenance', 'corrupt', 'removed', 'package_missing', 'version_prohibited')
    for update of pai
  ), reconciled as (
    update public.phone_app_instances as pai
    set status = 'occupied',
        is_launchable = true,
        usable_for_auto_login = true,
        metadata = pai.metadata || jsonb_build_object(
          'business_runtime_allowed', false,
          'login_provisioning_allowed', true,
          'technical_launchability_reconciled', true,
          'technical_launchability_reconciled_by',
            'reconcile_login_provisioning_app_instance_launchability_v1',
          'technical_launchability_reconciled_at', now()
        ),
        updated_at = now()
    from eligible
    where pai.id = eligible.id
      and (
        pai.status <> 'occupied'
        or pai.is_launchable is distinct from true
        or pai.usable_for_auto_login is distinct from true
        or coalesce((pai.metadata ->> 'login_provisioning_allowed')::boolean, false) is distinct from true
        or coalesce((pai.metadata ->> 'business_runtime_allowed')::boolean, true) is distinct from false
      )
    returning pai.id
  )
  select coalesce(array_agg(id order by id), '{}'::uuid[])
    into v_reconciled_ids
  from reconciled;

  return jsonb_build_object(
    'ok', true,
    'requested_app_instance_id', p_app_instance_id,
    'reconciled_count', cardinality(v_reconciled_ids),
    'reconciled_ids', to_jsonb(v_reconciled_ids),
    'business_runtime_allowed', false,
    'login_provisioning_allowed', true
  );
end;
$$;

revoke all on function public.is_login_provisioning_business_gate_v1(text)
  from public, anon, authenticated;
revoke all on function public.reconcile_login_provisioning_app_instance_launchability_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.is_login_provisioning_business_gate_v1(text)
  to service_role;
grant execute on function public.reconcile_login_provisioning_app_instance_launchability_v1(uuid)
  to service_role;

-- Canonical, bounded reconciliation of every currently affected instance.
-- Legacy/replaced, missing-package, maintenance, corrupt and prohibited-version
-- rows are deliberately excluded by the RPC.
select public.reconcile_login_provisioning_app_instance_launchability_v1(null);

alter table public.phone_app_instances
  validate constraint phone_app_instances_business_gate_launchability_v1;

commit;
