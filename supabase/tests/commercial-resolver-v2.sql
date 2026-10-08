begin;
set local request.jwt.claim.role='service_role';
set local role service_role;
do $$
declare owner uuid:='580d7856-d60f-4838-a5f9-3b405d6ae79b'; run uuid; business uuid; item uuid; first_item uuid; n integer; r jsonb; output jsonb:='[]'; baseline bigint; rejected boolean;
begin
 if has_function_privilege('authenticated','public.commercial_resolver_v2_control(uuid,text,uuid,text,text,jsonb)','EXECUTE') or has_function_privilege('anon','public.commercial_resolver_v2_control(uuid,text,uuid,text,text,jsonb)','EXECUTE') then raise exception 'browser RPC exposed';end if;
 begin perform public.commercial_resolver_v2_control('22222222-2222-4222-8222-222222222222','start');raise exception 'generic superadmin allowed';exception when insufficient_privilege then null;end;
 run:=(public.start_structured_commercial_poc_v1(owner)->>'runId')::uuid;
 update public.commercial_discovery_runs set status='completed' where id=run;
 select count(*) into baseline from public.commercial_leads;
 for n in 1..15 loop
  business:=(public.create_structured_commercial_business_v1(owner,'sirene','823456789'||lpad(n::text,5,'0'),'Resolver fixture '||n,'FR','Lille','3 rue Test')->>'business_id')::uuid;
  insert into public.commercial_discovery_items(run_id,provider,provider_external_id,idempotency_key,business_id,status,selected_for_processing,source_snapshot_safe,enrichment_snapshot_safe,candidate_rank)
  values(run,'sirene','823456789'||lpad(n::text,5,'0'),'resolverfixture'||n,business,'processing',false,'{"eligibility":{"prospectingEligible":true}}','{"match":{"confidence":"MEDIUM"}}',n) returning id into item;
  if n=1 then first_item:=item;end if;
  output:=output||jsonb_build_array(jsonb_build_object('itemId',item,'businessId',business,'resolution',jsonb_build_object('match',jsonb_build_object('confidence','MEDIUM','resolverVersion','COMMERCIAL_INSTAGRAM_RESOLVER_V2'))));
 end loop;
 r:=public.commercial_resolver_v2_control(owner,'start');
 if r->>'status'<>'running' or jsonb_array_length(r->'inputs')<>15 then raise exception 'start failed';end if;
 if not(public.commercial_resolver_v2_control(owner,'start')->>'replay')::boolean then raise exception 'replay not locked';end if;
 perform public.commercial_resolver_v2_control(owner,'reserve',first_item,'search','target');
 rejected:=false;begin perform public.commercial_resolver_v2_control(owner,'reserve',first_item,'search','second');exception when raise_exception then rejected:=sqlerrm='resolver_budget_or_replay_denied';end;if not rejected then raise exception 'second search accepted';end if;
 rejected:=false;begin perform public.commercial_resolver_v2_control(owner,'reserve',first_item,'sirene','forbidden');exception when raise_exception then rejected:=sqlerrm='resolver_call_kind_denied';end;if not rejected then raise exception 'Sirene accepted';end if;
 rejected:=false;begin perform public.commercial_resolver_v2_control(owner,'complete',p_payload=>jsonb_build_object('results',output));exception when raise_exception then rejected:=sqlerrm='resolver_calls_unfinished';end;if not rejected then raise exception 'unfinished accepted';end if;
 perform public.commercial_resolver_v2_control(owner,'record',first_item,'search','target','{"outcome":"EMPTY_RESULTS"}');
 for n in 1..2 loop
  perform public.commercial_resolver_v2_control(owner,'reserve',first_item,'page',n::text);
  perform public.commercial_resolver_v2_control(owner,'record',first_item,'page',n::text,'{"outcome":"SUCCESS","httpStatus":200}');
 end loop;
 rejected:=false;begin perform public.commercial_resolver_v2_control(owner,'reserve',first_item,'page','3');exception when raise_exception then rejected:=sqlerrm='resolver_budget_or_replay_denied';end;if not rejected then raise exception 'third page accepted';end if;
 update public.commercial_discovery_items set source_snapshot_safe=source_snapshot_safe||'{"changed":true}' where id=first_item;
 rejected:=false;begin perform public.commercial_resolver_v2_control(owner,'complete',p_payload=>jsonb_build_object('results',output));exception when raise_exception then rejected:=sqlerrm='resolver_identity_changed';end;if not rejected then raise exception 'stale accepted';end if;
 update public.commercial_discovery_items set source_snapshot_safe=source_snapshot_safe-'changed' where id=first_item;
 perform public.commercial_resolver_v2_control(owner,'complete',p_payload=>jsonb_build_object('results',output));
 if (select count(*) from public.commercial_discovery_items where run_id=run and enrichment_snapshot_safe#>>'{match,confidence}'='MEDIUM' and enrichment_snapshot_safe?'resolver_v2' and lead_id is null and not selected_for_processing)<>15 then raise exception 'preservation failed';end if;
 if (select count(*) from public.commercial_leads)<>baseline then raise exception 'lead created';end if;
 if not(public.commercial_resolver_v2_control(owner,'start')->>'replay')::boolean then raise exception 'completed replay allowed';end if;
end $$;
rollback;
