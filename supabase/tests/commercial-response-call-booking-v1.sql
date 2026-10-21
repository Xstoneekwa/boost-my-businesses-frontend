\set ON_ERROR_STOP on
-- Synthetic local fixture DB only; the runner starts a fresh Unix-socket-only cluster.
begin;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare owner_id uuid:='580d7856-d60f-4838-a5f9-3b405d6ae79b'; campaign uuid; business uuid; lead uuid; contact uuid; item uuid; result jsonb; s jsonb; approved_lead uuid; approved_business uuid; generating_item uuid;
begin
  insert into public.commercial_campaigns(campaign_code,name,country_code,vertical,created_by,updated_by)
  values('FOLLOWUP_FIXTURE','Followup fixture','FR','Beauty',owner_id,owner_id) returning id into campaign;
  insert into public.commercial_businesses(business_name,country_code,vertical,source)
  values('Synthetic followup only','FR','Beauty','fixture') returning id into business;
  insert into public.commercial_contacts(business_id,email,phone)
  values(business,'followup@example.invalid','0600000000') returning id into contact;
  insert into public.commercial_leads(campaign_id,business_id,primary_contact_id) values(campaign,business,contact) returning id into lead;
  s:=jsonb_build_object('schema_version',1,'replies',jsonb_build_array(jsonb_build_object('id','reply-test','contact_id',contact,'outreach_item_id',null)),'actions','[]'::jsonb,'calls','[]'::jsonb,'bookings','[]'::jsonb,'notifications','[]'::jsonb,'do_not_contact',false);
  result:=public.commit_commercial_followup_v1(owner_id,lead,0,'test-reply',repeat('a',64),'reply_received',s,'{}');
  if result->>'version'<>'1' then raise exception 'version_failed'; end if;
  if not exists(select 1 from public.commercial_followup_workflows where lead_id=lead and cold_suspended) then raise exception 'cold_not_suspended'; end if;
  if not exists(select 1 from public.commercial_leads where id=lead and outreach_status='stopped') then raise exception 'unapproved_lead_auto_approved'; end if;
  if (select count(*) from public.commercial_events where lead_id=lead and idempotency_key in ('test-reply','test-reply:stop'))<>2 then raise exception 'missing_atomic_events'; end if;
  result:=public.commit_commercial_followup_v1(owner_id,lead,0,'test-reply',repeat('a',64),'reply_received',s,'{}');
  if result->>'duplicate'<>'true' then raise exception 'duplicate_failed'; end if;
  begin perform public.commit_commercial_followup_v1(owner_id,lead,0,'stale',repeat('a',64),'reply_classified',s,'{}');raise exception 'stale_not_rejected';exception when serialization_failure then null;end;
  begin perform public.commit_commercial_followup_v1('22222222-2222-4222-8222-222222222222',lead,1,'no-grant',repeat('b',64),'reply_classified',s,'{}');raise exception 'other_superadmin_allowed';exception when insufficient_privilege then null;end;
  begin perform public.commit_commercial_followup_v1('44444444-4444-4444-8444-444444444444',lead,1,'admin',repeat('b',64),'reply_classified',s,'{}');raise exception 'admin_allowed';exception when insufficient_privilege then null;end;
  begin perform public.commit_commercial_followup_v1('11111111-1111-4111-8111-111111111111',lead,1,'client',repeat('b',64),'reply_classified',s,'{}');raise exception 'client_allowed';exception when insufficient_privilege then null;end;
  begin perform public.commit_commercial_followup_v1(null,lead,1,'anonymous',repeat('b',64),'reply_classified',s,'{}');raise exception 'anonymous_allowed';exception when insufficient_privilege then null;end;
  begin update public.commercial_followup_receipts set operation='changed' where source_key='test-reply';raise exception 'receipt_mutable';exception when insufficient_privilege then null;end;
  result:=public.commit_commercial_followup_v1(owner_id,null,0,'unknown-number',repeat('c',64),'unmatched',null,'{"reason":"unknown_phone"}');
  if result->>'unmatched'<>'true' then raise exception 'unmatched_failed';end if;
  if exists(select 1 from public.commercial_followup_receipts where source_key='unknown-number' and lead_id is not null) then raise exception 'unknown_mutated_lead';end if;
  if has_table_privilege('authenticated','public.commercial_followup_workflows','SELECT') or has_function_privilege('authenticated','public.commit_commercial_followup_v1(uuid,uuid,integer,text,text,text,jsonb,jsonb)','EXECUTE') then raise exception 'browser_access';end if;
  insert into public.commercial_businesses(business_name,country_code,vertical,source)
  values('Synthetic approved copy','FR','Beauty','fixture') returning id into approved_business;
  insert into public.commercial_leads(campaign_id,business_id,qualification_status,approved_by,approved_at,outreach_channel,message_angle)
  values(campaign,approved_business,'approved',owner_id,now(),'email','A') returning id into approved_lead;
  update public.commercial_outreach_items set state='queued_dry_run',subject='Fixture',body='Previously approved body: must remain byte-identical.',approved_by=owner_id,approved_at=now()
  where lead_id=approved_lead returning id into item;
  s:=jsonb_set(s,'{replies}','[]');
  perform public.commit_commercial_followup_v1(owner_id,approved_lead,0,'approved-reply',repeat('d',64),'reply_received',s,'{}');
  if not exists(select 1 from public.commercial_outreach_items where id=item and state='cancelled' and body='Previously approved body: must remain byte-identical.' and approved_by=owner_id and approved_at is not null) then raise exception 'approved_copy_changed_or_queue_not_cancelled';end if;
  begin update public.commercial_outreach_items set state='queued_dry_run',cancelled_at=null,cancelled_by=null,cancellation_reason=null where id=item;raise exception 'cold_queue_reactivated';exception when insufficient_privilege then null;end;
  begin insert into public.commercial_outreach_items(lead_id,campaign_id,channel,angle,template_key,template_version,idempotency_key)
    values(approved_lead,campaign,'email','A',public.commercial_outreach_template_key_v1('email','A'),'V1','after-reply');raise exception 'new_cold_path_created';exception when insufficient_privilege then null;end;
  insert into public.commercial_businesses(business_name,country_code,vertical,source)
  values('Synthetic in-flight generation','FR','Beauty','fixture') returning id into approved_business;
  insert into public.commercial_leads(campaign_id,business_id,qualification_status,approved_by,approved_at,outreach_channel,message_angle)
  values(campaign,approved_business,'approved',owner_id,now(),'email','A') returning id into approved_lead;
  update public.commercial_outreach_items set state='generating',generation_locked_by='fixture-worker',generation_locked_at=now(),generation_attempt_count=1 where lead_id=approved_lead returning id into generating_item;
  perform public.commit_commercial_followup_v1(owner_id,approved_lead,0,'in-flight-reply',repeat('e',64),'reply_received',s,'{}');
  begin perform public.complete_commercial_outreach_generation_v1(generating_item,'fixture-worker',true,'{"subject":"Fixture","body":"A late generated message must never become ready."}','{}');raise exception 'late_generation_accepted';exception when serialization_failure then null;end;
  if not exists(select 1 from public.commercial_outreach_items where id=generating_item and state='cancelled' and body is null)then raise exception 'late_body_persisted';end if;
end $$;
rollback;
