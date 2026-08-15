begin;

alter table public.commercial_discovery_runs drop constraint commercial_discovery_runs_status_v1_check;
alter table public.commercial_discovery_runs
  add column discovery_status text not null default 'pending',
  add column discovery_attempt_count smallint not null default 0,
  add column discovery_max_attempts smallint not null default 3,
  add column discovered_at timestamptz null,
  add column provider_diagnostic_safe jsonb not null default '{}'::jsonb,
  add column precheck_rejected_count integer not null default 0,
  add column ai_pending_count integer not null default 0,
  add column force_rescore boolean not null default false,
  add column cancel_requested_at timestamptz null,
  add column cancelled_at timestamptz null,
  add column worker_locked_at timestamptz null,
  add column worker_locked_by text null;

update public.commercial_discovery_runs set status = 'completed_with_errors' where status = 'partial';

alter table public.commercial_discovery_runs
  add constraint commercial_discovery_runs_status_v2_check
    check (status in ('queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'partial')),
  add constraint commercial_discovery_runs_discovery_status_v2_check
    check (discovery_status in ('pending', 'processing', 'completed', 'failed')),
  add constraint commercial_discovery_runs_provider_diagnostic_v2_check
    check (jsonb_typeof(provider_diagnostic_safe) = 'object'),
  add constraint commercial_discovery_runs_attempts_v2_check
    check (discovery_attempt_count between 0 and discovery_max_attempts and discovery_max_attempts between 1 and 5);

alter table public.commercial_discovery_items drop constraint commercial_discovery_items_status_v1_check;
alter table public.commercial_discovery_items
  add column stage text not null default 'DISCOVERED',
  add column selected_for_processing boolean not null default true,
  add column candidate_rank integer null,
  add column precheck_decision text null,
  add column precheck_reason text null,
  add column precheck_evidence_safe jsonb not null default '[]'::jsonb,
  add column location_country text null,
  add column location_city text null,
  add column location_confidence text null,
  add column location_confidence_score numeric(4,3) null,
  add column location_evidence_safe jsonb not null default '[]'::jsonb,
  add column website_url text null,
  add column booking_url text null,
  add column booking_provider text null,
  add column booking_evidence text null,
  add column attempt_count smallint not null default 0,
  add column max_attempts smallint not null default 2,
  add column next_attempt_at timestamptz null,
  add column locked_at timestamptz null,
  add column locked_by text null,
  add column started_at timestamptz null,
  add column enriched_at timestamptz null,
  add column completed_at timestamptz null,
  add column duration_ms integer null,
  add column error_detail_safe jsonb not null default '{}'::jsonb;

update public.commercial_discovery_items set
  status = case status when 'created' then 'completed' when 'hard_rejected' then 'rejected' else status end,
  stage = case status when 'created' then 'QUALIFIED' when 'hard_rejected' then 'REJECTED' when 'failed' then 'FAILED' else 'DISCOVERED' end,
  selected_for_processing = true,
  completed_at = case when status in ('created','hard_rejected','failed','duplicate','possible_duplicate','excluded_client') then updated_at else null end;

alter table public.commercial_discovery_items
  add constraint commercial_discovery_items_status_v2_check
    check (status in ('pending', 'processing', 'retry_scheduled', 'completed', 'rejected', 'duplicate', 'possible_duplicate', 'excluded_client', 'failed', 'cancelled', 'not_selected', 'created', 'hard_rejected')),
  add constraint commercial_discovery_items_stage_v2_check
    check (stage in ('DISCOVERED', 'PRECHECKED', 'ENRICHED', 'AI_PENDING', 'SCORED', 'QUALIFIED', 'REJECTED', 'FAILED')),
  add constraint commercial_discovery_items_precheck_v2_check
    check (precheck_decision is null or precheck_decision in ('PRECHECK_PASS', 'PRECHECK_REJECT', 'PRECHECK_AMBIGUOUS')),
  add constraint commercial_discovery_items_location_v2_check
    check ((location_confidence is null or location_confidence in ('HIGH', 'MEDIUM', 'LOW')) and (location_confidence_score is null or location_confidence_score between 0 and 1)),
  add constraint commercial_discovery_items_attempts_v2_check
    check (attempt_count between 0 and max_attempts and max_attempts between 1 and 5),
  add constraint commercial_discovery_items_json_v2_check
    check (jsonb_typeof(precheck_evidence_safe) = 'array' and jsonb_typeof(location_evidence_safe) = 'array' and jsonb_typeof(error_detail_safe) = 'object');

alter table public.commercial_businesses
  add column if not exists booking_provider text null,
  add column if not exists booking_evidence text null,
  add column if not exists location_confidence text null,
  add column if not exists location_evidence_safe jsonb not null default '[]'::jsonb;

create table public.commercial_discovery_audit_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.commercial_discovery_runs(id) on delete cascade,
  item_id uuid null references public.commercial_discovery_items(id) on delete cascade,
  event_type text not null,
  reason_code text null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint commercial_discovery_audit_event_type_v2_check check (event_type in ('precheck_completed', 'precheck_rejected', 'item_retry_scheduled', 'run_cancelled')),
  constraint commercial_discovery_audit_metadata_v2_check check (jsonb_typeof(metadata_safe) = 'object')
);

create table public.commercial_scoring_cache (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.commercial_businesses(id) on delete cascade,
  enrichment_snapshot_hash text not null,
  scoring_model_version text not null,
  prompt_version text not null,
  ai_model text null,
  analysis_snapshot_safe jsonb not null,
  score_snapshot_safe jsonb not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  constraint commercial_scoring_cache_identity_v2_unique unique (business_id, enrichment_snapshot_hash, scoring_model_version, prompt_version),
  constraint commercial_scoring_cache_json_v2_check check (jsonb_typeof(analysis_snapshot_safe) = 'object' and jsonb_typeof(score_snapshot_safe) = 'object')
);

create index commercial_discovery_runs_claim_v2_idx on public.commercial_discovery_runs (discovery_status, worker_locked_at, created_at) where status in ('queued', 'running');
create index commercial_discovery_items_claim_v2_idx on public.commercial_discovery_items (status, next_attempt_at, created_at) where selected_for_processing;
create index commercial_discovery_audit_run_v2_idx on public.commercial_discovery_audit_events (run_id, created_at, id);

alter table public.commercial_discovery_audit_events enable row level security;
alter table public.commercial_discovery_audit_events force row level security;
alter table public.commercial_scoring_cache enable row level security;
alter table public.commercial_scoring_cache force row level security;
create policy commercial_discovery_audit_service_role_v2 on public.commercial_discovery_audit_events for all to service_role using (true) with check (true);
create policy commercial_scoring_cache_service_role_v2 on public.commercial_scoring_cache for all to service_role using (true) with check (true);
revoke all on table public.commercial_discovery_audit_events, public.commercial_scoring_cache from public, anon, authenticated;
grant select, insert, update on table public.commercial_discovery_audit_events, public.commercial_scoring_cache to service_role;

create or replace function public.create_commercial_discovery_run_v2(
  p_actor_user_id uuid, p_city text, p_subsegment text, p_max_prospects integer,
  p_idempotency_key text, p_force_rescore boolean default false
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb; v_run_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  if p_force_rescore and not public.commercial_crm_actor_authorized_v1(p_actor_user_id) then raise exception 'commercial_crm_owner_access_required' using errcode = '42501'; end if;
  v_result := public.create_commercial_discovery_run_v1(p_actor_user_id, p_city, p_subsegment, p_max_prospects, p_idempotency_key);
  v_run_id := (v_result->>'id')::uuid;
  update public.commercial_discovery_runs set force_rescore = coalesce(p_force_rescore, false) where id = v_run_id and status = 'queued';
  return v_result || jsonb_build_object('force_rescore', coalesce(p_force_rescore, false));
end $$;

create or replace function public.claim_commercial_discovery_runs_v2(batch_limit integer, worker_id text)
returns setof public.commercial_discovery_runs language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return query
  with claimable as (
    select r.id from public.commercial_discovery_runs r
    where r.status in ('queued', 'running') and r.discovery_status in ('pending', 'processing')
      and r.discovery_attempt_count < r.discovery_max_attempts
      and (r.discovery_status = 'pending' or r.worker_locked_at < now() - interval '5 minutes')
      and r.cancel_requested_at is null
    order by r.created_at, r.id for update skip locked limit least(greatest(coalesce(batch_limit, 1), 1), 2)
  )
  update public.commercial_discovery_runs r set status = 'running', started_at = coalesce(r.started_at, now()), discovery_status = 'processing',
    discovery_attempt_count = r.discovery_attempt_count + 1, worker_locked_at = now(), worker_locked_by = left(coalesce(worker_id, 'commercial_worker'), 120)
  from claimable c where r.id = c.id returning r.*;
end $$;

create or replace function public.claim_commercial_discovery_items_v2(batch_limit integer, worker_id text)
returns table (
  id uuid, run_id uuid, provider_external_id text, source_url text, source_query text, source_snapshot_safe jsonb,
  status text, stage text, attempt_count smallint, max_attempts smallint, city text, subsegment text, force_rescore boolean
) language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  return query
  with claimable as (
    select i.id from public.commercial_discovery_items i join public.commercial_discovery_runs r on r.id = i.run_id
    where r.status = 'running' and r.discovery_status = 'completed' and r.cancel_requested_at is null
      and i.selected_for_processing and i.attempt_count < i.max_attempts
      and (i.status = 'pending' or (i.status = 'retry_scheduled' and i.next_attempt_at <= now()) or (i.status = 'processing' and i.locked_at < now() - interval '5 minutes'))
    order by i.candidate_rank nulls last, i.created_at, i.id for update of i skip locked
    limit least(greatest(coalesce(batch_limit, 5), 1), 5)
  ), claimed as (
    update public.commercial_discovery_items i set status = 'processing', attempt_count = i.attempt_count + 1,
      started_at = coalesce(i.started_at, now()), locked_at = now(), locked_by = left(coalesce(worker_id, 'commercial_worker'), 120), next_attempt_at = null
    from claimable c where i.id = c.id returning i.*
  )
  select i.id, i.run_id, i.provider_external_id, i.source_url, i.source_query, i.source_snapshot_safe,
    i.status, i.stage, i.attempt_count, i.max_attempts, r.city, r.subsegment, r.force_rescore
  from claimed i join public.commercial_discovery_runs r on r.id = i.run_id;
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
    qualified_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and l.qualification_status = 'qualified'),
    p1_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and l.score_priority = 'P1'),
    p2_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and l.score_priority = 'P2'),
    p3_count = (select count(*) from public.commercial_discovery_items i join public.commercial_leads l on l.id = i.lead_id where i.run_id = r.id and l.score_priority = 'P3'),
    status = case when r.status = 'cancelled' then r.status when r.discovery_status = 'failed' then 'failed'
      when r.discovery_status = 'completed' and v_selected > 0 and v_active = 0 then
        case when exists (select 1 from public.commercial_discovery_items i where i.run_id = r.id and i.selected_for_processing and i.status = 'failed') then 'completed_with_errors' else 'completed' end
      else 'running' end,
    completed_at = case when r.status <> 'cancelled' and r.discovery_status = 'completed' and v_selected > 0 and v_active = 0 then coalesce(r.completed_at, now()) else r.completed_at end,
    worker_locked_at = null, worker_locked_by = null
  where r.id = p_run_id returning * into v_run;
  if not found then raise exception 'commercial_discovery_run_not_found' using errcode = 'P0002'; end if;
  return to_jsonb(v_run);
