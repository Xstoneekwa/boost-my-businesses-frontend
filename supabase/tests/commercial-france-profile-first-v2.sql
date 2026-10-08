\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
create temp table old_fr_leads as select md5(jsonb_agg(to_jsonb(l) order by id)::text) hash from commercial_leads l;
update commercial_discovery_runs set status='completed_with_errors',discovery_status='completed',completed_at=now() where idempotency_key='commercial-france-location-evidence-hardening-v1';
do $$ declare a jsonb; b jsonb; rejected boolean:=false; rid uuid; iid uuid; begin
 a:=create_commercial_discovery_run_v2('580d7856-d60f-4838-a5f9-3b405d6ae79b','France',null,30,'commercial-france-profile-first-v2-canary',false);
 b:=create_commercial_discovery_run_v2('580d7856-d60f-4838-a5f9-3b405d6ae79b','France',null,30,'commercial-france-profile-first-v2-canary',false);
 if a->>'id'<>b->>'id' or b->>'idempotent_replay'<>'true' then raise exception 'third not idempotent';end if;
 rid:=(a->>'id')::uuid;
 if not exists(select 1 from commercial_discovery_runs where id=rid and discovery_max_attempts=1 and not force_rescore) then raise exception 'retry cap';end if;
 begin perform create_commercial_discovery_run_v2('580d7856-d60f-4838-a5f9-3b405d6ae79b','France',null,30,'fourth-canary',false);exception when others then rejected:=true;end;
 if not rejected then raise exception 'fourth accepted';end if;
 rejected:=false;
 begin perform create_commercial_discovery_run_v2('44444444-4444-4444-8444-444444444444','France',null,30,'commercial-france-profile-first-v2-canary',false);exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'ordinary admin accepted';end if;
 if (select count(*) from commercial_discovery_runs where country_code='FR')<>3 then raise exception 'not three runs';end if;
 if has_table_privilege('authenticated','commercial_france_serp_pages_v2','SELECT') or has_table_privilege('anon','commercial_france_serp_pages_v2','SELECT') then raise exception 'capture data exposed';end if;
 if has_function_privilege('authenticated','reserve_commercial_france_score_v2(uuid)','EXECUTE') then raise exception 'score reservation exposed';end if;
 insert into commercial_france_serp_pages_v2(run_id,query_id,page,payload) values(rid,'f1-control',1,'{}');
 rejected:=false;
 begin insert into commercial_france_serp_pages_v2(run_id,query_id,page,payload) values(rid,'f1-control',1,'{}');exception when unique_violation then rejected:=true;end;
 if not rejected then raise exception 'page replay not blocked';end if;
 insert into commercial_discovery_items(run_id,provider,provider_external_id,idempotency_key,status,stage,location_country,location_city,location_confidence,precheck_decision,selected_for_processing,enriched_at)
 values(rid,'searchapi','v2_score_fixture','v2_score_fixture','processing','ENRICHED','FR','Paris','HIGH','PRECHECK_PASS',true,now()) returning id into iid;
 if not reserve_commercial_france_score_v2(iid) then raise exception 'reservation failed';end if;
 if reserve_commercial_france_score_v2(iid) then raise exception 'AI replay allowed';end if;
 if (select hash from old_fr_leads) is distinct from (select md5(jsonb_agg(to_jsonb(l) order by id)::text) from commercial_leads l) then raise exception 'old leads changed';end if;
end $$;
