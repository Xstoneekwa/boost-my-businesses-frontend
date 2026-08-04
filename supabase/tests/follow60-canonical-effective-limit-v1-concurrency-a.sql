\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
select public.create_or_rearm_follow_60s_canary_control_v1(
  '10000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000001',repeat('a',40),
  50,10,now()+interval '1 day','concurrent-a','com.instagram.android',
  jsonb_build_object(
    'account_id','10000000-0000-4000-8000-000000000006',
    'package','com.instagram.android','worker_sha',repeat('a',40),'release_sha',repeat('a',40),
    'captured_at',now(),'timezone','Africa/Johannesburg',
    'business_date',(now() at time zone 'Africa/Johannesburg')::date,'warmup_ready',true
  ),
  'concurrent-a','test','sql-concurrency'
);