end $$;

create or replace function public.cancel_commercial_discovery_run_v2(p_run_id uuid, p_actor_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_run public.commercial_discovery_runs%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  if not public.commercial_crm_actor_authorized_v1(p_actor_user_id) then raise exception 'commercial_crm_owner_access_required' using errcode = '42501'; end if;
  update public.commercial_discovery_runs set status = 'cancelled', cancel_requested_at = now(), cancelled_at = now(), completed_at = coalesce(completed_at, now()), worker_locked_at = null, worker_locked_by = null
  where id = p_run_id and status in ('queued','running') returning * into v_run;
  if not found then select * into v_run from public.commercial_discovery_runs where id = p_run_id; end if;
  if v_run.id is null then raise exception 'commercial_discovery_run_not_found' using errcode = 'P0002'; end if;
  update public.commercial_discovery_items set status = 'cancelled', completed_at = now(), locked_at = null, locked_by = null
    where run_id = p_run_id and status in ('pending','processing','retry_scheduled');
  insert into public.commercial_discovery_audit_events(run_id,event_type,reason_code,metadata_safe) values (p_run_id,'run_cancelled','owner_cancelled',jsonb_build_object('actor_user_id',p_actor_user_id));
  return to_jsonb(v_run);
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
     or p_payload->>'country_code' <> 'ZA' or p_payload->>'city' <> v_run.city or p_payload->>'vertical' <> 'Beauty/Aesthetics'
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
  if v_business_id is not null then select * into v_existing from public.commercial_leads where business_id=v_business_id order by created_at desc limit 1; end if;
  if v_existing.id is not null and not v_run.force_rescore then
    update public.commercial_discovery_items set status='duplicate',stage='REJECTED',duplicate_reason='existing_commercial_lead',business_id=v_business_id,lead_id=v_existing.id,completed_at=now(),locked_at=null,locked_by=null where id=p_item_id;
    return jsonb_build_object('ok',true,'status','duplicate','business_id',v_business_id,'lead_id',v_existing.id);
  end if;
  if v_business_id is null then
    insert into public.commercial_businesses (business_name,country_code,city,vertical,subsegment,website,instagram_handle,email,phone,address_safe,source,business_description,booking_url,booking_provider,booking_evidence,business_status,location_confidence,location_evidence_safe,enrichment_snapshot_safe,enrichment_provenance_safe,last_enriched_at,metadata_safe)
    values (btrim(p_payload->>'business_name'),'ZA',v_run.city,'Beauty/Aesthetics',nullif(btrim(p_payload->>'subsegment'),''),nullif(btrim(p_payload->>'website'),''),v_handle,nullif(lower(btrim(p_payload->>'email')),''),nullif(btrim(p_payload->>'phone'),''),nullif(btrim(p_payload->>'address_safe'),''),v_item.provider,nullif(btrim(p_payload->>'business_description'),''),nullif(btrim(p_payload->>'booking_url'),''),nullif(btrim(p_payload->>'booking_provider'),''),nullif(btrim(p_payload->>'booking_evidence'),''),coalesce(nullif(p_payload->>'business_status',''),'unknown'),nullif(p_payload->>'location_confidence',''),coalesce(p_payload->'location_evidence','[]'::jsonb),coalesce(p_payload->'enrichment_snapshot_safe','{}'::jsonb),coalesce(p_payload->'enrichment_provenance_safe','{}'::jsonb),now(),jsonb_build_object('discovery_run_id',v_run.id,'provider_external_id',v_item.provider_external_id)) returning id into v_business_id;
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
    values(v_run.campaign_id,v_business_id,v_qualification,'not_started','not_started',v_score_percent,p_payload->>'priority',v_run.city,nullif(btrim(p_payload->>'subsegment'),''),p_payload->>'recommended_channel',p_payload->>'recommended_angle',coalesce(p_payload->'personalization_context_safe','{}'::jsonb),coalesce(p_payload->'audience_context_safe','{}'::jsonb),v_score,p_payload->>'score_priority',p_payload->>'scoring_model_version',coalesce(p_payload->'score_breakdown_safe','{}'::jsonb),nullif(p_payload->>'ai_confidence','')::numeric,p_payload->>'ai_model',p_payload->>'ai_prompt_version',now(),coalesce((p_payload->>'needs_manual_review')::boolean,false),coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'hard_gate_codes','[]'::jsonb))),'{}'::text[]),p_payload->>'source_snapshot_hash') returning id into v_lead_id;
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

