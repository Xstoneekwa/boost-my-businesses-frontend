begin;

-- Reset V2 previously tried to combine status=open with archived_at!=null.
-- The canonical retention contract correctly rejects that combination. Make
-- the superseded login attempt terminal as ignored: it remains historical,
-- is shown in the resolved incident family, and cannot arm resolved-only
-- resume triggers.
do $migration$
declare
  v_definition text;
  v_patched_definition text;
  v_old_fragment constant text := E'update public.account_incidents i\n  set archived_at = coalesce(i.archived_at, v_now),';
  v_new_fragment constant text := E'update public.account_incidents i\n  set status = \'ignored\',\n      resolved_at = coalesce(i.resolved_at, v_now),\n      archived_at = coalesce(i.archived_at, v_now),';
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'reset_client_instagram_auto_login_workflow_v2'
    and pg_get_function_identity_arguments(p.oid) =
      'p_account_id uuid, p_reason text, p_actor_type text, p_external_request_id text, p_metadata jsonb';

  if v_definition is null then
    raise exception 'reset_v2_function_not_found' using errcode = '55000';
  end if;
  if position(v_old_fragment in v_definition) = 0 then
    raise exception 'reset_v2_archive_transition_source_mismatch' using errcode = '55000';
  end if;
  if position(E'set status = \'ignored\',\n      resolved_at = coalesce(i.resolved_at, v_now),' in v_definition) > 0 then
    raise exception 'reset_v2_archive_transition_already_patched' using errcode = '55000';
  end if;

  v_patched_definition := replace(v_definition, v_old_fragment, v_new_fragment);
  if v_patched_definition = v_definition then
    raise exception 'reset_v2_archive_transition_patch_noop' using errcode = '55000';
  end if;

  execute v_patched_definition;
end
$migration$;

revoke all on function public.reset_client_instagram_auto_login_workflow_v2(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.reset_client_instagram_auto_login_workflow_v2(uuid, text, text, text, jsonb)
  to service_role;

comment on function public.reset_client_instagram_auto_login_workflow_v2(uuid, text, text, text, jsonb) is
  'Service-role-only, atomic and idempotent Auto Login workflow reset. Superseded login incidents transition to ignored with archived_at retained; no authentication success is invented. Preserves account, commercial state, assignments, targets, credential history and terminal runtime history; never starts runtime.';

commit;
