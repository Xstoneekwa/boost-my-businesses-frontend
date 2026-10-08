\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
create temp table old_fr_leads as select md5(jsonb_agg(to_jsonb(l) order by id)::text) hash from commercial_leads l;
do $$ declare a jsonb; b jsonb; rejected boolean:=false; begin
 a:=create_commercial_discovery_run_v2('580d7856-d60f-4838-a5f9-3b405d6ae79b','France',null,30,'commercial-france-location-evidence-hardening-v1',false);
 b:=create_commercial_discovery_run_v2('580d7856-d60f-4838-a5f9-3b405d6ae79b','France',null,30,'commercial-france-location-evidence-hardening-v1',false);
 if a->>'id'<>b->>'id' or b->>'idempotent_replay'<>'true' then raise exception 'second canary not idempotent';end if;
 begin perform create_commercial_discovery_run_v2('580d7856-d60f-4838-a5f9-3b405d6ae79b','France',null,30,'third-canary',false); exception when others then rejected:=true;end;
 if not rejected then raise exception 'third run allowed';end if;
 if (select count(*) from commercial_discovery_runs where country_code='FR')<>2 then raise exception 'not exactly two';end if;
 if (select hash from old_fr_leads) is distinct from (select md5(jsonb_agg(to_jsonb(l) order by id)::text) from commercial_leads l) then raise exception 'old leads modified';end if;
 if has_function_privilege('authenticated','public.create_commercial_discovery_run_v2(uuid,text,text,integer,text,boolean)','EXECUTE') then raise exception 'access broadened';end if;
end $$;