create or replace function public.commercial_discovery_run_read_model_v2(p_limit integer default 10)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'latest', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (
      select r.id,r.city,r.subsegment,r.max_prospects,r.status,r.discovered_count,r.created_count,r.duplicate_count,r.enriched_count,r.scored_count,r.qualified_count,r.p1_count,r.p2_count,r.p3_count,r.hard_rejected_count,r.precheck_rejected_count,r.ai_pending_count,r.error_count,r.started_at,r.completed_at,r.created_at,
        greatest(0,(extract(epoch from (coalesce(r.completed_at,now())-coalesce(r.started_at,r.created_at)))*1000)::bigint) as elapsed_ms
      from public.commercial_discovery_runs r order by r.created_at desc,r.id desc limit least(greatest(coalesce(p_limit,10),1),50)
    ) x),'[]'::jsonb),
    'summary',jsonb_build_object('last_run_at',(select max(created_at) from public.commercial_discovery_runs),'running',(select count(*)::integer from public.commercial_discovery_runs where status in ('queued','running')),'discovered',(select coalesce(sum(discovered_count),0)::integer from public.commercial_discovery_runs),'enriched',(select coalesce(sum(enriched_count),0)::integer from public.commercial_discovery_runs),'scored',(select coalesce(sum(scored_count),0)::integer from public.commercial_discovery_runs),'p1',(select coalesce(sum(p1_count),0)::integer from public.commercial_discovery_runs),'p2',(select coalesce(sum(p2_count),0)::integer from public.commercial_discovery_runs))
  )
