-- Reconcile a production-only drift in the lifecycle intent INSERT without
-- replaying any lifecycle transition or materializing any current candidate.
do $migration$
declare
  v_function regprocedure := to_regprocedure(
    'public.materialize_client_email_outbox_candidate_v1(uuid,uuid,text,text,text,timestamp with time zone,uuid,integer,text,text,text,smallint,uuid,integer,text,text,text,text,text,text,uuid)'
  );
  v_definition text;
  v_bad_pattern constant text :=
    'btrim\(p_from_email_snapshot\),\s*btrim\(p_from_email_snapshot\),\s*btrim\(p_support_email_snapshot\)';
  v_good_pattern constant text :=
    'btrim\(p_from_email_snapshot\),\s*btrim\(p_support_email_snapshot\)';
  v_bad_count integer;
  v_good_count integer;
begin
  if v_function is null then
    raise exception 'client_email_materialize_function_missing';
  end if;

  select pg_get_functiondef(v_function) into v_definition;

  select count(*)
    into v_bad_count
    from regexp_matches(v_definition, v_bad_pattern, 'g');

  if v_bad_count = 1 then
    v_definition := regexp_replace(
      v_definition,
      v_bad_pattern,
      E'btrim(p_from_email_snapshot),\n      btrim(p_support_email_snapshot)',
      'g'
    );
    execute v_definition;
  elsif v_bad_count <> 0 then
    raise exception 'client_email_materialize_unexpected_duplicate_sender_shape:%', v_bad_count;
  end if;

  select pg_get_functiondef(v_function) into v_definition;

  select count(*)
    into v_bad_count
    from regexp_matches(v_definition, v_bad_pattern, 'g');
  select count(*)
    into v_good_count
    from regexp_matches(v_definition, v_good_pattern, 'g');

  if v_bad_count <> 0 or v_good_count < 2 then
    raise exception 'client_email_materialize_sender_arity_not_canonical';
  end if;
end
$migration$;

revoke all on function public.materialize_client_email_outbox_candidate_v1(
  uuid, uuid, text, text, text, timestamptz, uuid, integer, text, text, text,
  smallint, uuid, integer, text, text, text, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.materialize_client_email_outbox_candidate_v1(
  uuid, uuid, text, text, text, timestamptz, uuid, integer, text, text, text,
  smallint, uuid, integer, text, text, text, text, text, text, uuid
) to service_role;
