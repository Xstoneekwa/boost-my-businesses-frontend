\set ON_ERROR_STOP on

do $test$
declare
  v_count integer;
  v_result jsonb;
  v_owner text;
  v_acl aclitem[];
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'expected PostgreSQL 17, got %', current_setting('server_version');
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and pg_get_functiondef(p.oid) like '%from public.account_incidents%'
    and pg_get_functiondef(p.oid) like '%status in (''open'', ''acknowledged'')%';
  if v_count <> 1 then
    raise exception 'predicate implementation count expected 1, got %', v_count;
  end if;

  if pg_get_functiondef('public.admit_account_run_attempt_v1(uuid,text,uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)'::regprocedure)
       not like '%canonical_active_blocking_incidents_v1(array[v_account.id])%'
     or pg_get_functiondef('public.certify_zero_work_and_enqueue_recovery_v1(uuid,uuid,text,integer)'::regprocedure)
       not like '%canonical_active_blocking_incidents_v1(array[v_account.id])%' then
    raise exception 'consumer not rebound to canonical predicate';
  end if;

  select pg_get_userbyid(proowner), proacl
  into v_owner, v_acl
  from pg_proc
  where oid = 'public.canonical_active_blocking_incidents_v1(uuid[])'::regprocedure;
  if v_owner <> 'postgres' then raise exception 'unexpected canonical owner: %', v_owner; end if;
  if not (select prosecdef from pg_proc where oid = 'public.canonical_active_blocking_incidents_v1(uuid[])'::regprocedure) then
    raise exception 'canonical function must be security definer';
  end if;
  if (select proconfig from pg_proc where oid = 'public.canonical_active_blocking_incidents_v1(uuid[])'::regprocedure)
       is distinct from array['search_path=""']::text[] then
    raise exception 'canonical search_path is not empty';
  end if;
  if has_function_privilege('anon', 'public.canonical_active_blocking_incidents_v1(uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.canonical_active_blocking_incidents_v1(uuid[])', 'execute')
     or not has_function_privilege('service_role', 'public.canonical_active_blocking_incidents_v1(uuid[])', 'execute') then
    raise exception 'canonical execute ACL is broader or narrower than service_role-only';
  end if;

  -- A: blocker before pre-enqueue, therefore zero request created.
  insert into public.account_incidents(
    id, account_id, incident_type, reason, severity, status, metadata
  ) values (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'instagram_account_restriction', 'instagram_action_rate_limit', 'error', 'open',
    '{"manual_incident_resolution_required":true}'::jsonb
  );
  insert into public.account_run_requests(id, account_id, request_kind, status)
  select
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001', 'scheduled', 'queued'
  where not exists (
    select 1 from public.canonical_active_blocking_incidents_v1(
      array['10000000-0000-0000-0000-000000000001'::uuid]
    )
  );
  if exists (select 1 from public.account_run_requests where id = '30000000-0000-0000-0000-000000000001') then
    raise exception 'scenario A created a request';
  end if;

  -- D: acknowledged but unresolved remains blocking.
  update public.account_incidents
  set status = 'acknowledged'
  where id = '20000000-0000-0000-0000-000000000001';
  select count(*) into v_count
  from public.canonical_active_blocking_incidents_v1(
    array['10000000-0000-0000-0000-000000000001'::uuid]
  );
  if v_count <> 1 then raise exception 'scenario D did not remain blocking'; end if;

  -- C: recovery enqueue with blocker creates no recovery request.
  insert into public.account_run_requests(id, account_id, request_kind, status)
  values (
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001', 'source', 'failed'
  );
  v_result := public.certify_zero_work_and_enqueue_recovery_v1(
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002', 'test-worker', 300
  );
  if v_result->>'reason' <> 'active_blocking_incident'
     or exists (
       select 1 from public.account_run_requests
       where account_id = '10000000-0000-0000-0000-000000000001'
         and request_kind = 'recovery'
     ) then
    raise exception 'scenario C failed: %', v_result;
  end if;

  -- E1: resolved incidents no longer block when the remaining gates pass.
  update public.account_incidents
  set resolved_at = clock_timestamp()
  where id = '20000000-0000-0000-0000-000000000001';
  v_result := public.certify_zero_work_and_enqueue_recovery_v1(
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002', 'test-worker', 300
  );
  if not coalesce((v_result->>'ok')::boolean, false)
     or not exists (
       select 1 from public.account_run_requests
       where account_id = '10000000-0000-0000-0000-000000000001'
         and request_kind = 'recovery'
     ) then
    raise exception 'scenario E resolved gate failed: %', v_result;
  end if;

  -- E2: archived incidents also no longer block.
  update public.account_incidents
  set resolved_at = null, archived_at = clock_timestamp()
  where id = '20000000-0000-0000-0000-000000000001';
  select count(*) into v_count
  from public.canonical_active_blocking_incidents_v1(
    array['10000000-0000-0000-0000-000000000001'::uuid]
  );
  if v_count <> 0 then raise exception 'scenario E archived gate failed'; end if;
end
$test$;

select jsonb_build_object(
  'server_version', current_setting('server_version'),
  'predicate_implementation_count', (
    select count(*)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%from public.account_incidents%'
      and pg_get_functiondef(p.oid) like '%status in (''open'', ''acknowledged'')%'
  ),
  'canonical_owner', (
    select pg_get_userbyid(proowner)
    from pg_proc where oid = 'public.canonical_active_blocking_incidents_v1(uuid[])'::regprocedure
  ),
  'canonical_acl', (
    select proacl
    from pg_proc where oid = 'public.canonical_active_blocking_incidents_v1(uuid[])'::regprocedure
  ),
  'scenarios', jsonb_build_object('A','PASS','C','PASS','D','PASS','E','PASS')
) as restriction_runtime_evidence;
