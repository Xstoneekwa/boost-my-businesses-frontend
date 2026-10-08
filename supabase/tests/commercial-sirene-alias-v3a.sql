begin;
set local request.jwt.claim.role='service_role';
set local role service_role;
do $$
declare owner uuid:='580d7856-d60f-4838-a5f9-3b405d6ae79b'; run uuid:='7243d1fe-1554-4cf5-ba07-2c6ad07d731d'; business uuid; item uuid; ids uuid[]; sirets text[]:=array['05580205200039','10000706100011','10001008100014','10001013100025']; n integer; r jsonb; original_summary jsonb; baseline text; after_hash text; payload jsonb; rejected boolean;
begin
 if has_function_privilege('authenticated','public.commercial_sirene_alias_v3a_control(uuid,text,uuid,jsonb)','EXECUTE') or has_function_privilege('anon','public.commercial_sirene_alias_v3a_control(uuid,text,uuid,jsonb)','EXECUTE') then raise exception 'browser RPC exposed';end if;
 begin perform public.commercial_sirene_alias_v3a_control('22222222-2222-4222-8222-222222222222','start');raise exception 'generic admin allowed';exception when insufficient_privilege then null;end;
 insert into public.commercial_discovery_runs(id,campaign_id,requested_by,provider,country_code,city,max_prospects,status,idempotency_key,discovery_status,discovery_attempt_count,discovery_max_attempts)
 select run,id,owner,'sirene','FR','France',15,'completed','commercial-france-wide-sirene-poc15-v1','completed',1,1 from public.commercial_campaigns where campaign_code='BMB_FR_BEAUTY_PORTABILITY_V1';
 original_summary:='{"resolver_v2":{"status":"completed","historical":"preserved"}}';
 insert into public.commercial_structured_run_state(run_id,authorization_key,provider,summary) values(run,'commercial-france-wide-sirene-poc15-v1','sirene',original_summary);
 for n in 1..4 loop
  business:=(public.create_structured_commercial_business_v1(owner,'sirene',sirets[n],'Alias fixture '||n,'FR','City','3 rue Test')->>'business_id')::uuid;
  insert into public.commercial_discovery_items(run_id,provider,provider_external_id,idempotency_key,business_id,status,selected_for_processing,source_snapshot_safe,enrichment_snapshot_safe,candidate_rank)
  values(run,'sirene',sirets[n],'aliasfixture'||n,business,'possible_duplicate',false,jsonb_build_object('businessName','Alias fixture '||n,'externalId',sirets[n],'eligibility',jsonb_build_object('prospectingEligible',true)), '{"match":{"confidence":"MEDIUM"},"resolver_v2":{"match":{"confidence":"MEDIUM","matchedHandle":"do_not_change"}}}',n) returning id into item;
  ids:=array_append(ids,item);
 end loop;
 select md5(string_agg(to_jsonb(i)::text,'' order by id)) into baseline from public.commercial_discovery_items i where run_id=run;
 r:=public.commercial_sirene_alias_v3a_control(owner,'start');
 if jsonb_array_length(r->'inputs')<>4 then raise exception 'four inputs missing';end if;
 if not(public.commercial_sirene_alias_v3a_control(owner,'start')->>'replay')::boolean then raise exception 'replay accepted';end if;
 rejected:=false;begin perform public.commercial_sirene_alias_v3a_control(owner,'reserve','00000000-0000-4000-8000-000000000001');exception when raise_exception then rejected:=sqlerrm='alias_identity_changed';end;if not rejected then raise exception 'outside cohort accepted';end if;
 rejected:=false;begin perform public.commercial_sirene_alias_v3a_control(owner,'reserve',ids[2]);exception when raise_exception then rejected:=sqlerrm='alias_budget_sequence_or_replay_denied';end;if not rejected then raise exception 'second before first accepted';end if;
 perform public.commercial_sirene_alias_v3a_control(owner,'reserve',ids[1]);
 rejected:=false;begin perform public.commercial_sirene_alias_v3a_control(owner,'reserve',ids[1]);exception when raise_exception then rejected:=sqlerrm='alias_budget_sequence_or_replay_denied';end;if not rejected then raise exception 'duplicate reserve accepted';end if;
 perform public.commercial_sirene_alias_v3a_control(owner,'record',ids[1],'{"outcome":"SCHEMA_FAIL","schema":"FAIL","aliases":[],"mismatches":["currentPeriod"]}');
 if (select summary#>>'{alias_v3a,status}' from public.commercial_structured_run_state where run_id=run)<>'failed' then raise exception 'schema failure not terminal';end if;
 rejected:=false;begin perform public.commercial_sirene_alias_v3a_control(owner,'reserve',ids[2]);exception when raise_exception then rejected:=sqlerrm='alias_not_running';end;if not rejected then raise exception 'continued after schema failure';end if;
 -- Reset isolated test fixture only, never production; exercise successful path independently.
 update public.commercial_structured_run_state set summary=original_summary where run_id=run;
 perform public.commercial_sirene_alias_v3a_control(owner,'start');
 for n in 1..4 loop
  perform public.commercial_sirene_alias_v3a_control(owner,'reserve',ids[n]);
  payload:=jsonb_build_object('outcome','SUCCESS','schema','PASS','mappingVersion','OFFICIAL_INSEE_API_3_11_V3A','observedAt','2026-09-28T00:00:00Z','eligibility',jsonb_build_object('prospectingEligible',true,'establishmentDiffusion','O','legalUnitDiffusion','O'),'aliases',jsonb_build_array(jsonb_build_object('value','Source name','normalized_lookup_value','sourcename','alias_type','SIGN_NAME','provider','sirene','source_field','periodesEtablissement[dateFin=null].enseigne1Etablissement','observed_at','2026-09-28T00:00:00Z','source_reference','https://api.insee.fr/api-sirene/3.11/siret/'||sirets[n])));
  rejected:=false;begin perform public.commercial_sirene_alias_v3a_control(owner,'record',ids[n],jsonb_set(payload,'{schema}','"FAIL"'));exception when raise_exception then rejected:=sqlerrm='alias_schema_pass_required';end;if not rejected then raise exception 'schema fail persisted';end if;
  rejected:=false;begin perform public.commercial_sirene_alias_v3a_control(owner,'record',ids[n],jsonb_set(payload,'{eligibility,legalUnitDiffusion}','"P"'));exception when raise_exception then rejected:=sqlerrm='alias_diffusion_denied';end;if not rejected then raise exception 'restricted aliases retained';end if;
  rejected:=false;begin perform public.commercial_sirene_alias_v3a_control(owner,'record',ids[n],payload||'{"raw":{"secret":"not_allowed"}}');exception when raise_exception then rejected:=sqlerrm='alias_extra_payload_denied';end;if not rejected then raise exception 'raw retained';end if;
  perform public.commercial_sirene_alias_v3a_control(owner,'record',ids[n],payload);
  rejected:=false;begin perform public.commercial_sirene_alias_v3a_control(owner,'record',ids[n],payload);exception when raise_exception then rejected:=sqlerrm='alias_reservation_required';end;if not rejected then raise exception 'observation overwritten';end if;
 end loop;
 rejected:=false;begin perform public.commercial_sirene_alias_v3a_control(owner,'reserve',ids[1]);exception when raise_exception then rejected:=sqlerrm='alias_budget_sequence_or_replay_denied';end;if not rejected then raise exception 'fifth call accepted';end if;
 perform public.commercial_sirene_alias_v3a_control(owner,'complete');
 if not(public.commercial_sirene_alias_v3a_control(owner,'start')->>'replay')::boolean then raise exception 'terminal replay accepted';end if;
 if (select summary-'alias_v3a' from public.commercial_structured_run_state where run_id=run)<>original_summary then raise exception 'historical evidence altered';end if;
 select md5(string_agg(to_jsonb(i)::text,'' order by id)) into after_hash from public.commercial_discovery_items i where run_id=run;
 if after_hash<>baseline then raise exception 'item or confidence mutated';end if;
end $$;
rollback;
