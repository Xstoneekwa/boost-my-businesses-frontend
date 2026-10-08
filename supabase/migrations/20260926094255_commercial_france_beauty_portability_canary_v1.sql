-- Extend the existing market configuration and pipeline. No SA rows are updated.
-- Version matches the canonical production migration history.
begin;
alter table public.commercial_discovery_runs drop constraint commercial_discovery_runs_market_v1_check;
alter table public.commercial_discovery_runs add constraint commercial_discovery_runs_market_v1_check
 check ((country_code='ZA' and city in ('Johannesburg','Cape Town')) or (country_code='FR' and city='France' and max_prospects=30 and subsegment is null and force_rescore=false));
create unique index commercial_france_one_portability_canary_v1 on public.commercial_discovery_runs(country_code) where country_code='FR';
insert into public.commercial_campaigns(campaign_code,name,country_code,city_scope,geography,vertical,status,created_by,updated_by,metadata_safe)
select 'BMB_FR_BEAUTY_PORTABILITY_V1','France Beauty Portability Canary V1','FR','{}'::text[],
'{"country":"France","language":"fr","timezone":"Europe/Paris","runtime_scope":"nationwide_canary_v1","offer":"Instagram Growth"}'::jsonb,
'Beauty/Aesthetics','active',created_by,updated_by,
'{"discovery_provider":"searchapi","max_prospects_per_run":30,"max_runs":1,"auto_approval":false,"auto_outreach":false,"human_review_sample_ids":[]}'::jsonb
from public.commercial_campaigns where campaign_code='BMB_ZA_BEAUTY_V1'
on conflict(campaign_code) do nothing;
create or replace function public.create_commercial_discovery_run_v1(
  p_actor_user_id uuid,
  p_city text,
  p_subsegment text,
  p_max_prospects integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_city text := btrim(coalesce(p_city, ''));
  v_subsegment text := nullif(btrim(coalesce(p_subsegment, '')), '');
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_campaign_id uuid;
  v_run public.commercial_discovery_runs%rowtype;
  v_inserted_count integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if not public.commercial_crm_actor_authorized_v1(p_actor_user_id) then
    raise exception 'commercial_crm_owner_access_required' using errcode = '42501';
  end if;
  if v_city not in ('Johannesburg', 'Cape Town', 'France') then
    raise exception 'commercial_discovery_city_not_allowed' using errcode = '22023';
  end if;
  if v_subsegment is not null and v_subsegment not in (
    'Aesthetic Clinic', 'Skin Clinic', 'Med Spa', 'Beauty Salon', 'Hair Salon',
    'Hair Stylist', 'Nail Studio', 'Lash Studio', 'Brow Studio', 'Laser Clinic',
    'Makeup Artist', 'Wellness Studio'
  ) then
    raise exception 'commercial_discovery_subsegment_not_allowed' using errcode = '22023';
  end if;
  if p_max_prospects is null or p_max_prospects not between 1 and 30 then
    raise exception 'commercial_discovery_max_prospects_invalid' using errcode = '22023';
  end if;
  if char_length(v_idempotency_key) not between 1 and 200 then
    raise exception 'commercial_discovery_idempotency_key_invalid' using errcode = '22023';
  end if;

  select id into v_campaign_id
  from public.commercial_campaigns
  where campaign_code = case when v_city='France' then 'BMB_FR_BEAUTY_PORTABILITY_V1' else 'BMB_ZA_BEAUTY_V1' end;
  if v_campaign_id is null then
    raise exception 'commercial_discovery_campaign_missing' using errcode = 'P0002';
  end if;

  if v_city='France' then
    if p_max_prospects<>30 or v_subsegment is not null or v_idempotency_key<>'commercial-france-beauty-portability-canary-v1' then raise exception 'commercial_france_canary_scope_invalid'; end if;
    perform pg_advisory_xact_lock(hashtext('commercial-france-beauty-portability-canary-v1'));
    select * into v_run from public.commercial_discovery_runs where country_code='FR';
    if found then return jsonb_build_object('id',v_run.id,'status',v_run.status,'city',v_run.city,'max_prospects',v_run.max_prospects,'idempotent_replay',true); end if;
  end if;
  insert into public.commercial_discovery_runs (
    campaign_id, requested_by, provider, country_code, city, subsegment,
    max_prospects, status, idempotency_key
  ) values (
    v_campaign_id, p_actor_user_id, 'searchapi', case when v_city='France' then 'FR' else 'ZA' end, v_city, v_subsegment,
    p_max_prospects, 'queued', v_idempotency_key
  )
  on conflict (requested_by, idempotency_key) do nothing;
  get diagnostics v_inserted_count = row_count;

  select * into v_run
  from public.commercial_discovery_runs
  where requested_by = p_actor_user_id and idempotency_key = v_idempotency_key;

  return jsonb_build_object(
    'id', v_run.id,
    'status', v_run.status,
    'city', v_run.city,
    'subsegment', v_run.subsegment,
    'max_prospects', v_run.max_prospects,
    'idempotent_replay', v_inserted_count = 0
  );
end
$$;


create or replace function public.create_commercial_discovery_run_v2(
  p_actor_user_id uuid, p_city text, p_subsegment text, p_max_prospects integer,
  p_idempotency_key text, p_force_rescore boolean default false
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb; v_run_id uuid;
begin
  if p_city='France' and p_force_rescore then raise exception 'commercial_france_rescore_forbidden';end if;
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  if p_force_rescore and not public.commercial_crm_actor_authorized_v1(p_actor_user_id) then raise exception 'commercial_crm_owner_access_required' using errcode = '42501'; end if;
  v_result := public.create_commercial_discovery_run_v1(p_actor_user_id, p_city, p_subsegment, p_max_prospects, p_idempotency_key);
  v_run_id := (v_result->>'id')::uuid;
  update public.commercial_discovery_runs set force_rescore = coalesce(p_force_rescore, false) where id = v_run_id and status = 'queued';
  return v_result || jsonb_build_object('force_rescore', coalesce(p_force_rescore, false));
end $$;


create or replace function public.ingest_commercial_discovery_candidate_v2(p_item_id uuid, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_item public.commercial_discovery_items%rowtype; v_run public.commercial_discovery_runs%rowtype;
  v_business_id uuid; v_lead_id uuid; v_existing public.commercial_leads%rowtype; v_domain text;
  v_handle text := lower(regexp_replace(coalesce(p_payload->>'instagram_handle',''), '^@+', ''));
  v_score numeric := nullif(p_payload->>'lead_score','')::numeric; v_score_percent integer := nullif(p_payload->>'score_percent','')::integer;
  v_qualification text := p_payload->>'qualification_status'; v_item_status text := p_payload->>'item_status';
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'commercial_discovery_payload_invalid' using errcode = '22023'; end if;
  select * into v_item from public.commercial_discovery_items where id = p_item_id for update;
  if not found then raise exception 'commercial_discovery_item_not_found' using errcode = 'P0002'; end if;
  select * into v_run from public.commercial_discovery_runs where id = v_item.run_id for update;
  if v_run.status <> 'running' or v_run.cancel_requested_at is not null then raise exception 'commercial_discovery_run_not_running' using errcode = '22023'; end if;
  if v_item.status in ('completed','rejected','duplicate','possible_duplicate','excluded_client','failed','cancelled') then
    return jsonb_build_object('ok',true,'idempotent_replay',true,'status',v_item.status,'business_id',v_item.business_id,'lead_id',v_item.lead_id);
  end if;
  if p_payload->>'provider' <> v_item.provider or lower(p_payload->>'provider_external_id') <> lower(v_item.provider_external_id)
     or p_payload->>'country_code' is distinct from v_run.country_code or (v_run.country_code='ZA' and p_payload->>'city' is distinct from v_run.city) or (v_run.country_code='FR' and (v_item.location_country is distinct from 'FR' or v_item.location_city is null or p_payload->>'city' is distinct from v_item.location_city or v_item.precheck_decision is distinct from 'PRECHECK_PASS')) or p_payload->>'vertical' <> 'Beauty/Aesthetics'
     or v_handle = '' or btrim(coalesce(p_payload->>'business_name','')) = '' then raise exception 'commercial_discovery_identity_invalid' using errcode = '22023'; end if;
  if v_score is null or v_score not between 0 and 10 or v_score_percent not between 0 and 100 or p_payload->>'score_priority' not in ('P1','P2','P3')
     or v_qualification not in ('qualified','enriched','not_qualified') or v_item_status not in ('created','hard_rejected') then raise exception 'commercial_discovery_score_invalid' using errcode = '22023'; end if;
  if exists (select 1 from public.client_instagram_accounts cia join public.clients c on c.id=cia.client_id join public.ig_accounts ia on ia.id=cia.account_id
    where cia.active and c.status not in ('inactive','archived') and lower(regexp_replace(coalesce(ia.username,''),'^@+',''))=v_handle) then
    update public.commercial_discovery_items set status='excluded_client',stage='REJECTED',duplicate_reason='existing_bmb_client',completed_at=now(),locked_at=null,locked_by=null where id=p_item_id;
    return jsonb_build_object('ok',true,'status','excluded_client');
  end if;
  select business_id into v_business_id from public.commercial_business_identifiers where provider=v_item.provider and external_id=lower(v_item.provider_external_id);
  if v_business_id is null then select id into v_business_id from public.commercial_businesses where instagram_handle_normalized=v_handle limit 1; end if;
  if v_business_id is null and nullif(btrim(p_payload->>'website'),'') is not null then
    v_domain := lower(regexp_replace(p_payload->>'website','^[a-z][a-z0-9+.-]*://','','i')); v_domain := regexp_replace(v_domain,'^www\.','','i'); v_domain := nullif(regexp_replace(v_domain,'[/?:#].*$',''),'');
    select id into v_business_id from public.commercial_businesses where website_domain_normalized=v_domain limit 1;
  end if;
  if v_run.country_code='FR' and v_business_id is not null and exists(select 1 from public.commercial_businesses where id=v_business_id and country_code<>'FR') then
    update public.commercial_discovery_items set status='possible_duplicate',stage='REJECTED',duplicate_reason='cross_market_identity_conflict',completed_at=now(),locked_at=null,locked_by=null where id=p_item_id;
    return jsonb_build_object('ok',true,'status','possible_duplicate');
  end if;
  if v_business_id is not null then select * into v_existing from public.commercial_leads where business_id=v_business_id order by created_at desc limit 1; end if;
  if v_existing.id is not null and not v_run.force_rescore then
    update public.commercial_discovery_items set status='duplicate',stage='REJECTED',duplicate_reason='existing_commercial_lead',business_id=v_business_id,lead_id=v_existing.id,completed_at=now(),locked_at=null,locked_by=null where id=p_item_id;
    return jsonb_build_object('ok',true,'status','duplicate','business_id',v_business_id,'lead_id',v_existing.id);
  end if;
  if v_business_id is null then
    insert into public.commercial_businesses (business_name,country_code,city,vertical,subsegment,website,instagram_handle,email,phone,address_safe,source,business_description,booking_url,booking_provider,booking_evidence,business_status,location_confidence,location_evidence_safe,enrichment_snapshot_safe,enrichment_provenance_safe,last_enriched_at,metadata_safe)
    values (btrim(p_payload->>'business_name'),v_run.country_code,p_payload->>'city','Beauty/Aesthetics',nullif(btrim(p_payload->>'subsegment'),''),nullif(btrim(p_payload->>'website'),''),v_handle,nullif(lower(btrim(p_payload->>'email')),''),nullif(btrim(p_payload->>'phone'),''),nullif(btrim(p_payload->>'address_safe'),''),v_item.provider,nullif(btrim(p_payload->>'business_description'),''),nullif(btrim(p_payload->>'booking_url'),''),nullif(btrim(p_payload->>'booking_provider'),''),nullif(btrim(p_payload->>'booking_evidence'),''),coalesce(nullif(p_payload->>'business_status',''),'unknown'),nullif(p_payload->>'location_confidence',''),coalesce(p_payload->'location_evidence','[]'::jsonb),coalesce(p_payload->'enrichment_snapshot_safe','{}'::jsonb),coalesce(p_payload->'enrichment_provenance_safe','{}'::jsonb),now(),jsonb_build_object('discovery_run_id',v_run.id,'provider_external_id',v_item.provider_external_id)) returning id into v_business_id;
  else
    update public.commercial_businesses set website=coalesce(website,nullif(btrim(p_payload->>'website'),'')),booking_url=coalesce(nullif(btrim(p_payload->>'booking_url'),''),booking_url),booking_provider=coalesce(nullif(btrim(p_payload->>'booking_provider'),''),booking_provider),booking_evidence=coalesce(nullif(btrim(p_payload->>'booking_evidence'),''),booking_evidence),location_confidence=coalesce(nullif(p_payload->>'location_confidence',''),location_confidence),location_evidence_safe=coalesce(p_payload->'location_evidence',location_evidence_safe),enrichment_snapshot_safe=enrichment_snapshot_safe||coalesce(p_payload->'enrichment_snapshot_safe','{}'::jsonb),last_enriched_at=now() where id=v_business_id;
  end if;
  insert into public.commercial_business_identifiers(business_id,provider,external_id,source_url,metadata_safe) values(v_business_id,v_item.provider,lower(v_item.provider_external_id),v_item.source_url,jsonb_build_object('discovery_run_id',v_run.id))
    on conflict(provider,external_id) do update set last_observed_at=now(),source_url=coalesce(excluded.source_url,public.commercial_business_identifiers.source_url);
  if v_existing.id is not null and v_run.force_rescore then
    update public.commercial_leads set qualification_status=v_qualification,score=v_score_percent,priority=p_payload->>'priority',score_priority=p_payload->>'score_priority',lead_score=v_score,scoring_model_version=p_payload->>'scoring_model_version',score_breakdown_safe=coalesce(p_payload->'score_breakdown_safe','{}'::jsonb),ai_confidence=nullif(p_payload->>'ai_confidence','')::numeric,ai_model=p_payload->>'ai_model',ai_prompt_version=p_payload->>'ai_prompt_version',scored_at=now(),needs_manual_review=coalesce((p_payload->>'needs_manual_review')::boolean,false),hard_gate_codes=coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'hard_gate_codes','[]'::jsonb))),'{}'::text[]),source_snapshot_hash=p_payload->>'source_snapshot_hash' where id=v_existing.id returning id into v_lead_id;
    insert into public.commercial_events(lead_id,event_type,actor_type,idempotency_key,metadata_safe) values(v_lead_id,'lead_scored','automation',left(p_item_id::text||':force-rescore',200),jsonb_build_object('explicit_rescore',true,'previous_score',v_existing.lead_score,'previous_priority',v_existing.score_priority,'new_score',v_score,'new_priority',p_payload->>'score_priority'));
  else
    insert into public.commercial_leads(campaign_id,business_id,qualification_status,outreach_status,sales_status,score,priority,city_snapshot,subsegment_snapshot,outreach_channel,message_angle,personalization_context_safe,audience_context_safe,lead_score,score_priority,scoring_model_version,score_breakdown_safe,ai_confidence,ai_model,ai_prompt_version,scored_at,needs_manual_review,hard_gate_codes,source_snapshot_hash)
    values(v_run.campaign_id,v_business_id,v_qualification,'not_started','not_started',v_score_percent,p_payload->>'priority',p_payload->>'city',nullif(btrim(p_payload->>'subsegment'),''),p_payload->>'recommended_channel',p_payload->>'recommended_angle',coalesce(p_payload->'personalization_context_safe','{}'::jsonb),coalesce(p_payload->'audience_context_safe','{}'::jsonb),v_score,p_payload->>'score_priority',p_payload->>'scoring_model_version',coalesce(p_payload->'score_breakdown_safe','{}'::jsonb),nullif(p_payload->>'ai_confidence','')::numeric,p_payload->>'ai_model',p_payload->>'ai_prompt_version',now(),coalesce((p_payload->>'needs_manual_review')::boolean,false),coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'hard_gate_codes','[]'::jsonb))),'{}'::text[]),p_payload->>'source_snapshot_hash') returning id into v_lead_id;
    insert into public.commercial_events(lead_id,event_type,actor_type,idempotency_key,metadata_safe) values
      (v_lead_id,'lead_created','automation',left(p_item_id::text||':created',200),jsonb_build_object('run_id',v_run.id)),
      (v_lead_id,'lead_discovered','automation',left(p_item_id::text||':discovered',200),jsonb_build_object('run_id',v_run.id,'source_url',v_item.source_url)),
      (v_lead_id,'lead_enriched','automation',left(p_item_id::text||':enriched',200),jsonb_build_object('run_id',v_run.id)),
      (v_lead_id,'lead_scored','automation',left(p_item_id::text||':scored',200),jsonb_build_object('run_id',v_run.id,'lead_score',v_score,'score_priority',p_payload->>'score_priority'));
    if v_qualification='qualified' then insert into public.commercial_events(lead_id,event_type,actor_type,idempotency_key,metadata_safe) values(v_lead_id,'lead_qualified','automation',left(p_item_id::text||':qualified',200),jsonb_build_object('run_id',v_run.id,'review_gate','owner_required','auto_approval',false)); end if;
  end if;
  insert into public.commercial_scoring_cache(business_id,enrichment_snapshot_hash,scoring_model_version,prompt_version,ai_model,analysis_snapshot_safe,score_snapshot_safe)
    values(v_business_id,p_payload->>'source_snapshot_hash',p_payload->>'scoring_model_version',p_payload->>'ai_prompt_version',p_payload->>'ai_model',coalesce(p_payload->'analysis_snapshot_safe','{}'::jsonb),jsonb_build_object('lead_score',v_score,'score_priority',p_payload->>'score_priority','breakdown',coalesce(p_payload->'score_breakdown_safe','{}'::jsonb)))
    on conflict(business_id,enrichment_snapshot_hash,scoring_model_version,prompt_version) do update set last_used_at=now();
  update public.commercial_discovery_items set status='completed',stage=case when v_qualification='qualified' then 'QUALIFIED' else 'SCORED' end,business_id=v_business_id,lead_id=v_lead_id,analysis_snapshot_safe=coalesce(p_payload->'analysis_snapshot_safe','{}'::jsonb),duration_ms=greatest(coalesce(nullif(p_payload->>'duration_ms','')::integer,0),0),completed_at=now(),locked_at=null,locked_by=null where id=p_item_id;
  return jsonb_build_object('ok',true,'status','completed','business_id',v_business_id,'lead_id',v_lead_id,'explicit_rescore',v_existing.id is not null and v_run.force_rescore);
