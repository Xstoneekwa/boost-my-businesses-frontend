begin;

-- Commercial Discovery V1 is an isolated founder-tooling data plane.
-- It discovers and qualifies leads but can never approve or queue outreach.

alter table public.commercial_businesses
  add column business_description text null,
  add column booking_url text null,
  add column business_status text not null default 'unknown',
  add column enrichment_snapshot_safe jsonb not null default '{}'::jsonb,
  add column enrichment_provenance_safe jsonb not null default '{}'::jsonb,
  add column last_enriched_at timestamptz null,
  add constraint commercial_businesses_status_v1_check
    check (business_status in ('unknown', 'open', 'closed')),
  add constraint commercial_businesses_enrichment_objects_v1_check
    check (
      jsonb_typeof(enrichment_snapshot_safe) = 'object'
      and jsonb_typeof(enrichment_provenance_safe) = 'object'
    );

alter table public.commercial_leads
  add column lead_score numeric(3,1) null,
  add column score_priority text null,
  add column scoring_model_version text null,
  add column score_breakdown_safe jsonb not null default '{}'::jsonb,
  add column ai_confidence numeric(4,3) null,
  add column ai_model text null,
  add column ai_prompt_version text null,
  add column scored_at timestamptz null,
  add column needs_manual_review boolean not null default false,
  add column hard_gate_codes text[] not null default '{}'::text[],
  add column source_snapshot_hash text null,
  add constraint commercial_leads_lead_score_v1_check
    check (lead_score is null or lead_score between 0.0 and 10.0),
  add constraint commercial_leads_score_priority_v1_check
    check (score_priority is null or score_priority in ('P1', 'P2', 'P3')),
  add constraint commercial_leads_ai_confidence_v1_check
    check (ai_confidence is null or ai_confidence between 0.0 and 1.0),
  add constraint commercial_leads_score_breakdown_v1_check
    check (jsonb_typeof(score_breakdown_safe) = 'object');

create table public.commercial_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.commercial_campaigns(id) on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict,
  provider text not null,
  country_code text not null,
  city text not null,
  subsegment text null,
  max_prospects smallint not null,
  status text not null default 'queued',
  idempotency_key text not null,
  queries_safe jsonb not null default '[]'::jsonb,
  error_summary_safe jsonb not null default '{}'::jsonb,
  discovered_count integer not null default 0,
  created_count integer not null default 0,
  duplicate_count integer not null default 0,
  enriched_count integer not null default 0,
  scored_count integer not null default 0,
  qualified_count integer not null default 0,
  p1_count integer not null default 0,
  p2_count integer not null default 0,
  p3_count integer not null default 0,
  hard_rejected_count integer not null default 0,
  error_count integer not null default 0,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_discovery_runs_provider_v1_check
    check (provider in ('searchapi', 'manual', 'future')),
  constraint commercial_discovery_runs_market_v1_check
    check (country_code = 'ZA' and city in ('Johannesburg', 'Cape Town')),
  constraint commercial_discovery_runs_max_v1_check
    check (max_prospects between 1 and 30),
  constraint commercial_discovery_runs_status_v1_check
    check (status in ('queued', 'running', 'completed', 'partial', 'failed')),
  constraint commercial_discovery_runs_idempotency_v1_check
    check (char_length(btrim(idempotency_key)) between 1 and 200),
  constraint commercial_discovery_runs_json_v1_check
    check (jsonb_typeof(queries_safe) = 'array' and jsonb_typeof(error_summary_safe) = 'object'),
  constraint commercial_discovery_runs_actor_idempotency_v1_unique
    unique (requested_by, idempotency_key)
);

create table public.commercial_discovery_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.commercial_discovery_runs(id) on delete cascade,
  provider text not null,
  provider_external_id text not null,
  source_url text null,
  source_query text null,
  status text not null,
  duplicate_reason text null,
  error_code text null,
  business_id uuid null references public.commercial_businesses(id) on delete restrict,
  lead_id uuid null references public.commercial_leads(id) on delete restrict,
  idempotency_key text not null,
  source_snapshot_safe jsonb not null default '{}'::jsonb,
  enrichment_snapshot_safe jsonb not null default '{}'::jsonb,
  analysis_snapshot_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_discovery_items_status_v1_check
    check (status in ('processing', 'created', 'duplicate', 'possible_duplicate', 'excluded_client', 'hard_rejected', 'failed')),
  constraint commercial_discovery_items_provider_external_v1_check
    check (char_length(btrim(provider)) between 1 and 80 and char_length(btrim(provider_external_id)) between 1 and 200),
  constraint commercial_discovery_items_idempotency_v1_check
    check (char_length(btrim(idempotency_key)) between 1 and 200),
  constraint commercial_discovery_items_json_v1_check
    check (
      jsonb_typeof(source_snapshot_safe) = 'object'
      and jsonb_typeof(enrichment_snapshot_safe) = 'object'
      and jsonb_typeof(analysis_snapshot_safe) = 'object'
    ),
  constraint commercial_discovery_items_run_provider_external_v1_unique
    unique (run_id, provider, provider_external_id),
  constraint commercial_discovery_items_run_idempotency_v1_unique
    unique (run_id, idempotency_key)
);

