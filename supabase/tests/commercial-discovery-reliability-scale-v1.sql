select pg_temp.assert_true(
  not has_function_privilege('anon','public.claim_commercial_discovery_items_v2(integer,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_commercial_discovery_items_v2(integer,text)','EXECUTE')
  and has_function_privilege('service_role','public.claim_commercial_discovery_items_v2(integer,text)','EXECUTE'),
  'durable claim RPC is service-role-only'
);

select pg_temp.assert_true(
  (select count(*) = 2 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('commercial_discovery_audit_events','commercial_scoring_cache') and c.relrowsecurity and c.relforcerowsecurity),
  'new discovery tables force RLS'
);

select public.create_commercial_discovery_run_v2(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b','Johannesburg','Hair Salon',3,'reliability-run-3',false
);
select pg_temp.assert_true(
  (public.create_commercial_discovery_run_v2('580d7856-d60f-4838-a5f9-3b405d6ae79b','Johannesburg','Hair Salon',3,'reliability-run-3',false)->>'idempotent_replay')::boolean,
  'V2 run creation stays idempotent'
);

select * from public.claim_commercial_discovery_runs_v2(1,'sql-test-worker');
update public.commercial_discovery_runs set discovery_status='completed', discovered_count=8, discovered_at=now(), worker_locked_at=null, worker_locked_by=null
where idempotency_key='reliability-run-3';

insert into public.commercial_discovery_items(run_id,provider,provider_external_id,source_url,status,stage,selected_for_processing,candidate_rank,idempotency_key,source_snapshot_safe)
select r.id,'searchapi','reliability_candidate_'||g,'https://instagram.com/reliability_candidate_'||g,
  case when g <= 3 then 'pending' else 'not_selected' end,'DISCOVERED',g <= 3,g,r.id||':reliability_candidate_'||g,
  jsonb_build_object('instagram_handle','reliability_candidate_'||g,'source_query','hair salon Johannesburg')
from public.commercial_discovery_runs r cross join generate_series(1,8) g where r.idempotency_key='reliability-run-3';

create temporary table claimed_reliability_items as select * from public.claim_commercial_discovery_items_v2(5,'sql-test-worker');
select pg_temp.assert_true(
  (select count(*)=3 from claimed_reliability_items)
  and (select count(*)=3 from public.commercial_discovery_items i join public.commercial_discovery_runs r on r.id=i.run_id where r.idempotency_key='reliability-run-3' and i.status='processing' and i.attempt_count=1)
  and (select count(*)=5 from public.commercial_discovery_items i join public.commercial_discovery_runs r on r.id=i.run_id where r.idempotency_key='reliability-run-3' and i.status='not_selected'),
  'all eight candidates persist while only selected three are bounded-claimed'
);

select public.cancel_commercial_discovery_run_v2(
  (select id from public.commercial_discovery_runs where idempotency_key='reliability-run-3'),
  '580d7856-d60f-4838-a5f9-3b405d6ae79b'
);
select pg_temp.assert_true(
  (select status='cancelled' from public.commercial_discovery_runs where idempotency_key='reliability-run-3')
  and (select count(*)=3 from public.commercial_discovery_items i join public.commercial_discovery_runs r on r.id=i.run_id where r.idempotency_key='reliability-run-3' and i.status='cancelled')
  and (select count(*)=5 from public.commercial_discovery_items i join public.commercial_discovery_runs r on r.id=i.run_id where r.idempotency_key='reliability-run-3' and i.status='not_selected'),
  'cancel stops active work and preserves historical non-selected items'
);

select public.create_commercial_discovery_run_v2(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b','Cape Town','Skin Clinic',30,'reliability-run-30',true
);
select * from public.claim_commercial_discovery_runs_v2(1,'sql-test-worker-30');
update public.commercial_discovery_runs set discovery_status='completed',discovered_count=3,discovered_at=now(),worker_locked_at=null,worker_locked_by=null
where idempotency_key='reliability-run-30';
insert into public.commercial_discovery_items(run_id,provider,provider_external_id,status,stage,selected_for_processing,candidate_rank,idempotency_key,source_snapshot_safe)
select r.id,'searchapi','terminal_candidate_'||g,
  case g when 1 then 'rejected' when 2 then 'failed' else 'duplicate' end,
  case g when 1 then 'REJECTED' when 2 then 'FAILED' else 'REJECTED' end,true,g,r.id||':terminal_candidate_'||g,'{}'::jsonb
from public.commercial_discovery_runs r cross join generate_series(1,3) g where r.idempotency_key='reliability-run-30';

insert into public.commercial_businesses(business_name,country_code,city,vertical,instagram_handle,instagram_handle_normalized,source)
values ('Reliability Metric Business','ZA','Cape Town','Beauty/Aesthetics','reliability.metric.business','reliability.metric.business','sql_reliability_test');
insert into public.commercial_leads(campaign_id,business_id,qualification_status,lead_score,score_priority)
select c.id,b.id,'qualified',8.1,'P1' from public.commercial_campaigns c cross join public.commercial_businesses b
where b.instagram_handle_normalized='reliability.metric.business' order by c.created_at limit 1;
update public.commercial_discovery_items i set lead_id=l.id
from public.commercial_leads l join public.commercial_businesses b on b.id=l.business_id
where i.run_id=(select id from public.commercial_discovery_runs where idempotency_key='reliability-run-30')
  and i.provider_external_id='terminal_candidate_3' and b.instagram_handle_normalized='reliability.metric.business';
select public.refresh_commercial_discovery_run_v2((select id from public.commercial_discovery_runs where idempotency_key='reliability-run-30'));
select pg_temp.assert_true(
  (select status='completed_with_errors' and max_prospects=30 and force_rescore and error_count=1 and precheck_rejected_count=0
   and qualified_count=0 and p1_count=0 and scored_count=0
   from public.commercial_discovery_runs where idempotency_key='reliability-run-30'),
  'partial failure is durable and duplicate leads do not inflate scored or priority metrics'
);

select pg_temp.assert_true(
  not exists(select 1 from public.commercial_leads where outreach_status <> 'not_started' and source_snapshot_hash like 'reliability%'),
  'reliability runtime produces no outreach transition'
);
