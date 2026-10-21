-- LOCAL ONLY: fixtures are rolled back. Never run on production.
begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.expect_failure(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlerrm not like '%'||expected||'%' then raise exception 'Unexpected error: % (expected %)',sqlerrm,expected; end if;
    return;
  end;
  raise exception 'Expected failure: %',expected;
end $$;

insert into public.commercial_campaigns(id,campaign_code,name,country_code,vertical,created_by,updated_by)
values('10000000-0000-4000-8000-000000000001','LOCAL_REVIEW_TEST','LOCAL FIXTURE','ZA','beauty','580d7856-d60f-4838-a5f9-3b405d6ae79b','580d7856-d60f-4838-a5f9-3b405d6ae79b');
insert into public.commercial_businesses(id,business_name,country_code,vertical)
select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'LOCAL FIXTURE '||n,'ZA','beauty' from generate_series(1,35)n;
insert into public.commercial_leads(id,business_id,campaign_id,qualification_status,score,priority,outreach_channel,message_angle)
select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '10000000-0000-4000-8000-000000000001','qualified',case when n<=15 then 84 else 80-(n-15) end,case when n<=15 then 'urgent' else 'high' end,'instagram','A' from generate_series(1,35)n;

select pg_temp.assert_true(public.enroll_commercial_review_canary_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','local-fixture')=25,'bounded enrollment');
select pg_temp.assert_true(public.enroll_commercial_review_canary_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','not-replaced')=25,'enrollment replay');
select pg_temp.assert_true((select count(*)=15 from public.commercial_events where event_type='human_review_canary_enrolled' and metadata_safe->>'ai_priority'='urgent'),'15 P1');
select pg_temp.assert_true((select min((metadata_safe->>'ai_score')::int)=70 from public.commercial_events where event_type='human_review_canary_enrolled' and metadata_safe->>'ai_priority'='high'),'best 10 P2');
select pg_temp.assert_true(not exists(select 1 from public.commercial_events where event_type in ('human_review_started','human_review_completed')),'no fabricated human data');
select pg_temp.expect_failure($s$select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000001','approve',1,'no-start','{}')$s$,'commercial_review_start_required');
select pg_temp.assert_true(not exists(select 1 from public.commercial_outreach_items),'failed decision rolls back outreach');
select pg_temp.expect_failure($s$select public.start_commercial_human_review_v1('00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001')$s$,'owner_access_required');
select pg_temp.expect_failure($s$update public.commercial_leads set score=99 where id='30000000-0000-4000-8000-000000000001'$s$,'scoring_frozen');

select public.start_commercial_human_review_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000001');
select public.start_commercial_human_review_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select count(*)=1 from public.commercial_events where event_type='human_review_started'),'idempotent start');
select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000001','update_context',1,'edit-channel','{"outreach_channel":"email"}');
select pg_temp.expect_failure($s$select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000001','approve',1,'stale','{}')$s$,'stale_version');
select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000001','update_context',2,'edit-angle','{"message_angle":"B"}');
select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000001','approve',3,'approve-local','{}');
select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000001','approve',3,'approve-local','{}');
select pg_temp.assert_true((select count(*)=1 from public.commercial_outreach_items where channel='email' and angle='B' and state='draft'),'exactly one item, human selection');
select pg_temp.assert_true((select count(*)=1 from public.commercial_events where event_type='human_review_completed' and metadata_safe @> '{"ai_channel":"instagram","ai_angle":"A","human_channel_final":"email","human_angle_final":"B","channel_overridden":true,"angle_overridden":true,"lead_edited":true}'::jsonb),'immutable original and final comparison');
select pg_temp.assert_true((select (metadata_safe->>'review_duration_seconds')::numeric>=0 from public.commercial_events where event_type='human_review_completed'),'server timing');

do $$ declare i public.commercial_outreach_items%rowtype;
begin
  select * into i from public.claim_commercial_outreach_items_v1(1,'fixture-worker');
  perform public.complete_commercial_outreach_generation_v1(i.id,'fixture-worker',true,'{"subject":"Fixture preview","body":"Hello local fixture, this is an isolated dry-run preview only.","facts_used":[]}',array[]::text[]);
  perform pg_temp.assert_true((select state='ready_for_review' from public.commercial_outreach_items where id=i.id),'automatic generation lifecycle ready');
  select * into i from public.commercial_outreach_items where id=i.id;
  perform public.mutate_commercial_outreach_item_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b',i.id,'approve_message',i.version,'fixture-message-approve','{}');
  perform pg_temp.assert_true((select state='queued_dry_run' from public.commercial_outreach_items where id=i.id),'message approval remains dry-run');
end $$;

select public.start_commercial_human_review_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000016');
select pg_temp.expect_failure($s$select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000016','reject',1,'reject-missing','{}')$s$,'rejection_reason_required');
select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000016','reject',1,'reject-local','{"rejection_reason":"poor_targeting_potential","rejection_note":"Local fixture note"}');
select pg_temp.assert_true((select qualification_status='rejected' and outreach_status='stopped' from public.commercial_leads where id='30000000-0000-4000-8000-000000000016'),'reject removes queue');
select pg_temp.assert_true((select count(*)=1 from public.commercial_events where event_type='human_review_completed' and metadata_safe @> '{"reject_reason":"poor_targeting_potential","optional_review_note":"Local fixture note","lead_edited":false}'::jsonb),'reason and optional note');
select pg_temp.assert_true(not exists(select 1 from public.commercial_outreach_items where lead_id='30000000-0000-4000-8000-000000000016'),'reject has no item');
select pg_temp.expect_failure($s$select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000016','approve',2,'approve-rejected','{}')$s$,'not_eligible');
select pg_temp.assert_true(not exists(select 1 from public.claim_commercial_outreach_items_v1(20,'fixture-again')),'no future rejected outreach');

-- Saving unchanged fields is not an edit, and abandoned claims become explicit failures.
select public.start_commercial_human_review_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000002');
select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000002','update_context',1,'noop','{"outreach_channel":"instagram","message_angle":"A","personalization_note":"","audience_note":""}');
select pg_temp.assert_true(not exists(select 1 from public.commercial_events where lead_id='30000000-0000-4000-8000-000000000002' and event_type='human_review_edited'),'no fake edit on unchanged save');
select public.review_commercial_lead_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','30000000-0000-4000-8000-000000000002','approve',2,'approve-lease','{}');
select count(*) from public.claim_commercial_outreach_items_v1(1,'abandoned');
update public.commercial_outreach_items set generation_locked_at=now()-interval '11 minutes' where generation_locked_by='abandoned';
select pg_temp.assert_true((select count(*)=1 from public.claim_commercial_outreach_items_v1(1,'retry')),'expired claim retried automatically');
update public.commercial_outreach_items set generation_locked_at=now()-interval '11 minutes' where generation_locked_by='retry';
select pg_temp.assert_true((select count(*)=0 from public.claim_commercial_outreach_items_v1(1,'terminal')),'retry budget capped');
select pg_temp.assert_true((select count(*)=1 from public.commercial_outreach_items where state='generation_failed' and generation_attempt_count=max_generation_attempts),'explicit terminal generation failure');
select pg_temp.expect_failure($s$update public.commercial_outreach_items set state='sent'$s$,'constraint');
select pg_temp.expect_failure($s$update public.commercial_events set metadata_safe='{}'$s$,'permission denied');
reset role;
select pg_temp.assert_true(not has_table_privilege('authenticated','public.commercial_events','SELECT'),'direct RLS/ACL denial');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.start_commercial_human_review_v1(uuid,uuid)','EXECUTE'),'authenticated RPC denied');
select pg_temp.assert_true(not has_function_privilege('anon','public.start_commercial_human_review_v1(uuid,uuid)','EXECUTE'),'anonymous RPC denied');
select 'ALL LOCAL HUMAN REVIEW SQL CHECKS PASSED' as result;
rollback;