create table public.commercial_business_identifiers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.commercial_businesses(id) on delete cascade,
  provider text not null,
  external_id text not null,
  source_url text null,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  metadata_safe jsonb not null default '{}'::jsonb,
  constraint commercial_business_identifiers_identity_v1_check
    check (char_length(btrim(provider)) between 1 and 80 and char_length(btrim(external_id)) between 1 and 200),
  constraint commercial_business_identifiers_metadata_v1_check
    check (jsonb_typeof(metadata_safe) = 'object'),
  constraint commercial_business_identifiers_provider_external_v1_unique
    unique (provider, external_id)
);

create index commercial_discovery_runs_status_created_v1_idx
  on public.commercial_discovery_runs (status, created_at desc, id desc);
create index commercial_discovery_runs_campaign_created_v1_idx
  on public.commercial_discovery_runs (campaign_id, created_at desc, id desc);
create index commercial_discovery_items_run_status_v1_idx
  on public.commercial_discovery_items (run_id, status, created_at, id);
create index commercial_discovery_items_business_v1_idx
  on public.commercial_discovery_items (business_id) where business_id is not null;
create index commercial_discovery_items_lead_v1_idx
  on public.commercial_discovery_items (lead_id) where lead_id is not null;
create index commercial_business_identifiers_business_v1_idx
  on public.commercial_business_identifiers (business_id);
create index commercial_leads_scoring_priority_v1_idx
  on public.commercial_leads (score_priority, lead_score desc, created_at desc)
  where scoring_model_version is not null;

create trigger commercial_discovery_runs_touch_updated_at_v1
before update on public.commercial_discovery_runs
for each row execute function public.commercial_crm_touch_updated_at_v1();
create trigger commercial_discovery_items_touch_updated_at_v1
before update on public.commercial_discovery_items
for each row execute function public.commercial_crm_touch_updated_at_v1();

