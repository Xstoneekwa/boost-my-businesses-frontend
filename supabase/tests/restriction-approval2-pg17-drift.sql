\set ON_ERROR_STOP on

create table public.restriction_drift_snapshot (
  function_name text primary key,
  definition_hash text not null
);

do $setup$
declare
  v_definition text;
  v_drifted text;
begin
  v_definition := pg_get_functiondef(
    'public.certify_zero_work_and_enqueue_recovery_v1(uuid,uuid,text,integer)'::regprocedure
  );
  v_drifted := replace(
    v_definition,
    E'    select 1 from public.account_incidents i\n',
    E'    select 1 from public.account_incidents as i\n'
  );
  if v_drifted = v_definition then
    raise exception 'drift setup marker not found';
  end if;
  execute v_drifted;
end
$setup$;

insert into public.restriction_drift_snapshot(function_name, definition_hash)
values
  (
    'admission',
    md5(pg_get_functiondef(
      'public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)'::regprocedure
    ))
  ),
  (
    'recovery',
    md5(pg_get_functiondef(
      'public.certify_zero_work_and_enqueue_recovery_v1(uuid,uuid,text,integer)'::regprocedure
    ))
  );
