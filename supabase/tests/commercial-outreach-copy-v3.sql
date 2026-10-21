-- LOCAL ONLY. The driver inserts the migration inside this rollback transaction.
begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
insert into public.commercial_campaigns(id,campaign_code,name,country_code,vertical,created_by,updated_by)
values('10000000-0000-4000-8000-000000000003','LOCAL_COPY_V3','LOCAL COPY FIXTURE','ZA','beauty','580d7856-d60f-4838-a5f9-3b405d6ae79b','580d7856-d60f-4838-a5f9-3b405d6ae79b');
insert into public.commercial_businesses(id,business_name,country_code,vertical)
select ('20000000-0000-4000-8003-'||lpad(n::text,12,'0'))::uuid,'LOCAL COPY FIXTURE '||n,'ZA','beauty' from generate_series(1,6)n;
insert into public.commercial_leads(id,business_id,campaign_id,qualification_status,outreach_channel,message_angle,approved_by,approved_at)
select ('30000000-0000-4000-8003-'||lpad(n::text,12,'0'))::uuid,('20000000-0000-4000-8003-'||lpad(n::text,12,'0'))::uuid,
 '10000000-0000-4000-8000-000000000003','approved','instagram','A','580d7856-d60f-4838-a5f9-3b405d6ae79b',now() from generate_series(1,2)n;
update public.commercial_outreach_items set body='Historical owner-approved copy [Your Name]', state='queued_dry_run', approved_by='580d7856-d60f-4838-a5f9-3b405d6ae79b', approved_at=now()
where lead_id='30000000-0000-4000-8003-000000000001';
update public.commercial_outreach_items set body='Historical ready copy', state='ready_for_review'
where lead_id='30000000-0000-4000-8003-000000000002';
create temp table copy_before as select id,to_jsonb(i) snapshot from public.commercial_outreach_items i;
grant select on copy_before to service_role;
create temp table templates_before as select template_key,to_jsonb(t) snapshot from public.commercial_outreach_templates t;
create temp table rpc_before as select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (p.proname like '%commercial_outreach%v1' or p.proname='commercial_crm_actor_authorized_v1');

-- APPLY_COPY_MIGRATION

select pg_temp.assert_true(not exists(select 1 from copy_before b join public.commercial_outreach_items i using(id) where b.snapshot<>to_jsonb(i)),'all historical rows preserved exactly');
select pg_temp.assert_true(not exists(select 1 from templates_before b join public.commercial_outreach_templates t using(template_key) where b.snapshot<>to_jsonb(t)),'historical catalogue unchanged');
select pg_temp.assert_true(not exists(select 1 from rpc_before b where b.definition<>pg_get_functiondef(b.oid)),'all original state/owner RPCs unchanged');
select pg_temp.assert_true((select count(*)=8 from public.commercial_outreach_templates),'four appended versions');
set local role service_role;
insert into public.commercial_leads(id,business_id,campaign_id,qualification_status,outreach_channel,message_angle,approved_by,approved_at)
select ('30000000-0000-4000-8003-'||lpad(n::text,12,'0'))::uuid,('20000000-0000-4000-8003-'||lpad(n::text,12,'0'))::uuid,
 '10000000-0000-4000-8000-000000000003','approved',case when n<5 then 'instagram' else 'email' end,case when n%2=1 then 'A' else 'B' end,'580d7856-d60f-4838-a5f9-3b405d6ae79b',now() from generate_series(3,6)n;
select pg_temp.assert_true((select count(*)=4 and count(distinct template_version)=4 and bool_and(template_key like '%_V1') and bool_and(template_version like '%_V3') and bool_and(state='draft') from public.commercial_outreach_items where lead_id::text like '30000000-0000-4000-8003-%' and lead_id::text>'30000000-0000-4000-8003-000000000002'),'new drafts versioned on all four paths, stable routing');
do $$ declare i public.commercial_outreach_items%rowtype; result jsonb;
begin
 select * into i from public.commercial_outreach_items where lead_id='30000000-0000-4000-8003-000000000002';
 result:=public.mutate_commercial_outreach_item_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b',i.id,'regenerate',i.version,'local-copy-v3-regenerate','{}');
 perform pg_temp.assert_true((select state='draft' and template_version='IG_BEAUTY_ANGLE_A_V3' and template_key=i.template_key and supersedes_item_id=i.id from public.commercial_outreach_items where id=(result->>'replacement_item_id')::uuid),'existing regenerate RPC creates versioned replacement');
 perform pg_temp.assert_true((select body=i.body and template_version=i.template_version and state='cancelled' from public.commercial_outreach_items where id=i.id),'old text and version retained in cancelled history');
end $$;
-- An unrelated future lead edit must NOT cancel an already approved old copy.
update public.commercial_leads set personalization_context_safe='{"note":"LOCAL test"}' where id='30000000-0000-4000-8003-000000000001';
select pg_temp.assert_true((select b.snapshot=to_jsonb(i) from copy_before b join public.commercial_outreach_items i using(id) where i.lead_id='30000000-0000-4000-8003-000000000001'),'approved old copy survives later lead edit');
reset role;
select pg_temp.assert_true(not has_function_privilege('authenticated','public.commercial_outreach_stamp_copy_version_v3()','EXECUTE') and not has_function_privilege('anon','public.commercial_outreach_stamp_copy_version_v3()','EXECUTE'),'new function not callable by generic users');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.commercial_outreach_items','SELECT,INSERT,UPDATE') and not has_table_privilege('anon','public.commercial_outreach_items','SELECT,INSERT,UPDATE'),'data access still closed');
select 'ALL LOCAL COPY V3 SQL CHECKS PASSED' as result;
rollback;
