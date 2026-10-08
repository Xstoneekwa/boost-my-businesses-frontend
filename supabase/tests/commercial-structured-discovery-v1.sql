begin;
set local request.jwt.claim.role='service_role';
set local role service_role;
do $$
declare owner uuid:='580d7856-d60f-4838-a5f9-3b405d6ae79b'; first jsonb; second jsonb; run uuid; n integer; business uuid; item uuid; lead uuid; payload jsonb;
begin
 if not exists(select 1 from public.commercial_identity_providers where provider_key='sirene' and source_policy->>'authorization_key'='commercial-france-wide-sirene-poc15-v1' and source_policy->>'discovery_enabled'='true' and source_policy->>'max_candidates'='15') then raise exception 'bounded provider activation missing';end if;
 first:=public.start_structured_commercial_poc_v1(owner);second:=public.start_structured_commercial_poc_v1(owner);
 if first->>'runId'<>second->>'runId' or (first->>'replay')::boolean or not(second->>'replay')::boolean then raise exception 'single POC replay failed';end if;
 run:=(first->>'runId')::uuid;
 if exists(select 1 from public.claim_commercial_discovery_runs_v2(2,'test') where id=run) then raise exception 'legacy worker claimed structured run';end if;
 for n in 1..2 loop if not public.reserve_structured_call_v1(owner,run,'sirene',n::text,'fixture') then raise exception 'reservation missing';end if;end loop;
 if public.reserve_structured_call_v1(owner,run,'sirene','3','fixture') or public.reserve_structured_call_v1(owner,run,'sirene','1','fixture') then raise exception 'Sirene cap/replay failed';end if;
 for n in 1..15 loop if not public.reserve_structured_call_v1(owner,run,'search',n::text,'fixture') then raise exception 'search reservation missing';end if;end loop;
 if public.reserve_structured_call_v1(owner,run,'search','16','fixture') then raise exception 'search cap failed';end if;
 perform public.reserve_structured_call_v1(owner,run,'site','id:1','fixture');perform public.reserve_structured_call_v1(owner,run,'site','id:2','fixture');
 if public.reserve_structured_call_v1(owner,run,'site','id:3','fixture') then raise exception 'per-site cap failed';end if;
 begin perform public.start_structured_commercial_poc_v1('00000000-0000-0000-0000-000000000001');raise exception 'ordinary user accepted';exception when insufficient_privilege then null;end;
 begin perform public.persist_structured_scored_lead_v1(owner,'00000000-0000-0000-0000-000000000001','{}');raise exception 'missing item accepted';exception when raise_exception then if sqlerrm<>'structured_scoring_gate_failed' then raise;end if;end;
 if has_function_privilege('authenticated','public.start_structured_commercial_poc_v1(uuid)','EXECUTE') or has_function_privilege('anon','public.reserve_structured_call_v1(uuid,uuid,text,text,text)','EXECUTE') or has_table_privilege('authenticated','public.commercial_structured_run_state','SELECT') then raise exception 'browser access exposed';end if;
 business:=(public.create_structured_commercial_business_v1(owner,'sirene','72345678900001','POC fixture','FR','Lille','3 rue Test')->>'business_id')::uuid;
 insert into public.commercial_discovery_items(run_id,provider,provider_external_id,idempotency_key,business_id,status,selected_for_processing,source_snapshot_safe,enrichment_snapshot_safe)
 values(run,'sirene','72345678900001','pocfixture',business,'processing',false,'{"eligibility":{"prospectingEligible":true}}','{"match":{"confidence":"MEDIUM"},"profile":{"status":"found","is_private":false}}') returning id into item;
 if exists(select 1 from public.claim_commercial_discovery_items_v2(5,'test') where id=item) then raise exception 'legacy worker claimed structured item';end if;
 payload:='{"qualificationStatus":"qualified","scorePercent":85,"crmPriority":"urgent","score":8.5,"scorePriority":"P1","recommendedChannel":"instagram","recommendedAngle":"A","scoringModelVersion":"BMB_SCORING_MODEL_V2","breakdown":{},"confidence":0.9,"model":"fixture","promptVersion":"fixture","needsManualReview":true,"hardGateCodes":[]}';
 begin perform public.persist_structured_scored_lead_v1(owner,item,payload);raise exception 'MEDIUM accepted';exception when raise_exception then if sqlerrm<>'structured_scoring_gate_failed' then raise;end if;end;
 update public.commercial_discovery_items set enrichment_snapshot_safe=jsonb_set(enrichment_snapshot_safe,'{match,confidence}','"HIGH"') where id=item;
 perform public.reserve_structured_call_v1(owner,run,'scoring','72345678900001','fixture');
 perform public.finish_structured_call_v1(owner,run,'scoring','72345678900001','PASS',12,1);
 lead:=public.persist_structured_scored_lead_v1(owner,item,payload);
 if lead is null or public.persist_structured_scored_lead_v1(owner,item,payload)<>lead then raise exception 'lead creation/replay failed';end if;
 if not exists(select 1 from public.commercial_leads where id=lead and qualification_status='qualified' and approved_at is null and outreach_status='not_started' and lead_score=8.5 and outreach_channel='instagram' and message_angle='A') then raise exception 'lead not frozen for review';end if;
 if exists(select 1 from public.commercial_outreach_items where lead_id=lead) then raise exception 'message generated';end if;
end $$;
rollback;
