-- Privilege hardening only. Lease identity, generation and business guards are unchanged.
begin;

do $migration$
declare
  target regprocedure := 'public.auto_restart_renew_device_lock(uuid,text,uuid,integer,uuid,uuid)'::regprocedure;
  definition text;
  body text;
  guard text := E'\n  -- fleet_renewal_caller_authorization_v1: actual SQL role, not supplied identifiers/JWT.\n  if pg_catalog.current_setting(''role'', true) is distinct from ''service_role'' then\n    raise exception ''service_role_required'' using errcode = ''42501'';\n  end if;\n';
begin
  select pg_catalog.pg_get_functiondef(target), prosrc into definition, body
    from pg_catalog.pg_proc where oid = target;
  if position('fleet_renewal_caller_authorization_v1' in body) = 0 then
    if position(E'\nbegin\n' in body) = 0 then
      raise exception 'renewal_caller_guard_anchor_mismatch';
    end if;
    definition := replace(definition, body,
      regexp_replace(body, E'\nbegin\n', E'\nbegin\n' || guard));
    execute definition;
  end if;
end
$migration$;

alter function public.auto_restart_renew_device_lock(uuid,text,uuid,integer,uuid,uuid)
  set search_path = pg_catalog, pg_temp;
revoke all on function public.auto_restart_renew_device_lock(uuid,text,uuid,integer,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.auto_restart_renew_device_lock(uuid,text,uuid,integer,uuid,uuid)
  to service_role;

-- The baseline explicitly documents client actor_type as audit-only. The
-- replacement atomic wrapper must retain the original server-only RPC ACL.
revoke all on function public.create_account_run_request(uuid,uuid,text,text,text,text,integer,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_account_run_request(uuid,uuid,text,text,text,text,integer,jsonb)
  to service_role;

-- V2 remains an implementation boundary used by the service-role V3/V4
-- wrappers, not a public bypass around their authorization checks.
revoke all on function public.consume_resume_authorization_and_create_request_v2(uuid,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.consume_resume_authorization_and_create_request_v2(uuid,text,uuid,jsonb)
  to service_role;

commit;