end $$;


create or replace function public.refresh_commercial_discovery_run_v2(p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_run public.commercial_discovery_runs%rowtype; v_active integer; v_selected integer;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select count(*) filter (where selected_for_processing), count(*) filter (where selected_for_processing and status in ('pending','processing','retry_scheduled'))
    into v_selected, v_active from public.commercial_discovery_items where run_id = p_run_id;
  update public.commercial_discovery_runs r set
    precheck_rejected_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.precheck_decision = 'PRECHECK_REJECT'),
    enriched_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.enriched_at is not null),
    ai_pending_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.stage in ('ENRICHED','AI_PENDING') and i.status in ('pending','processing','retry_scheduled')),
    scored_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.analysis_snapshot_safe <> '{}'::jsonb),
    created_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.status = 'completed' and i.lead_id is not null),
    duplicate_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.status in ('duplicate','possible_duplicate','excluded_client')),
    hard_rejected_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.status = 'rejected'),
    error_count = (select count(*) from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.status = 'failed'),
    qualified_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and i.selected_for_processing and i.status = 'completed' and l.qualification_status = 'qualified'),
    p1_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and i.selected_for_processing and i.status = 'completed' and l.score_priority = 'P1'),
    p2_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and i.selected_for_processing and i.status = 'completed' and l.score_priority = 'P2'),
    p3_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and i.selected_for_processing and i.status = 'completed' and l.score_priority = 'P3'),
    status = case when r.status = 'cancelled' then r.status when r.discovery_status = 'failed' then 'failed'
      when r.discovery_status = 'completed' and v_selected > 0 and v_active = 0 then
        case when exists (select 1 from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.status = 'failed') then 'completed_with_errors' else 'completed' end
      else 'running' end,
    completed_at = case when r.status <> 'cancelled' and r.discovery_status = 'completed' and v_selected > 0 and v_active = 0 then coalesce(r.completed_at, now()) else r.completed_at end,
    worker_locked_at = null, worker_locked_by = null
  where r.id = p_run_id returning * into v_run;
  if not found then raise exception 'commercial_discovery_run_not_found' using errcode = 'P0002'; end if;
  if v_run.country_code='FR' and v_run.status in ('completed','completed_with_errors') then
    update public.commercial_campaigns c set metadata_safe=c.metadata_safe || jsonb_build_object(
      'human_review_sample_ids',coalesce((select jsonb_agg(id order by score_priority,lead_score desc,id) from (
        select l.id,l.score_priority,l.lead_score,row_number() over(partition by l.score_priority order by l.lead_score desc,l.id) as rank
        from public.commercial_leads l join public.commercial_discovery_items i on i.lead_id=l.id
        where i.run_id=v_run.id and i.status='completed' and l.qualification_status='qualified' and l.score_priority in ('P1','P2')
      ) x where rank<=5),'[]'::jsonb),'human_review_sample_frozen_at',now(),'human_review_run_id',v_run.id)
    where c.id=v_run.campaign_id and not(c.metadata_safe ? 'human_review_sample_frozen_at');
  end if;
  return to_jsonb(v_run);
end $$;
commit;
