-- Preserve the safe-metadata validator contract without a dedicated archive
-- writer role. The postgres-owned kernel evaluates the immutable predicate;
-- service_role keeps only the pre-existing direct-table constraint capability.

do $$
declare
  v_function oid;
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_language text;
  v_config text[];
begin
  select p.oid, r.rolname, p.prosecdef, p.provolatile, l.lanname, p.proconfig
    into v_function, v_owner, v_security_definer, v_volatility, v_language, v_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_roles r on r.oid = p.proowner
  join pg_catalog.pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.proname = 'jsonb_has_forbidden_safe_metadata_key'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_metadata jsonb';

  if v_function is null then
    raise exception 'archive_transition_metadata_validator_missing' using errcode = '42883';
  end if;
  if v_owner <> 'postgres' or v_security_definer or v_volatility <> 'i'
     or v_language <> 'sql'
     or not ('search_path=public' = any(coalesce(v_config, '{}'::text[]))) then
    raise exception 'archive_transition_metadata_validator_contract_changed'
      using errcode = '55000';
  end if;
end
$$;

revoke execute on function public.jsonb_has_forbidden_safe_metadata_key(jsonb)
  from public, anon, authenticated;
grant execute on function public.jsonb_has_forbidden_safe_metadata_key(jsonb)
  to service_role;

do $$
begin
  if has_function_privilege(
       'anon', 'public.jsonb_has_forbidden_safe_metadata_key(jsonb)', 'EXECUTE'
     ) or has_function_privilege(
       'authenticated', 'public.jsonb_has_forbidden_safe_metadata_key(jsonb)', 'EXECUTE'
     ) or not has_function_privilege(
       'service_role', 'public.jsonb_has_forbidden_safe_metadata_key(jsonb)', 'EXECUTE'
     ) then
    raise exception 'archive_transition_metadata_validator_acl_invalid'
      using errcode = '42501';
  end if;
end
$$;

comment on function public.jsonb_has_forbidden_safe_metadata_key(jsonb) is
  'Pure immutable safe-metadata validator. Guard-off ACL: postgres owner and service_role constraint evaluation only.';
