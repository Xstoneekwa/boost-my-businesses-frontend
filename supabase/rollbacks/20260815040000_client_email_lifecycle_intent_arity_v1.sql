-- Safety rollback: never restore the malformed production definition. This
-- verifies that the canonical sender/support arity remains installed.
do $rollback$
declare
  v_function regprocedure := to_regprocedure(
    'public.materialize_client_email_outbox_candidate_v1(uuid,uuid,text,text,text,timestamp with time zone,uuid,integer,text,text,text,smallint,uuid,integer,text,text,text,text,text,text,uuid)'
  );
  v_definition text;
  v_bad_fragment constant text := E'btrim(p_from_email_snapshot),\n      btrim(p_from_email_snapshot),\n      btrim(p_support_email_snapshot)';
begin
  if v_function is null then
    raise exception 'client_email_materialize_function_missing';
  end if;

  select pg_get_functiondef(v_function) into v_definition;
  if position(v_bad_fragment in v_definition) > 0 then
    raise exception 'client_email_materialize_unsafe_rollback_refused';
  end if;
end
$rollback$;

revoke all on function public.materialize_client_email_outbox_candidate_v1(
  uuid, uuid, text, text, text, timestamptz, uuid, integer, text, text, text,
  smallint, uuid, integer, text, text, text, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.materialize_client_email_outbox_candidate_v1(
  uuid, uuid, text, text, text, timestamptz, uuid, integer, text, text, text,
  smallint, uuid, integer, text, text, text, text, text, text, uuid
) to service_role;
