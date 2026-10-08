begin;
set local lock_timeout = '5s';

-- No existing row is updated. The default preserves legacy behavior.
alter table public.commercial_businesses add column identity_mode text not null default 'legacy'
  check (identity_mode in ('legacy','structured'));

create unique index commercial_businesses_legacy_domain_uidx
  on public.commercial_businesses(website_domain_normalized)
  where identity_mode='legacy' and website_domain_normalized is not null;
create unique index commercial_businesses_legacy_instagram_uidx
  on public.commercial_businesses(instagram_handle_normalized)
  where identity_mode='legacy' and instagram_handle_normalized is not null;
-- Replacement protections exist before removing the global uniqueness contract.
drop index public.commercial_businesses_website_domain_uidx;
drop index public.commercial_businesses_instagram_handle_uidx;
create index commercial_businesses_structured_domain_idx
  on public.commercial_businesses(website_domain_normalized) where identity_mode='structured';
create index commercial_businesses_structured_instagram_idx
  on public.commercial_businesses(instagram_handle_normalized) where identity_mode='structured';

create table public.commercial_identity_providers (
  provider_key text primary key check (provider_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  country text not null check (country ~ '^[A-Z]{2}$'),
  identity_mode text not null check (identity_mode='structured'),
  external_id_normalizer text not null check (external_id_normalizer in ('siret_exact','opaque_exact')),
  external_id_case_sensitive boolean not null,
  location_authority text not null,
  source_policy jsonb not null check (jsonb_typeof(source_policy)='object')
);
alter table public.commercial_identity_providers enable row level security;
revoke all on public.commercial_identity_providers from public,anon,authenticated,service_role;
grant select on public.commercial_identity_providers to service_role;
insert into public.commercial_identity_providers values
 ('sirene','FR','structured','siret_exact',false,'official_establishment_register',
  '{"discovery_enabled":false,"prospecting_eligibility":"requires_separate_diffusion_gate","phase":"identity_only"}');

create function public.normalize_structured_external_id_v1(p_provider text,p_external_id text)
returns text language plpgsql stable security invoker set search_path='' as $$
declare v_normalizer text; v_id text := btrim(p_external_id);
begin
  select external_id_normalizer into v_normalizer from public.commercial_identity_providers where provider_key=p_provider;
  if not found then raise exception 'structured_provider_unregistered' using errcode='22023'; end if;
  if v_id is null or length(v_id) not between 1 and 200 or v_id ~ '[[:cntrl:]]' then
    raise exception 'structured_external_id_invalid' using errcode='22023'; end if;
  if v_normalizer='siret_exact' and v_id !~ '^[0-9]{14}$' then
    raise exception 'siret_format_invalid' using errcode='22023'; end if;
  return v_id;
end $$;

-- A URL alone cannot prove ownership. Non-platform valid hosts remain UNKNOWN
-- unless a future resolver supplies independent ownership evidence.
create function public.classify_structured_domain_v1(p_url text,p_owned_verified boolean default false)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare v_host text;
begin
  if p_url is null or p_url !~* '^https?://[a-z0-9.-]+(:[0-9]+)?([/?#]|$)' then
    return jsonb_build_object('classification','UNKNOWN_DOMAIN','domain',null); end if;
  v_host := lower(substring(p_url from '(?i)^https?://([^/:?#]+)'));
  v_host := regexp_replace(v_host,'^www\.','');
  if v_host !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$' or v_host like '%..%' then
    return jsonb_build_object('classification','UNKNOWN_DOMAIN','domain',null); end if;
  if v_host ~ '(^|\.)(planity\.com|treatwell\.[a-z.]+|fresha\.com|booksy\.(com|info)|calendly\.com|wa\.me|whatsapp\.com|linktr\.ee|beacons\.ai|bio\.site|setmore\.com|glossgenius\.com|vagaro\.com|tiktok\.com|instagram\.com|facebook\.com|fb\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|pinterest\.[a-z.]+|g\.co|maps\.app\.goo\.gl)$' then
    return jsonb_build_object('classification','SHARED_PLATFORM_DOMAIN','domain',v_host); end if;
  return jsonb_build_object('classification',case when p_owned_verified then 'OWNED_BUSINESS_DOMAIN' else 'UNKNOWN_DOMAIN' end,'domain',v_host);
end $$;

create function public.guard_structured_business_identity_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and new.identity_mode is distinct from old.identity_mode then
    raise exception 'commercial_identity_mode_immutable' using errcode='22023'; end if;
  if new.identity_mode='structured' and
     public.classify_structured_domain_v1(new.website)->>'classification'='SHARED_PLATFORM_DOMAIN' then
    new.website_domain_normalized := null;
  end if;
  return new;
end $$;
-- Runs after commercial_businesses_normalize (Postgres orders same-kind triggers by name).
create trigger commercial_businesses_structured_identity_guard
  before insert or update on public.commercial_businesses for each row
  execute function public.guard_structured_business_identity_v1();

create function public.guard_structured_external_identity_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_mode text; v_country text;
begin
  select identity_mode,country_code into v_mode,v_country from public.commercial_businesses where id=new.business_id;
  if tg_op='UPDATE' and (old.business_id is distinct from new.business_id or old.provider is distinct from new.provider or old.external_id is distinct from new.external_id)
    and (v_mode='structured' or exists(select 1 from public.commercial_businesses where id=old.business_id and identity_mode='structured')) then
    raise exception 'structured_identity_immutable' using errcode='22023'; end if;
  if v_mode='structured' then
    if new.external_id is distinct from public.normalize_structured_external_id_v1(new.provider,new.external_id) then
      raise exception 'structured_identity_not_canonical' using errcode='22023'; end if;
    if not exists(select 1 from public.commercial_identity_providers where provider_key=new.provider and country=v_country) then
      raise exception 'structured_provider_country_mismatch' using errcode='22023'; end if;
  elsif exists(select 1 from public.commercial_identity_providers where provider_key=new.provider) then
    raise exception 'structured_provider_requires_structured_business' using errcode='22023';
  end if;
  return new;
end $$;
create trigger commercial_identifiers_structured_guard before insert or update
  on public.commercial_business_identifiers for each row execute function public.guard_structured_external_identity_v1();

create function public.preflight_structured_commercial_business_v1(
 p_actor_user_id uuid,p_provider text,p_external_id text,p_website text default null,
 p_instagram_handle text default null,p_business_name text default null,p_address text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_id text; v_business uuid; v_mode text; v_matches jsonb; v_strong boolean;
 v_domain text := public.classify_structured_domain_v1(p_website)->>'domain';
 v_handle text := nullif(lower(regexp_replace(btrim(coalesce(p_instagram_handle,'')),'^@+','')),'');
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' or not public.commercial_crm_actor_authorized_v1(p_actor_user_id) then
   raise exception 'commercial_owner_required' using errcode='42501'; end if;
 v_id := public.normalize_structured_external_id_v1(p_provider,p_external_id);
 select i.business_id,b.identity_mode into v_business,v_mode from public.commercial_business_identifiers i
 join public.commercial_businesses b on b.id=i.business_id where i.provider=p_provider and i.external_id=v_id;
 if found then
   if v_mode<>'structured' then raise exception 'structured_identity_mode_conflict' using errcode='22023'; end if;
   return jsonb_build_object('match','EXACT_PROVIDER_MATCH','business_id',v_business,'auto_attach',true);
 end if;
 -- Similarity is review evidence ONLY. Distinct IDs from the same provider
 -- already identify separate establishments and are not cross-provider matches.
 select coalesce(jsonb_agg(x.id),'[]'),coalesce(bool_or(x.strong),false) into v_matches,v_strong from (
   select b.id,(nullif(btrim(p_address),'') is not null and lower(btrim(b.address_safe))=lower(btrim(p_address))
     and lower(b.business_name)=lower(btrim(p_business_name))) as strong
   from public.commercial_businesses b
   where not exists(select 1 from public.commercial_business_identifiers i where i.business_id=b.id and i.provider=p_provider)
    and ((v_domain is not null and public.classify_structured_domain_v1(p_website)->>'classification'<>'SHARED_PLATFORM_DOMAIN' and b.website_domain_normalized=v_domain)
      or (v_handle is not null and b.instagram_handle_normalized=v_handle)
      or (nullif(btrim(p_business_name),'') is not null and lower(b.business_name)=lower(btrim(p_business_name))))
   order by b.id limit 21
 ) x;
 return jsonb_build_object('match',case when jsonb_array_length(v_matches)=0 then 'NO_MATCH'
   when v_strong then 'STRONG_CROSS_PROVIDER_MATCH_CANDIDATE' else 'AMBIGUOUS' end,
   'candidate_business_ids',v_matches,'auto_attach',false,'review_required',jsonb_array_length(v_matches)>0);
end $$;

create function public.create_structured_commercial_business_v1(
 p_actor_user_id uuid,p_provider text,p_external_id text,p_business_name text,p_country text,
 p_city text default null,p_address text default null,p_website text default null,p_instagram_handle text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_id text; v_preflight jsonb; v_business uuid;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' or not public.commercial_crm_actor_authorized_v1(p_actor_user_id) then
   raise exception 'commercial_owner_required' using errcode='42501'; end if;
 v_id := public.normalize_structured_external_id_v1(p_provider,p_external_id);
 if nullif(btrim(p_business_name),'') is null or not exists(select 1 from public.commercial_identity_providers where provider_key=p_provider and country=p_country) then
   raise exception 'structured_candidate_invalid' using errcode='22023'; end if;
 -- Serialize exact identity only; different establishments remain independent.
 perform pg_advisory_xact_lock(hashtextextended(p_provider||':'||v_id,914));
 v_preflight := public.preflight_structured_commercial_business_v1(p_actor_user_id,p_provider,v_id,p_website,p_instagram_handle,p_business_name,p_address);
 if v_preflight->>'match'='EXACT_PROVIDER_MATCH' then return v_preflight||jsonb_build_object('created',false); end if;
 if v_preflight->>'match'<>'NO_MATCH' then return v_preflight||jsonb_build_object('created',false,'status','review_hold'); end if;
 insert into public.commercial_businesses(business_name,country_code,city,vertical,address_safe,website,instagram_handle,source,identity_mode)
 values(btrim(p_business_name),p_country,p_city,'Beauty/Aesthetics',p_address,p_website,
   nullif(lower(regexp_replace(btrim(coalesce(p_instagram_handle,'')),'^@+','')),''),p_provider,'structured') returning id into v_business;
 insert into public.commercial_business_identifiers(business_id,provider,external_id) values(v_business,p_provider,v_id);
 return jsonb_build_object('match','NO_MATCH','business_id',v_business,'created',true,'auto_attach',false);
end $$;

revoke all on function public.normalize_structured_external_id_v1(text,text),
 public.classify_structured_domain_v1(text,boolean),public.guard_structured_business_identity_v1(),
 public.guard_structured_external_identity_v1(),
 public.preflight_structured_commercial_business_v1(uuid,text,text,text,text,text,text),
 public.create_structured_commercial_business_v1(uuid,text,text,text,text,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.normalize_structured_external_id_v1(text,text),
 public.classify_structured_domain_v1(text,boolean),public.guard_structured_business_identity_v1(),
 public.guard_structured_external_identity_v1(),
 public.preflight_structured_commercial_business_v1(uuid,text,text,text,text,text,text),
 public.create_structured_commercial_business_v1(uuid,text,text,text,text,text,text,text,text)
 to service_role;

-- Legacy reader definitions are appended below before COMMIT.
CREATE OR REPLACE FUNCTION public.ingest_commercial_discovery_candidate_v1(p_run_id uuid, p_payload jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_run public.commercial_discovery_runs%rowtype;
  v_item public.commercial_discovery_items%rowtype;
  v_business_id uuid;
  v_lead_id uuid;
  v_existing_lead public.commercial_leads%rowtype;
  v_provider text := btrim(coalesce(p_payload->>'provider', ''));
  v_external_id text := lower(btrim(coalesce(p_payload->>'provider_external_id', '')));
  v_business_name text := btrim(coalesce(p_payload->>'business_name', ''));
  v_instagram_handle text := lower(regexp_replace(coalesce(p_payload->>'instagram_handle', ''), '^@+', ''));
  v_website text := nullif(btrim(p_payload->>'website'), '');
  v_website_domain text;
  v_qualification text := btrim(coalesce(p_payload->>'qualification_status', ''));
  v_item_status text := btrim(coalesce(p_payload->>'item_status', 'created'));
  v_score numeric := nullif(p_payload->>'lead_score', '')::numeric;
  v_score_percent integer := nullif(p_payload->>'score_percent', '')::integer;
  v_priority text := btrim(coalesce(p_payload->>'priority', 'normal'));
  v_score_priority text := btrim(coalesce(p_payload->>'score_priority', 'P3'));
  v_event_prefix text := left(btrim(coalesce(p_idempotency_key, '')), 150);
  v_is_client boolean := false;
  v_possible_duplicate_id uuid;
begin
  if exists(select 1 from public.commercial_identity_providers where provider_key=p_payload->>'provider') then
    raise exception 'structured_provider_requires_structured_path' using errcode='22023';
  end if;
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'commercial_discovery_payload_invalid' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 1 and 200 then
    raise exception 'commercial_discovery_idempotency_key_invalid' using errcode = '22023';
  end if;
  select * into v_run from public.commercial_discovery_runs where id = p_run_id for update;
  if not found then raise exception 'commercial_discovery_run_not_found' using errcode = 'P0002'; end if;
  if v_run.status <> 'running' then raise exception 'commercial_discovery_run_not_running' using errcode = '22023'; end if;

  select * into v_item
  from public.commercial_discovery_items
  where run_id = p_run_id and idempotency_key = btrim(p_idempotency_key);
  if found then
    return jsonb_build_object('ok', true, 'idempotent_replay', true, 'item_id', v_item.id,
      'status', v_item.status, 'business_id', v_item.business_id, 'lead_id', v_item.lead_id);
  end if;

  if v_provider <> v_run.provider or char_length(v_external_id) not between 1 and 200 then
    raise exception 'commercial_discovery_provider_identity_invalid' using errcode = '22023';
  end if;
  if v_business_name = '' or v_instagram_handle = '' then
    raise exception 'commercial_discovery_business_identity_invalid' using errcode = '22023';
  end if;
  if p_payload->>'country_code' <> 'ZA' or p_payload->>'city' <> v_run.city
     or p_payload->>'vertical' <> 'Beauty/Aesthetics' then
    raise exception 'commercial_discovery_market_scope_violation' using errcode = '22023';
  end if;
  if v_qualification not in ('qualified', 'enriched', 'not_qualified') then
    raise exception 'commercial_discovery_qualification_invalid' using errcode = '22023';
  end if;
  if v_item_status not in ('created', 'hard_rejected') then
    raise exception 'commercial_discovery_item_status_invalid' using errcode = '22023';
  end if;
  if v_score is null or v_score not between 0 and 10 or v_score_percent not between 0 and 100
     or v_score_priority not in ('P1', 'P2', 'P3') then
    raise exception 'commercial_discovery_score_invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_payload->'source_snapshot_safe', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_payload->'enrichment_snapshot_safe', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_payload->'enrichment_provenance_safe', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_payload->'analysis_snapshot_safe', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_payload->'score_breakdown_safe', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_payload->'personalization_context_safe', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_payload->'audience_context_safe', '{}'::jsonb)) <> 'object' then
    raise exception 'commercial_discovery_json_contract_invalid' using errcode = '22023';
  end if;

  insert into public.commercial_discovery_items (
    run_id, provider, provider_external_id, source_url, source_query, status,
    idempotency_key, source_snapshot_safe, enrichment_snapshot_safe, analysis_snapshot_safe
  ) values (
    p_run_id, v_provider, v_external_id, nullif(btrim(p_payload->>'source_url'), ''),
    nullif(btrim(p_payload->>'source_query'), ''), 'processing', btrim(p_idempotency_key),
    coalesce(p_payload->'source_snapshot_safe', '{}'::jsonb),
    coalesce(p_payload->'enrichment_snapshot_safe', '{}'::jsonb),
    coalesce(p_payload->'analysis_snapshot_safe', '{}'::jsonb)
  ) returning * into v_item;

  select exists (
    select 1
    from public.client_instagram_accounts cia
    join public.clients cl on cl.id = cia.client_id
    join public.ig_accounts ia on ia.id = cia.account_id
    where cia.active and lower(regexp_replace(coalesce(ia.username, ''), '^@+', '')) = v_instagram_handle
      and cl.status not in ('inactive', 'archived')
  ) into v_is_client;
  if v_is_client then
    update public.commercial_discovery_items set status = 'excluded_client', duplicate_reason = 'existing_bmb_client'
    where id = v_item.id;
    return jsonb_build_object('ok', true, 'status', 'excluded_client', 'item_id', v_item.id);
  end if;

  if v_website is not null then
    v_website_domain := lower(regexp_replace(v_website, '^[a-z][a-z0-9+.-]*://', '', 'i'));
    v_website_domain := regexp_replace(v_website_domain, '^www\.', '', 'i');
    v_website_domain := nullif(regexp_replace(v_website_domain, '[/?:#].*$', ''), '');
  end if;

  select business_id into v_business_id
  from public.commercial_business_identifiers
  where provider = v_provider and external_id = v_external_id;
  if v_business_id is null then
    select id into v_business_id from public.commercial_businesses
    where identity_mode = 'legacy' and instagram_handle_normalized = v_instagram_handle limit 1;
  end if;
  if v_business_id is null and v_website_domain is not null then
    select id into v_business_id from public.commercial_businesses
    where identity_mode = 'legacy' and website_domain_normalized = v_website_domain limit 1;
  end if;
  if v_business_id is null then
    select id into v_business_id from public.commercial_businesses
    where regexp_replace(lower(business_name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(v_business_name), '[^a-z0-9]', '', 'g')
      and country_code = 'ZA' and city = v_run.city limit 1;
  end if;

  -- Conservative ambiguity gate: a close same-city name with conflicting exact
  -- identifiers is never silently merged or proposed to Liam.
  if v_business_id is null then
    select id into v_possible_duplicate_id
    from public.commercial_businesses
    where country_code = 'ZA'
      and city = v_run.city
      and char_length(regexp_replace(lower(v_business_name), '[^a-z0-9]', '', 'g')) >= 12
      and left(regexp_replace(lower(business_name), '[^a-z0-9]', '', 'g'), 12)
        = left(regexp_replace(lower(v_business_name), '[^a-z0-9]', '', 'g'), 12)
    order by created_at, id
    limit 1;
    if v_possible_duplicate_id is not null then
      update public.commercial_discovery_items
      set status = 'possible_duplicate', duplicate_reason = 'ambiguous_business_identity', business_id = v_possible_duplicate_id
      where id = v_item.id;
      return jsonb_build_object('ok', true, 'status', 'possible_duplicate', 'item_id', v_item.id,
        'business_id', v_possible_duplicate_id);
    end if;
  end if;

  if v_business_id is not null and exists (
    select 1 from public.commercial_conversions where business_id = v_business_id
  ) then
    update public.commercial_discovery_items set status = 'excluded_client', duplicate_reason = 'converted_commercial_client', business_id = v_business_id
    where id = v_item.id;
    return jsonb_build_object('ok', true, 'status', 'excluded_client', 'item_id', v_item.id, 'business_id', v_business_id);
  end if;

  if v_business_id is not null then
    select * into v_existing_lead from public.commercial_leads
    where business_id = v_business_id order by created_at desc limit 1;
    if found then
      update public.commercial_discovery_items
      set status = 'duplicate', duplicate_reason = 'existing_commercial_lead', business_id = v_business_id, lead_id = v_existing_lead.id
      where id = v_item.id;
      return jsonb_build_object('ok', true, 'status', 'duplicate', 'item_id', v_item.id,
        'business_id', v_business_id, 'lead_id', v_existing_lead.id,
        'existing_qualification_status', v_existing_lead.qualification_status);
    end if;
  end if;

  if v_business_id is null then
    insert into public.commercial_businesses (
      business_name, country_code, city, vertical, subsegment, website, instagram_handle,
      email, phone, address_safe, source, business_description, booking_url, business_status,
      enrichment_snapshot_safe, enrichment_provenance_safe, last_enriched_at, metadata_safe
    ) values (
      v_business_name, 'ZA', v_run.city, 'Beauty/Aesthetics', nullif(btrim(p_payload->>'subsegment'), ''),
      v_website, v_instagram_handle, nullif(lower(btrim(p_payload->>'email')), ''),
      nullif(btrim(p_payload->>'phone'), ''), nullif(btrim(p_payload->>'address_safe'), ''),
      v_provider, nullif(btrim(p_payload->>'business_description'), ''),
      nullif(btrim(p_payload->>'booking_url'), ''), coalesce(nullif(p_payload->>'business_status', ''), 'unknown'),
      coalesce(p_payload->'enrichment_snapshot_safe', '{}'::jsonb),
      coalesce(p_payload->'enrichment_provenance_safe', '{}'::jsonb), now(),
      jsonb_build_object('discovery_run_id', p_run_id, 'provider_external_id', v_external_id)
    ) returning id into v_business_id;
  else
    update public.commercial_businesses
    set website = coalesce(website, v_website),
        instagram_handle = coalesce(instagram_handle, v_instagram_handle),
        business_description = coalesce(nullif(btrim(p_payload->>'business_description'), ''), business_description),
        booking_url = coalesce(nullif(btrim(p_payload->>'booking_url'), ''), booking_url),
        enrichment_snapshot_safe = enrichment_snapshot_safe || coalesce(p_payload->'enrichment_snapshot_safe', '{}'::jsonb),
        enrichment_provenance_safe = enrichment_provenance_safe || coalesce(p_payload->'enrichment_provenance_safe', '{}'::jsonb),
        last_enriched_at = now()
    where id = v_business_id;
  end if;

  insert into public.commercial_business_identifiers (business_id, provider, external_id, source_url, metadata_safe)
  values (v_business_id, v_provider, v_external_id, nullif(btrim(p_payload->>'source_url'), ''),
    jsonb_build_object('discovery_run_id', p_run_id))
  on conflict (provider, external_id) do update
    set last_observed_at = now(), source_url = coalesce(excluded.source_url, public.commercial_business_identifiers.source_url);

  insert into public.commercial_leads (
    campaign_id, business_id, qualification_status, outreach_status, sales_status,
    score, priority, city_snapshot, subsegment_snapshot, outreach_channel, message_angle,
    personalization_context_safe, audience_context_safe, lead_score, score_priority,
    scoring_model_version, score_breakdown_safe, ai_confidence, ai_model,
    ai_prompt_version, scored_at, needs_manual_review, hard_gate_codes, source_snapshot_hash
  ) values (
    v_run.campaign_id, v_business_id, v_qualification, 'not_started', 'not_started',
    v_score_percent, v_priority, v_run.city, nullif(btrim(p_payload->>'subsegment'), ''),
    nullif(p_payload->>'recommended_channel', ''), nullif(p_payload->>'recommended_angle', ''),
    coalesce(p_payload->'personalization_context_safe', '{}'::jsonb),
    coalesce(p_payload->'audience_context_safe', '{}'::jsonb), v_score, v_score_priority,
    nullif(p_payload->>'scoring_model_version', ''), coalesce(p_payload->'score_breakdown_safe', '{}'::jsonb),
    nullif(p_payload->>'ai_confidence', '')::numeric, nullif(p_payload->>'ai_model', ''),
    nullif(p_payload->>'ai_prompt_version', ''), now(), coalesce((p_payload->>'needs_manual_review')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'hard_gate_codes', '[]'::jsonb))), '{}'::text[]),
    nullif(p_payload->>'source_snapshot_hash', '')
  ) returning id into v_lead_id;

  insert into public.commercial_events (lead_id, event_type, actor_type, actor_auth_user_id, idempotency_key, metadata_safe)
  values
    (v_lead_id, 'lead_created', 'automation', null, v_event_prefix || ':created', jsonb_build_object('run_id', p_run_id, 'provider', v_provider)),
    (v_lead_id, 'lead_discovered', 'automation', null, v_event_prefix || ':discovered', jsonb_build_object('run_id', p_run_id, 'provider', v_provider, 'source_url', p_payload->>'source_url')),
    (v_lead_id, 'lead_enriched', 'automation', null, v_event_prefix || ':enriched', jsonb_build_object('run_id', p_run_id, 'observed_at', now())),
    (v_lead_id, 'lead_scored', 'automation', null, v_event_prefix || ':scored', jsonb_build_object('run_id', p_run_id, 'lead_score', v_score, 'score_priority', v_score_priority, 'scoring_model_version', p_payload->>'scoring_model_version'));
  if v_qualification = 'qualified' then
    insert into public.commercial_events (lead_id, event_type, actor_type, actor_auth_user_id, idempotency_key, metadata_safe)
    values (v_lead_id, 'lead_qualified', 'automation', null, v_event_prefix || ':qualified',
      jsonb_build_object('run_id', p_run_id, 'review_gate', 'owner_required', 'auto_approval', false));
  end if;

  update public.commercial_discovery_items
  set status = v_item_status, business_id = v_business_id, lead_id = v_lead_id
  where id = v_item.id;

  return jsonb_build_object('ok', true, 'idempotent_replay', false, 'status', v_item_status,
    'item_id', v_item.id, 'business_id', v_business_id, 'lead_id', v_lead_id,
    'qualification_status', v_qualification, 'score_priority', v_score_priority);
end
$function$;


CREATE OR REPLACE FUNCTION public.ingest_commercial_discovery_candidate_v2(p_item_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_item public.commercial_discovery_items%rowtype; v_run public.commercial_discovery_runs%rowtype;
  v_business_id uuid; v_lead_id uuid; v_existing public.commercial_leads%rowtype; v_domain text;
  v_handle text := lower(regexp_replace(coalesce(p_payload->>'instagram_handle',''), '^@+', ''));
  v_score numeric := nullif(p_payload->>'lead_score','')::numeric; v_score_percent integer := nullif(p_payload->>'score_percent','')::integer;
  v_qualification text := p_payload->>'qualification_status'; v_item_status text := p_payload->>'item_status';
begin
  if exists(select 1 from public.commercial_identity_providers where provider_key=p_payload->>'provider') then
    raise exception 'structured_provider_requires_structured_path' using errcode='22023';
  end if;
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
  if v_business_id is null then select id into v_business_id from public.commercial_businesses where identity_mode = 'legacy' and instagram_handle_normalized =v_handle limit 1; end if;
  if v_business_id is null and nullif(btrim(p_payload->>'website'),'') is not null then
    v_domain := lower(regexp_replace(p_payload->>'website','^[a-z][a-z0-9+.-]*://','','i')); v_domain := regexp_replace(v_domain,'^www\.','','i'); v_domain := nullif(regexp_replace(v_domain,'[/?:#].*$',''),'');
    select id into v_business_id from public.commercial_businesses where identity_mode = 'legacy' and website_domain_normalized =v_domain limit 1;
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
end $function$;


CREATE OR REPLACE FUNCTION public.preflight_commercial_discovery_candidate_v1(p_run_id uuid, p_provider text, p_external_id text, p_instagram_handle text, p_website text, p_business_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_run public.commercial_discovery_runs%rowtype;
  v_business_id uuid;
  v_lead_id uuid;
  v_handle text := lower(regexp_replace(coalesce(p_instagram_handle, ''), '^@+', ''));
  v_domain text;
begin
  if exists(select 1 from public.commercial_identity_providers where provider_key=p_provider) then
    raise exception 'structured_provider_requires_structured_path' using errcode='22023';
  end if;
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select * into v_run from public.commercial_discovery_runs where id = p_run_id;
  if not found or v_run.status <> 'running' then raise exception 'commercial_discovery_run_not_running' using errcode = '22023'; end if;
  if btrim(coalesce(p_provider, '')) <> v_run.provider or v_handle = '' then raise exception 'commercial_discovery_preflight_invalid' using errcode = '22023'; end if;

  if exists (
    select 1 from public.client_instagram_accounts cia
    join public.clients cl on cl.id = cia.client_id
    join public.ig_accounts ia on ia.id = cia.account_id
    where cia.active and lower(regexp_replace(coalesce(ia.username, ''), '^@+', '')) = v_handle
      and cl.status not in ('inactive', 'archived')
  ) then return jsonb_build_object('status', 'excluded_client', 'reason', 'existing_bmb_client'); end if;

  select business_id into v_business_id from public.commercial_business_identifiers
  where provider = btrim(p_provider) and external_id = lower(btrim(p_external_id));
  if v_business_id is null then
    select id into v_business_id from public.commercial_businesses
    where identity_mode = 'legacy' and instagram_handle_normalized = v_handle limit 1;
  end if;
  if v_business_id is null then
    v_domain := public.commercial_crm_identity_domain_v2(p_website);
    if v_domain is not null then
      select id into v_business_id from public.commercial_businesses
      where identity_mode = 'legacy' and website_domain_normalized = v_domain limit 1;
    end if;
  end if;

  -- A display name is evidence, not identity. Discovery always has a canonical
  -- Instagram handle, so generic or prefix-equal names must never block a lead.
  if v_business_id is not null then
    if exists (select 1 from public.commercial_conversions where business_id = v_business_id) then
      return jsonb_build_object('status', 'excluded_client', 'reason', 'converted_commercial_client', 'business_id', v_business_id);
    end if;
    select id into v_lead_id from public.commercial_leads where business_id = v_business_id order by created_at desc limit 1;
    if v_lead_id is not null then return jsonb_build_object('status', 'duplicate', 'reason', 'existing_commercial_lead', 'business_id', v_business_id, 'lead_id', v_lead_id); end if;
  end if;
  return jsonb_build_object('status', 'clear', 'business_id', v_business_id);
end
$function$;

commit;
