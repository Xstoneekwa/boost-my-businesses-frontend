begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Separate append-once observations in the existing private ledger; no item/business updates.
create function public.commercial_sirene_alias_v3a_control(p_actor_user_id uuid,p_action text,p_item_id uuid default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.commercial_structured_run_state%rowtype; v jsonb; inputs jsonb; input jsonb; calls jsonb; call jsonb; a jsonb; n integer; expected_sirets text[]:=array['05580205200039','10000706100011','10001008100014','10001013100025'];
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' or not public.commercial_crm_actor_authorized_v1(p_actor_user_id) then raise exception 'commercial_owner_required' using errcode='42501';end if;
 select * into s from public.commercial_structured_run_state where authorization_key='commercial-france-wide-sirene-poc15-v1' for update;
 if not found or s.run_id<>'7243d1fe-1554-4cf5-ba07-2c6ad07d731d'::uuid then raise exception 'alias_existing_cohort_required';end if;
 v:=s.summary->'alias_v3a';
 if p_action='start' then
  if v is not null then return jsonb_build_object('replay',true,'status',v->>'status');end if;
  if s.summary#>>'{resolver_v2,status}' is distinct from 'completed' or not exists(select 1 from public.commercial_discovery_runs where id=s.run_id and status='completed' and requested_by=p_actor_user_id) then raise exception 'alias_completed_owner_cohort_required';end if;
  select jsonb_agg(jsonb_build_object('runId',i.run_id,'itemId',i.id,'businessId',i.business_id,'siret',i.provider_external_id,'currentLookupName',i.source_snapshot_safe->>'businessName','confidence','MEDIUM','eligible',true,'leadId',null,'selected',false,'itemHash',md5(to_jsonb(i)::text),'businessHash',md5(to_jsonb(b)::text)) order by array_position(expected_sirets,i.provider_external_id)) into inputs
  from public.commercial_discovery_items i join public.commercial_businesses b on b.id=i.business_id
  where i.run_id=s.run_id and i.provider='sirene' and i.provider_external_id=any(expected_sirets)
   and not i.selected_for_processing and i.lead_id is null and b.identity_mode='structured'
   and i.source_snapshot_safe#>>'{eligibility,prospectingEligible}'='true'
   and i.source_snapshot_safe->>'externalId'=i.provider_external_id
   and i.enrichment_snapshot_safe#>>'{resolver_v2,match,confidence}'='MEDIUM'
   and exists(select 1 from public.commercial_business_identifiers bi where bi.business_id=b.id and bi.provider='sirene' and bi.external_id=i.provider_external_id);
  if jsonb_array_length(coalesce(inputs,'[]'))<>4 or (select count(distinct x->>'siret') from jsonb_array_elements(inputs) x)<>4 then raise exception 'alias_exact_four_required';end if;
  v:=jsonb_build_object('version','SIRENE_ALIAS_DIAGNOSTIC_V3A','status','running','actor',p_actor_user_id,'startedAt',clock_timestamp(),'inputs',inputs,'calls','[]'::jsonb,'schemaVerification','PROVISIONAL','liveSendEligible',false,'autoApproval',false);
 elsif p_action in ('reserve','record','complete','fail') then
  if v is null or v->>'status'<>'running' or v->>'actor'<>p_actor_user_id::text then raise exception 'alias_not_running';end if;
  calls:=v->'calls';n:=jsonb_array_length(calls);
  if p_action in ('reserve','record') then
   select x into input from jsonb_array_elements(v->'inputs') x where x->>'itemId'=p_item_id::text;
   if input is null or not exists(select 1 from public.commercial_discovery_items i join public.commercial_businesses b on b.id=i.business_id where i.id=p_item_id and md5(to_jsonb(i)::text)=input->>'itemHash' and md5(to_jsonb(b)::text)=input->>'businessHash') then raise exception 'alias_identity_changed';end if;
  end if;
  if p_action='reserve' then
   if clock_timestamp()>(v->>'startedAt')::timestamptz+interval '5 minutes' then raise exception 'alias_deadline';end if;
   if n>=4 or (v->'inputs'->n->>'itemId') is distinct from p_item_id::text or exists(select 1 from jsonb_array_elements(calls) c where c->>'outcome'='RESERVED') then raise exception 'alias_budget_sequence_or_replay_denied';end if;
   if n>0 and v->>'schemaVerification'<>'PASS' then raise exception 'alias_live_schema_required';end if;
   v:=jsonb_set(v,'{calls}',calls||jsonb_build_array(jsonb_build_object('itemId',p_item_id,'siret',input->>'siret','callNumber',n+1,'outcome','RESERVED','startedAt',clock_timestamp())));
  elsif p_action='record' then
   if n=0 or calls->(n-1)->>'itemId' is distinct from p_item_id::text or calls->(n-1)->>'outcome'<>'RESERVED' then raise exception 'alias_reservation_required';end if;
   if p_payload->>'outcome' is null or p_payload->>'outcome' not in ('SUCCESS','INELIGIBLE','SCHEMA_FAIL','ERROR') or length(p_payload::text)>18000 or jsonb_typeof(p_payload->'aliases') is distinct from 'array' then raise exception 'alias_payload_invalid';end if;
   if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('outcome','schema','aliases','eligibility','observedAt','mappingVersion','mismatches','errorCode')) then raise exception 'alias_extra_payload_denied';end if;
   if p_payload->>'outcome'<>'SUCCESS' and jsonb_array_length(p_payload->'aliases')<>0 then raise exception 'alias_partial_retention_denied';end if;
   if p_payload->>'outcome' in ('SUCCESS','INELIGIBLE') and (p_payload->>'schema' is distinct from 'PASS' or p_payload->>'mappingVersion' is distinct from 'OFFICIAL_INSEE_API_3_11_V3A') then raise exception 'alias_schema_pass_required';end if;
   if p_payload->>'outcome'='SUCCESS' and (p_payload#>>'{eligibility,prospectingEligible}' is distinct from 'true' or p_payload#>>'{eligibility,establishmentDiffusion}' is distinct from 'O' or p_payload#>>'{eligibility,legalUnitDiffusion}' is distinct from 'O') then raise exception 'alias_diffusion_denied';end if;
   if jsonb_array_length(p_payload->'aliases')>8 then raise exception 'alias_occurrence_cap';end if;
   for a in select * from jsonb_array_elements(p_payload->'aliases') loop
    if jsonb_typeof(a) is distinct from 'object' or a->>'provider' is distinct from 'sirene' or a->>'source_reference' is distinct from 'https://api.insee.fr/api-sirene/3.11/siret/'||(input->>'siret') or a->>'observed_at' is distinct from p_payload->>'observedAt' or coalesce(length(a->>'value'),0) not between 1 and 1000 or coalesce(length(a->>'normalized_lookup_value'),0) not between 1 and 1000 or coalesce(a->>'alias_type','') not in ('LEGAL_NAME','ESTABLISHMENT_USUAL_NAME','SIGN_NAME','LEGAL_UNIT_USUAL_NAME') or coalesce(a->>'source_field','') !~ '^(periodesEtablissement\[dateFin=null\]\.(enseigne[123]Etablissement|denominationUsuelleEtablissement)|uniteLegale\.(denominationUniteLegale|denominationUsuelle[123]UniteLegale))$' then raise exception 'alias_occurrence_invalid';end if;
    if exists(select 1 from jsonb_object_keys(a) k where k not in ('value','normalized_lookup_value','alias_type','provider','source_field','observed_at','source_reference')) then raise exception 'alias_raw_payload_denied';end if;
   end loop;
   call:=calls->(n-1)||p_payload||jsonb_build_object('finishedAt',clock_timestamp());
   v:=jsonb_set(v,array['calls',(n-1)::text],call);
   if n=1 then v:=jsonb_set(v,'{schemaVerification}',to_jsonb(case when p_payload->>'schema'='PASS' then 'PASS' else 'FAIL' end));end if;
   if p_payload->>'outcome' in ('SCHEMA_FAIL','ERROR') then v:=v||jsonb_build_object('status','failed','completedAt',clock_timestamp());end if;
  elsif p_action='complete' then
   if n<>4 or v->>'schemaVerification'<>'PASS' or exists(select 1 from jsonb_array_elements(calls) c where c->>'outcome' not in ('SUCCESS','INELIGIBLE')) then raise exception 'alias_incomplete';end if;
   v:=v||jsonb_build_object('status','completed','completedAt',clock_timestamp());
  else v:=v||jsonb_build_object('status','failed','completedAt',clock_timestamp(),'errorCode','alias_execution_stopped_no_retry');
  end if;
 else raise exception 'alias_action_denied';end if;
 update public.commercial_structured_run_state set summary=jsonb_set(summary,'{alias_v3a}',v) where run_id=s.run_id;
 return jsonb_build_object('replay',false,'status',v->>'status','inputs',case when p_action='start' then v->'inputs' else null end);
end $$;
revoke all on function public.commercial_sirene_alias_v3a_control(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commercial_sirene_alias_v3a_control(uuid,text,uuid,jsonb) to service_role;
commit;
