\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$ begin if not coalesce(ok,false) then raise exception '%',label;end if;end $$;
select pg_temp.check_true(not has_function_privilege('anon','public.create_commercial_discovery_run_v2(uuid,text,text,integer,text,boolean)','EXECUTE') and not has_function_privilege('authenticated','public.create_commercial_discovery_run_v2(uuid,text,text,integer,text,boolean)','EXECUTE'),'owner backend only');
insert into commercial_businesses(business_name,country_code,city,vertical,instagram_handle,source) values('SA preservation fixture','ZA','Cape Town','Beauty/Aesthetics','sa_preservation_fixture','manual');
create temp table sa_before as select md5(jsonb_agg(to_jsonb(b) order by id)::text) hash from commercial_businesses b where country_code='ZA';
do $$ declare r jsonb; r2 jsonb; rid uuid; iid uuid; payload jsonb; result jsonb; begin
 begin perform create_commercial_discovery_run_v2('44444444-4444-4444-8444-444444444444','France',null,30,'commercial-france-beauty-portability-canary-v1',false); raise exception 'ordinary admin accepted'; exception when insufficient_privilege then null;end;
 begin perform create_commercial_discovery_run_v2('580d7856-d60f-4838-a5f9-3b405d6ae79b','France',null,31,'commercial-france-beauty-portability-canary-v1',false); raise exception '31 accepted'; exception when invalid_parameter_value then null;end;
 r:=create_commercial_discovery_run_v2('580d7856-d60f-4838-a5f9-3b405d6ae79b','France',null,30,'commercial-france-beauty-portability-canary-v1',false);
 r2:=create_commercial_discovery_run_v2('580d7856-d60f-4838-a5f9-3b405d6ae79b','France',null,30,'commercial-france-beauty-portability-canary-v1',false);
 if r->>'id'<>r2->>'id' or r2->>'idempotent_replay'<>'true' then raise exception 'duplicate run';end if;
 rid:=(r->>'id')::uuid;
 update commercial_discovery_runs set status='running',discovery_status='completed',discovered_count=1 where id=rid;
 insert into commercial_discovery_items(run_id,provider,provider_external_id,idempotency_key,status,stage,location_country,location_city,location_confidence,precheck_decision,selected_for_processing)
 values(rid,'searchapi','fr_fixture_annecy','fr_fixture_annecy','processing','ENRICHED','FR','Annecy','HIGH','PRECHECK_PASS',true) returning id into iid;
 payload:='{"provider":"searchapi","provider_external_id":"fr_fixture_annecy","instagram_handle":"fr_fixture_annecy","business_name":"Institut Test Annecy","country_code":"FR","city":"Annecy","vertical":"Beauty/Aesthetics","subsegment":"Beauty Salon","lead_score":7.8,"score_percent":78,"score_priority":"P2","priority":"high","qualification_status":"qualified","item_status":"created","recommended_channel":"instagram","recommended_angle":"B","scoring_model_version":"BMB_SCORING_MODEL_V2","ai_prompt_version":"BMB_COMMERCIAL_AI_V2","ai_model":"fixture","source_snapshot_hash":"frfixture","location_confidence":"HIGH"}'::jsonb;
 begin perform ingest_commercial_discovery_candidate_v2(iid,payload||'{"country_code":"ZA"}');raise exception 'wrong country accepted';exception when invalid_parameter_value then null;end;
 result:=ingest_commercial_discovery_candidate_v2(iid,payload);
 if not exists(select 1 from commercial_businesses where id=(result->>'business_id')::uuid and city='Annecy' and country_code='FR') then raise exception 'city or country incorrect';end if;
 if not exists(select 1 from commercial_leads where id=(result->>'lead_id')::uuid and qualification_status='qualified' and approved_at is null and city_snapshot='Annecy') then raise exception 'approval or city modified';end if;
 perform refresh_commercial_discovery_run_v2(rid);
 if not exists(select 1 from commercial_campaigns where campaign_code='BMB_FR_BEAUTY_PORTABILITY_V1' and jsonb_array_length(metadata_safe->'human_review_sample_ids')=1) then raise exception 'sample not frozen';end if;
end $$;
select pg_temp.check_true((select count(*)=1 from commercial_discovery_runs where country_code='FR'),'one canary');
select pg_temp.check_true((select hash from sa_before)=(select md5(jsonb_agg(to_jsonb(b) order by id)::text) from commercial_businesses b where country_code='ZA'),'SA unchanged');