$$;

revoke all on function public.create_commercial_discovery_run_v2(uuid,text,text,integer,text,boolean), public.claim_commercial_discovery_runs_v2(integer,text),
  public.claim_commercial_discovery_items_v2(integer,text), public.refresh_commercial_discovery_run_v2(uuid), public.cancel_commercial_discovery_run_v2(uuid,uuid),
  public.ingest_commercial_discovery_candidate_v2(uuid,jsonb), public.commercial_discovery_run_read_model_v2(integer) from public,anon,authenticated;
grant execute on function public.create_commercial_discovery_run_v2(uuid,text,text,integer,text,boolean), public.claim_commercial_discovery_runs_v2(integer,text),
  public.claim_commercial_discovery_items_v2(integer,text), public.refresh_commercial_discovery_run_v2(uuid), public.cancel_commercial_discovery_run_v2(uuid,uuid),
  public.ingest_commercial_discovery_candidate_v2(uuid,jsonb), public.commercial_discovery_run_read_model_v2(integer) to service_role;

comment on table public.commercial_scoring_cache is 'Service-role-only immutable scoring snapshot identity. No browser access.';
comment on function public.claim_commercial_discovery_items_v2(integer,text) is 'Atomic SKIP LOCKED claim for bounded resumable Commercial Discovery batches.';

commit;
