revoke all on function public.bind_follow_60s_canary_runtime_v2(
  uuid, uuid, text, text, uuid, uuid, integer, text, text
) from public, anon, authenticated, service_role;
drop function if exists public.bind_follow_60s_canary_runtime_v2(
  uuid, uuid, text, text, uuid, uuid, integer, text, text
);
drop index if exists public.follow_60s_canary_controls_control_id_uidx;

-- Exact restoration of the production V2 binder that preceded this migration.
create function public.bind_follow_60s_canary_runtime_v2(
  p_account_id uuid,
  p_run_id uuid,
  p_request_id uuid,
  p_attempt_id integer,
  p_business_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control public.follow_60s_canary_controls%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_account_id <> 'b024e94e-395d-4f02-9787-81ddc679b014'::uuid
    or p_run_id is null or p_request_id is null
    or coalesce(p_attempt_id, 0) < 1
    or nullif(pg_catalog.btrim(p_business_session_id), '') is null then
    raise exception 'follow60_stage_binding_missing_or_invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_account_id::text || ':follow60-runtime-bind', 0)
  );
  perform 1 from public.ig_runs r
   where r.id = p_run_id and r.account_id = p_account_id for update;
  if not found then
    raise exception 'follow_60s_run_binding_mismatch' using errcode = '23503';
  end if;
  perform 1 from public.account_run_requests q
   where q.id = p_request_id and q.account_id = p_account_id and q.run_id = p_run_id for update;
  if not found then
    raise exception 'follow_60s_run_request_binding_mismatch' using errcode = '23503';
  end if;
  select * into v_control from public.follow_60s_canary_controls c
   where c.account_id = p_account_id for update;
  if not found or v_control.status <> 'armed'
    or (v_control.run_id is not null and v_control.run_id <> p_run_id)
    or (v_control.request_id is not null and v_control.request_id <> p_request_id) then
    raise exception 'follow_60s_control_binding_mismatch' using errcode = '55000';
  end if;
  update public.follow_60s_canary_controls c
     set run_id = p_run_id, request_id = p_request_id,
         metadata_safe = coalesce(c.metadata_safe, '{}'::jsonb)
           || pg_catalog.jsonb_build_object(
             'runtime_binding_schema', 'FOLLOW_60S_RUNTIME_BINDING_V2',
             'attempt_id', p_attempt_id,
             'business_session_id', p_business_session_id,
             'bound_at', pg_catalog.now()
           ),
         updated_at = pg_catalog.now()
   where c.account_id = p_account_id;
  return pg_catalog.jsonb_build_object(
    'ok', true, 'binding_valid', true, 'status', 'armed',
    'account_id', p_account_id, 'run_id', p_run_id,
    'request_id', p_request_id, 'attempt_id', p_attempt_id,
    'business_session_id', p_business_session_id,
    'baseline_follow_count', v_control.baseline_follow_count,
    'evaluation_increment', v_control.evaluation_increment,
    'target_follow_count', v_control.target_follow_count
  );
end;
$$;

revoke all on function public.bind_follow_60s_canary_runtime_v2(
  uuid, uuid, uuid, integer, text
) from public, anon, authenticated;
grant execute on function public.bind_follow_60s_canary_runtime_v2(
  uuid, uuid, uuid, integer, text
) to service_role;
