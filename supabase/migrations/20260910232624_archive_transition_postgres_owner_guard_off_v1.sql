-- Hosted-Supabase-compatible owner/ACL contract for the guard-off release.
-- The migration executor is the non-superuser postgres role. No custom role,
-- membership mutation, owner transfer, or direct-write guard is required.

alter table archive_internal.archive_transition_requests enable row level security;
alter table archive_internal.archive_transition_requests force row level security;

revoke all on schema archive_internal from public, anon, authenticated, service_role;
revoke all on table archive_internal.archive_transition_requests from public, anon, authenticated, service_role;
revoke all on function archive_internal.archive_target_transition_kernel_v1(jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.archive_targets_transition_batch_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.archive_target_transition_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.reconcile_archived_target_lifecycle_v1(jsonb)
  from public, anon, authenticated;

grant execute on function public.archive_targets_transition_batch_v1(jsonb) to service_role;
grant execute on function public.archive_target_transition_v1(jsonb) to service_role;
grant execute on function public.reconcile_archived_target_lifecycle_v1(jsonb) to service_role;

do $$
declare
  v_kernel oid;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
begin
  select p.oid, r.rolname, p.prosecdef, p.proconfig
    into v_kernel, v_owner, v_security_definer, v_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where n.nspname = 'archive_internal'
    and p.proname = 'archive_target_transition_kernel_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_request jsonb';

  if v_kernel is null then
    raise exception 'archive_transition_kernel_missing' using errcode = '42883';
  end if;
  if v_owner <> 'postgres' or not v_security_definer
     or not ('search_path=""' = any(coalesce(v_config, '{}'::text[]))) then
    raise exception 'archive_transition_kernel_security_contract_changed'
      using errcode = '55000';
  end if;
  if has_function_privilege('anon', v_kernel, 'EXECUTE')
     or has_function_privilege('authenticated', v_kernel, 'EXECUTE')
     or has_function_privilege('service_role', v_kernel, 'EXECUTE') then
    raise exception 'archive_transition_kernel_execute_exposed' using errcode = '42501';
  end if;
  if to_regprocedure('archive_internal.reject_direct_archive_v1()') is not null
     or exists (
       select 1 from pg_catalog.pg_trigger
       where tgname = 'ig_targets_archive_transition_guard_v1' and not tgisinternal
     ) then
    raise exception 'archive_transition_strict_guard_present_in_guard_off_release'
      using errcode = '55000';
  end if;
end
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.archive_targets_transition_batch_v1(jsonb)',
    'public.archive_target_transition_v1(jsonb)',
    'public.reconcile_archived_target_lifecycle_v1(jsonb)'
  ] loop
    if has_function_privilege('anon', v_signature, 'EXECUTE')
       or has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'archive_transition_facade_acl_invalid:%', v_signature
        using errcode = '42501';
    end if;
  end loop;
end
$$;

comment on function archive_internal.archive_target_transition_kernel_v1(jsonb) is
  'Private SECURITY DEFINER archive kernel owned by postgres for the guard-off release. Dedicated-owner hardening is deferred to strict-guard activation.';