alter table public.commercial_events drop constraint commercial_events_event_type_check;
alter table public.commercial_events add constraint commercial_events_event_type_check
  check (event_type in (
    'lead_created', 'lead_approved', 'lead_rejected', 'lead_review_updated',
    'outreach_queued', 'outreach_contacted', 'outreach_response_received',
    'outreach_no_response', 'outreach_stopped', 'sales_qualified',
    'demo_booked', 'demo_done', 'checkout_sent', 'payment_succeeded',
    'sales_lost', 'onboarding_started', 'client_activated', 'lead_discovered',
    'lead_enriched', 'lead_scored', 'lead_qualified', 'outreach_sent',
    'response_received', 'response_classified', 'sales_handoff',
    'payment_failed', 'lead_lost', 'active_client'
  ));

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
  if v_city not in ('Johannesburg', 'Cape Town') then
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
  where campaign_code = 'BMB_ZA_BEAUTY_V1';
  if v_campaign_id is null then
    raise exception 'commercial_discovery_campaign_missing' using errcode = 'P0002';
  end if;

  insert into public.commercial_discovery_runs (
    campaign_id, requested_by, provider, country_code, city, subsegment,
    max_prospects, status, idempotency_key
  ) values (
    v_campaign_id, p_actor_user_id, 'searchapi', 'ZA', v_city, v_subsegment,
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

create or replace function public.claim_commercial_discovery_run_v1(p_run_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.commercial_discovery_runs%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  update public.commercial_discovery_runs
  set status = 'running', started_at = coalesce(started_at, now())
  where id = p_run_id and status = 'queued'
  returning * into v_run;
  if not found then
    select * into v_run from public.commercial_discovery_runs where id = p_run_id;
  end if;
  if v_run.id is null then raise exception 'commercial_discovery_run_not_found' using errcode = 'P0002'; end if;
  return to_jsonb(v_run);
end
$$;

create or replace function public.preflight_commercial_discovery_candidate_v1(
  p_run_id uuid,
  p_provider text,
  p_external_id text,
  p_instagram_handle text,
  p_website text,
  p_business_name text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_run public.commercial_discovery_runs%rowtype;
  v_business_id uuid;
  v_lead_id uuid;
  v_handle text := lower(regexp_replace(coalesce(p_instagram_handle, ''), '^@+', ''));
  v_domain text;
begin
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
  if v_business_id is null then select id into v_business_id from public.commercial_businesses where instagram_handle_normalized = v_handle limit 1; end if;
  if v_business_id is null and nullif(btrim(coalesce(p_website, '')), '') is not null then
    v_domain := lower(regexp_replace(p_website, '^[a-z][a-z0-9+.-]*://', '', 'i'));
    v_domain := regexp_replace(v_domain, '^www\.', '', 'i');
    v_domain := nullif(regexp_replace(v_domain, '[/?:#].*$', ''), '');
    if v_domain is not null then select id into v_business_id from public.commercial_businesses where website_domain_normalized = v_domain limit 1; end if;
  end if;
  if v_business_id is null then
    select id into v_business_id from public.commercial_businesses
    where regexp_replace(lower(business_name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(p_business_name), '[^a-z0-9]', '', 'g')
      and country_code = 'ZA' and city = v_run.city limit 1;
  end if;
  if v_business_id is null and char_length(regexp_replace(lower(coalesce(p_business_name, '')), '[^a-z0-9]', '', 'g')) >= 12 then
    select id into v_business_id from public.commercial_businesses
    where country_code = 'ZA' and city = v_run.city
      and left(regexp_replace(lower(business_name), '[^a-z0-9]', '', 'g'), 12)
        = left(regexp_replace(lower(p_business_name), '[^a-z0-9]', '', 'g'), 12)
    order by created_at, id limit 1;
    if v_business_id is not null then
      return jsonb_build_object('status', 'possible_duplicate', 'reason', 'ambiguous_business_identity', 'business_id', v_business_id);
    end if;
  end if;
  if v_business_id is not null then
    if exists (select 1 from public.commercial_conversions where business_id = v_business_id) then
      return jsonb_build_object('status', 'excluded_client', 'reason', 'converted_commercial_client', 'business_id', v_business_id);
    end if;
    select id into v_lead_id from public.commercial_leads where business_id = v_business_id order by created_at desc limit 1;
    if v_lead_id is not null then return jsonb_build_object('status', 'duplicate', 'reason', 'existing_commercial_lead', 'business_id', v_business_id, 'lead_id', v_lead_id); end if;
  end if;
  return jsonb_build_object('status', 'clear', 'business_id', v_business_id);
end
$$;

create or replace function public.ingest_commercial_discovery_candidate_v1(
  p_run_id uuid,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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
    where instagram_handle_normalized = v_instagram_handle limit 1;
  end if;
  if v_business_id is null and v_website_domain is not null then
    select id into v_business_id from public.commercial_businesses
    where website_domain_normalized = v_website_domain limit 1;
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
$$;

create or replace function public.finalize_commercial_discovery_run_v1(
  p_run_id uuid,
  p_status text,
  p_counts jsonb,
  p_queries jsonb default '[]'::jsonb,
  p_error_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare v_run public.commercial_discovery_runs%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_status not in ('completed', 'partial', 'failed') or jsonb_typeof(p_counts) <> 'object'
     or jsonb_typeof(p_queries) <> 'array' or jsonb_typeof(p_error_summary) <> 'object' then
    raise exception 'commercial_discovery_finalize_invalid' using errcode = '22023';
  end if;
  update public.commercial_discovery_runs set
    status = p_status,
    discovered_count = greatest(coalesce((p_counts->>'discovered')::integer, 0), 0),
    created_count = greatest(coalesce((p_counts->>'created')::integer, 0), 0),
    duplicate_count = greatest(coalesce((p_counts->>'duplicates')::integer, 0), 0),
    enriched_count = greatest(coalesce((p_counts->>'enriched')::integer, 0), 0),
    scored_count = greatest(coalesce((p_counts->>'scored')::integer, 0), 0),
    qualified_count = greatest(coalesce((p_counts->>'qualified')::integer, 0), 0),
    p1_count = greatest(coalesce((p_counts->>'p1')::integer, 0), 0),
    p2_count = greatest(coalesce((p_counts->>'p2')::integer, 0), 0),
    p3_count = greatest(coalesce((p_counts->>'p3')::integer, 0), 0),
    hard_rejected_count = greatest(coalesce((p_counts->>'hard_rejected')::integer, 0), 0),
    error_count = greatest(coalesce((p_counts->>'errors')::integer, 0), 0),
    queries_safe = p_queries, error_summary_safe = p_error_summary, completed_at = now()
  where id = p_run_id and status = 'running'
  returning * into v_run;
  if not found then raise exception 'commercial_discovery_run_not_running' using errcode = '22023'; end if;
  return to_jsonb(v_run);
end
$$;

create or replace function public.commercial_discovery_run_read_model_v1(p_limit integer default 10)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'latest', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc)
      from (
        select id, campaign_id, provider, country_code, city, subsegment, max_prospects,
          status, discovered_count, created_count, duplicate_count, enriched_count,
          scored_count, qualified_count, p1_count, p2_count, p3_count,
          hard_rejected_count, error_count, started_at, completed_at, created_at, updated_at
        from public.commercial_discovery_runs
        order by created_at desc, id desc
        limit least(greatest(coalesce(p_limit, 10), 1), 50)
      ) r
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'last_run_at', (select max(created_at) from public.commercial_discovery_runs),
      'running', (select count(*)::integer from public.commercial_discovery_runs where status in ('queued', 'running')),
      'discovered', (select coalesce(sum(discovered_count), 0)::integer from public.commercial_discovery_runs),
      'enriched', (select coalesce(sum(enriched_count), 0)::integer from public.commercial_discovery_runs),
      'scored', (select coalesce(sum(scored_count), 0)::integer from public.commercial_discovery_runs),
      'p1', (select coalesce(sum(p1_count), 0)::integer from public.commercial_discovery_runs),
      'p2', (select coalesce(sum(p2_count), 0)::integer from public.commercial_discovery_runs)
    )
  )
$$;

alter table public.commercial_discovery_runs enable row level security;
alter table public.commercial_discovery_runs force row level security;
alter table public.commercial_discovery_items enable row level security;
alter table public.commercial_discovery_items force row level security;
alter table public.commercial_business_identifiers enable row level security;
alter table public.commercial_business_identifiers force row level security;

create policy commercial_discovery_runs_service_role_all_v1 on public.commercial_discovery_runs
  for all to service_role using (true) with check (true);
create policy commercial_discovery_items_service_role_all_v1 on public.commercial_discovery_items
  for all to service_role using (true) with check (true);
create policy commercial_business_identifiers_service_role_all_v1 on public.commercial_business_identifiers
  for all to service_role using (true) with check (true);

revoke all on table public.commercial_discovery_runs, public.commercial_discovery_items,
  public.commercial_business_identifiers from public, anon, authenticated;
grant select, insert, update on table public.commercial_discovery_runs to service_role;
grant select, insert, update on table public.commercial_discovery_items to service_role;
grant select, insert, update on table public.commercial_business_identifiers to service_role;

revoke all on function
  public.create_commercial_discovery_run_v1(uuid, text, text, integer, text),
  public.claim_commercial_discovery_run_v1(uuid),
  public.preflight_commercial_discovery_candidate_v1(uuid, text, text, text, text, text),
  public.ingest_commercial_discovery_candidate_v1(uuid, jsonb, text),
  public.finalize_commercial_discovery_run_v1(uuid, text, jsonb, jsonb, jsonb),
  public.commercial_discovery_run_read_model_v1(integer)
from public, anon, authenticated;
grant execute on function public.create_commercial_discovery_run_v1(uuid, text, text, integer, text) to service_role;
grant execute on function public.claim_commercial_discovery_run_v1(uuid) to service_role;
grant execute on function public.preflight_commercial_discovery_candidate_v1(uuid, text, text, text, text, text) to service_role;
grant execute on function public.ingest_commercial_discovery_candidate_v1(uuid, jsonb, text) to service_role;
grant execute on function public.finalize_commercial_discovery_run_v1(uuid, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.commercial_discovery_run_read_model_v1(integer) to service_role;

do $$
declare v_owner_id uuid;
begin
  select iag.auth_user_id into v_owner_id
  from public.internal_access_grants iag
  join public.tenant_users tu on tu.user_id = iag.auth_user_id and tu.role::text = 'superadmin'
  where iag.permission_key = 'commercial_crm_access' and iag.active and iag.revoked_at is null
  order by iag.created_at, iag.auth_user_id
  limit 1;
  if v_owner_id is null then
    raise exception 'canonical_commercial_owner_identity_missing_or_not_superadmin';
  end if;
  insert into public.commercial_campaigns (
    campaign_code, name, country_code, city_scope, geography, vertical, status,
    created_by, updated_by, metadata_safe
  ) values (
    'BMB_ZA_BEAUTY_V1', 'South Africa Beauty & Aesthetics V1', 'ZA',
    array['Johannesburg', 'Cape Town'], '{"country":"South Africa","runtime_scope":"strict_v1"}'::jsonb,
    'Beauty/Aesthetics', 'active', v_owner_id, v_owner_id,
    '{"discovery_provider":"searchapi","max_prospects_per_run":30,"auto_approval":false,"auto_outreach":false}'::jsonb
  ) on conflict (campaign_code) do nothing;
end
$$;

comment on table public.commercial_discovery_runs is
  'Service-role-only run ledger for owner-triggered Commercial Discovery. No outreach execution is present.';
comment on table public.commercial_business_identifiers is
  'Commercial-only provider identities. This table is intentionally separate from client CT and Phone Farm targeting.';
comment on function public.ingest_commercial_discovery_candidate_v1(uuid, jsonb, text) is
  'Atomic service-role ingestion with client exclusion, deduplication, append-only evidence events, and no approval/outreach transition.';

commit;
