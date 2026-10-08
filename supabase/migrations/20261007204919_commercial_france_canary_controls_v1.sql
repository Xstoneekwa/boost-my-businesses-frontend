begin;
set local lock_timeout = '5s';

-- France runs are parameterized by geography and wave size. The historical
-- France="France" namespace remains valid and immutable; only new
-- parameterized city runs are subject to the V2 key/volume contract.
alter table public.commercial_discovery_runs drop constraint if exists commercial_discovery_runs_max_v1_check;
alter table public.commercial_discovery_runs drop constraint if exists commercial_discovery_runs_max_v2_check;
alter table public.commercial_discovery_runs
  add constraint commercial_discovery_runs_max_v3_check check (
    (country_code = 'ZA' and max_prospects between 1 and 30)
    or (country_code = 'FR' and max_prospects between 1 and 500)
  );

alter table public.commercial_discovery_runs drop constraint if exists commercial_discovery_runs_market_v1_check;
alter table public.commercial_discovery_runs
  add constraint commercial_discovery_runs_market_v2_check check (
    (country_code = 'ZA' and city in ('Johannesburg', 'Cape Town'))
    or (country_code = 'FR' and char_length(btrim(city)) between 1 and 120)
  );

alter table public.commercial_discovery_runs drop constraint if exists commercial_france_authorized_canary_keys_v1;
alter table public.commercial_discovery_runs
  add constraint commercial_france_run_key_v2_check check (
    country_code <> 'FR'
    or (
      city = 'France'
      and max_prospects between 15 and 30
      and idempotency_key in (
        'commercial-france-wide-sirene-poc15-v1',
        'commercial-france-profile-first-v2-canary',
        'commercial-france-location-evidence-hardening-v1',
        'commercial-france-beauty-portability-canary-v1'
      )
    )
    or (
      city <> 'France'
      and max_prospects between 10 and 50
      and idempotency_key ~ '^commercial-france-[a-z0-9][a-z0-9-]{1,180}-v[0-9]+$'
    )
  );

create table public.commercial_france_run_controls (
  run_id uuid primary key references public.commercial_discovery_runs(id) on delete cascade,
  phase text not null default 'canary'
    check (phase in ('canary', 'extension', 'ramp_up', 'full_scale', 'national')),
  geography_safe jsonb not null default '{}'::jsonb
    check (jsonb_typeof(geography_safe) = 'object'),
  budget_limits_safe jsonb not null default '{}'::jsonb
    check (jsonb_typeof(budget_limits_safe) = 'object'),
  thresholds_safe jsonb not null default '{}'::jsonb
    check (jsonb_typeof(thresholds_safe) = 'object'),
  state text not null default 'armed'
    check (state in ('armed', 'running', 'hold', 'stopped', 'completed', 'cancelled')),
  stop_code text null,
  stop_reason text null,
  metrics_safe jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metrics_safe) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.commercial_france_provider_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.commercial_discovery_runs(id) on delete cascade,
  provider text not null check (provider in ('searchapi', 'sirene', 'openai')),
  call_kind text not null check (call_kind in ('discovery', 'resolver', 'site_page', 'profile', 'sirene', 'scoring')),
  call_key text not null check (char_length(btrim(call_key)) between 1 and 240),
  status text not null default 'reserved'
    check (status in ('reserved', 'succeeded', 'failed', 'skipped', 'cancelled')),
  duration_ms integer null check (duration_ms is null or duration_ms >= 0),
  result_count integer null check (result_count is null or result_count >= 0),
  error_code text null,
  cost_amount numeric(14, 6) null check (cost_amount is null or cost_amount >= 0),
  cost_currency text null check (cost_currency is null or cost_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  finished_at timestamptz null,
  constraint commercial_france_provider_call_unique
    unique (run_id, provider, call_kind, call_key)
);

create table public.commercial_france_identity_claims (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.commercial_discovery_runs(id) on delete cascade,
  item_id uuid null references public.commercial_discovery_items(id) on delete set null,
  business_id uuid null references public.commercial_businesses(id) on delete set null,
  key_type text not null check (key_type in ('siret', 'provider_external_id')),
  key_value text not null check (char_length(btrim(key_value)) between 1 and 240),
  metadata_safe jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata_safe) = 'object'),
  created_at timestamptz not null default now(),
  constraint commercial_france_identity_claim_unique unique (key_type, key_value)
);

create index commercial_france_run_controls_state_idx
  on public.commercial_france_run_controls (state, updated_at desc);
create index commercial_france_provider_calls_run_status_idx
  on public.commercial_france_provider_calls (run_id, status, call_kind);
create index commercial_france_identity_claims_run_idx
  on public.commercial_france_identity_claims (run_id, created_at desc);

alter table public.commercial_france_run_controls enable row level security;
alter table public.commercial_france_run_controls force row level security;
alter table public.commercial_france_provider_calls enable row level security;
alter table public.commercial_france_provider_calls force row level security;
alter table public.commercial_france_identity_claims enable row level security;
alter table public.commercial_france_identity_claims force row level security;
revoke all on table public.commercial_france_run_controls, public.commercial_france_provider_calls,
  public.commercial_france_identity_claims from public, anon, authenticated;
grant select, insert, update on table public.commercial_france_run_controls,
  public.commercial_france_provider_calls, public.commercial_france_identity_claims to service_role;
create policy commercial_france_run_controls_service_role on public.commercial_france_run_controls
  for all to service_role using (true) with check (true);
create policy commercial_france_provider_calls_service_role on public.commercial_france_provider_calls
  for all to service_role using (true) with check (true);
create policy commercial_france_identity_claims_service_role on public.commercial_france_identity_claims
  for all to service_role using (true) with check (true);

create or replace function public.commercial_france_touch_updated_at_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger commercial_france_run_controls_touch_updated_at
before update on public.commercial_france_run_controls
for each row execute function public.commercial_france_touch_updated_at_v1();

create or replace function public.commercial_france_normalize_handle_v1(p_handle text)
returns text language sql immutable set search_path = '' as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p_handle, '')), '^@+', '')), '')
$$;

create or replace function public.commercial_france_normalize_phone_v1(p_phone text)
returns text language sql immutable set search_path = '' as $$
  select case when length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) >= 7
    then regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') else null end
$$;

create or replace function public.commercial_france_normalize_address_v1(p_address text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(lower(btrim(coalesce(p_address, ''))), '\s+', ' ', 'g'), '')
$$;

create or replace function public.create_commercial_france_canary_run_v1(
  p_actor_user_id uuid,
  p_city text,
  p_subsegment text,
  p_max_prospects integer,
  p_idempotency_key text,
  p_geography_safe jsonb default '{}'::jsonb,
  p_budget_limits_safe jsonb default null,
  p_thresholds_safe jsonb default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_city text := btrim(coalesce(p_city, ''));
  v_subsegment text := nullif(btrim(coalesce(p_subsegment, '')), '');
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_run public.commercial_discovery_runs%rowtype;
  v_campaign_id uuid;
  v_inserted integer := 0;
  v_budget jsonb := jsonb_build_object(
    'searchapi_discovery', greatest(60, p_max_prospects * 2),
    'searchapi_resolver', p_max_prospects,
    'site_pages', greatest(15, ceil(p_max_prospects * 1.5)::integer),
    'public_profiles', greatest(6, ceil(p_max_prospects * 0.5)::integer),
    'sirene', 2,
    'openai_scoring', greatest(3, ceil(p_max_prospects / 3.0)::integer)
  );
  v_thresholds jsonb := jsonb_build_object(
    'sample_min', 10,
    'high_rate_min', 0.10,
    'medium_rate_max', 0.50,
    'provider_error_rate_max', 0.20,
    'duplicate_rate_max', 0.30,
    'latency_p95_max_ms', 15000
  );
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if not public.commercial_crm_actor_authorized_v1(p_actor_user_id) then
    raise exception 'commercial_crm_owner_access_required' using errcode = '42501';
  end if;
  if char_length(v_city) not between 1 and 120 then
    raise exception 'commercial_france_city_required' using errcode = '22023';
  end if;
  if p_max_prospects is null or p_max_prospects not between 10 and 50 then
    raise exception 'commercial_france_canary_volume_invalid' using errcode = '22023';
  end if;
  if char_length(v_key) not between 1 and 200 or v_key !~ '^commercial-france-[a-z0-9][a-z0-9-]{1,180}-v[0-9]+$' then
    raise exception 'commercial_france_idempotency_key_invalid' using errcode = '22023';
  end if;
  if p_geography_safe is null or jsonb_typeof(p_geography_safe) <> 'object'
     or p_budget_limits_safe is not null and jsonb_typeof(p_budget_limits_safe) <> 'object'
     or p_thresholds_safe is not null and jsonb_typeof(p_thresholds_safe) <> 'object' then
    raise exception 'commercial_france_control_payload_invalid' using errcode = '22023';
  end if;

  select id into v_campaign_id from public.commercial_campaigns
  where campaign_code = 'BMB_FR_BEAUTY_PORTABILITY_V1';
  if v_campaign_id is null then raise exception 'commercial_france_campaign_missing' using errcode = 'P0002'; end if;

  insert into public.commercial_discovery_runs(
    campaign_id, requested_by, provider, country_code, city, subsegment,
    max_prospects, status, idempotency_key
  ) values (
    v_campaign_id, p_actor_user_id, 'searchapi', 'FR', v_city, v_subsegment,
    p_max_prospects, 'queued', v_key
  ) on conflict (requested_by, idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_run from public.commercial_discovery_runs
  where requested_by = p_actor_user_id and idempotency_key = v_key;
  if v_run.id is null then raise exception 'commercial_france_run_create_failed' using errcode = 'P0002'; end if;

  insert into public.commercial_france_run_controls(
    run_id, phase, geography_safe, budget_limits_safe, thresholds_safe, state
  ) values (
    v_run.id, 'canary', p_geography_safe,
    v_budget || coalesce(p_budget_limits_safe, '{}'::jsonb),
    v_thresholds || coalesce(p_thresholds_safe, '{}'::jsonb), 'armed'
  ) on conflict (run_id) do nothing;

  return jsonb_build_object(
    'id', v_run.id,
    'status', v_run.status,
    'country_code', v_run.country_code,
    'city', v_run.city,
    'subsegment', v_run.subsegment,
    'max_prospects', v_run.max_prospects,
    'control_state', (select state from public.commercial_france_run_controls where run_id = v_run.id),
    'idempotent_replay', v_inserted = 0
  );
end
$$;

create or replace function public.preflight_commercial_france_identity_v1(
  p_run_id uuid,
  p_provider text,
  p_provider_external_id text,
  p_siret text default null,
  p_instagram_handle text default null,
  p_website text default null,
  p_phone text default null,
  p_address text default null,
  p_business_name text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_run public.commercial_discovery_runs%rowtype;
  v_siret text := nullif(regexp_replace(coalesce(p_siret, ''), '[^0-9]', '', 'g'), '');
  v_external text := nullif(lower(btrim(coalesce(p_provider_external_id, ''))), '');
  v_handle text := public.commercial_france_normalize_handle_v1(p_instagram_handle);
  v_domain text := public.commercial_crm_identity_domain_v2(p_website);
  v_phone text := public.commercial_france_normalize_phone_v1(p_phone);
  v_address text := public.commercial_france_normalize_address_v1(p_address);
  v_exact uuid;
  v_soft jsonb := '[]'::jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select * into v_run from public.commercial_discovery_runs where id = p_run_id;
  if not found or v_run.country_code <> 'FR' then raise exception 'commercial_france_run_required' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_provider, '')), '') is null or v_external is null then
    raise exception 'commercial_france_provider_identity_required' using errcode = '22023';
  end if;
  if v_siret is not null and length(v_siret) <> 14 then v_siret := null; end if;

  select business_id into v_exact from public.commercial_business_identifiers
  where (v_siret is not null and provider = 'sirene' and external_id = v_siret)
     or (provider = btrim(p_provider) and lower(external_id) = v_external)
  order by provider = 'sirene' desc limit 1;
  if v_exact is not null then
    return jsonb_build_object('status', 'duplicate_exact', 'business_id', v_exact, 'reason', 'canonical_provider_identity');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('business_id', x.id, 'signals', x.signals) order by x.id), '[]'::jsonb)
    into v_soft
  from (
    select distinct b.id,
      array_remove(array[
        case when v_handle is not null and b.instagram_handle_normalized = v_handle then 'instagram_handle' end,
        case when v_domain is not null and b.website_domain_normalized = v_domain then 'first_party_domain' end,
        case when v_phone is not null and public.commercial_france_normalize_phone_v1(b.phone) = v_phone then 'phone' end,
        case when v_address is not null and public.commercial_france_normalize_address_v1(b.address_safe) = v_address then 'address' end
      ], null) as signals
    from public.commercial_businesses b
    where b.country_code = 'FR' and (
      (v_handle is not null and b.instagram_handle_normalized = v_handle)
      or (v_domain is not null and b.website_domain_normalized = v_domain)
      or (v_phone is not null and public.commercial_france_normalize_phone_v1(b.phone) = v_phone)
      or (v_address is not null and public.commercial_france_normalize_address_v1(b.address_safe) = v_address)
    )
  ) x;

  if jsonb_array_length(v_soft) > 0 then
    return jsonb_build_object('status', 'review_match', 'matches', v_soft, 'reason', 'soft_identity_signal_requires_review');
  end if;
  return jsonb_build_object('status', 'clear', 'reason', 'no_existing_exact_or_soft_identity');
end
$$;

create or replace function public.claim_commercial_france_identity_v1(
  p_run_id uuid,
  p_provider text,
  p_provider_external_id text,
  p_siret text default null,
  p_item_id uuid default null,
  p_business_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_preflight jsonb;
  v_external text := nullif(lower(btrim(coalesce(p_provider_external_id, ''))), '');
  v_siret text := nullif(regexp_replace(coalesce(p_siret, ''), '[^0-9]', '', 'g'), '');
  v_inserted integer;
  v_key_value text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  if v_external is null then raise exception 'commercial_france_provider_identity_required' using errcode = '22023'; end if;
  v_preflight := public.preflight_commercial_france_identity_v1(p_run_id, p_provider, v_external, p_siret);
  if v_preflight->>'status' <> 'clear' then return v_preflight || jsonb_build_object('claimed', false); end if;

  v_key_value := lower(btrim(p_provider)) || ':' || v_external;
  perform pg_advisory_xact_lock(hashtextextended('provider_external_id:' || v_key_value, 918));
  insert into public.commercial_france_identity_claims(run_id,item_id,business_id,key_type,key_value,metadata_safe)
  values(p_run_id,p_item_id,p_business_id,'provider_external_id',v_key_value,jsonb_build_object('provider',p_provider,'siret',v_siret))
  on conflict (key_type,key_value) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('status','duplicate_claim','claimed',false,'key_type','provider_external_id','key_value',v_key_value);
  end if;
  if v_siret is not null and length(v_siret) = 14 then
    perform pg_advisory_xact_lock(hashtextextended('siret:' || v_siret, 918));
    insert into public.commercial_france_identity_claims(run_id,item_id,business_id,key_type,key_value,metadata_safe)
    values(p_run_id,p_item_id,p_business_id,'siret',v_siret,jsonb_build_object('provider',p_provider,'provider_external_id',v_external))
    on conflict (key_type,key_value) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      return jsonb_build_object('status','duplicate_claim','claimed',false,'key_type','siret','key_value',v_siret);
    end if;
  end if;
  return jsonb_build_object('status','claimed_exact','claimed',true,'provider_external_id',v_external,'siret',v_siret);
end
$$;

create or replace function public.reserve_commercial_france_provider_call_v1(
  p_run_id uuid, p_provider text, p_call_kind text, p_call_key text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_control public.commercial_france_run_controls%rowtype;
  v_run public.commercial_discovery_runs%rowtype;
  v_limit integer;
  v_used integer;
  v_existing uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select * into v_control from public.commercial_france_run_controls where run_id = p_run_id for update;
  select * into v_run from public.commercial_discovery_runs where id = p_run_id;
  if v_control.run_id is null or v_run.country_code <> 'FR' then return jsonb_build_object('reserved',false,'reason','france_control_missing'); end if;
  if v_control.state not in ('armed','running') or v_run.status <> 'running' then return jsonb_build_object('reserved',false,'reason','run_not_running'); end if;
  if p_provider not in ('searchapi','sirene','openai') or p_call_kind not in ('discovery','resolver','site_page','profile','sirene','scoring') then return jsonb_build_object('reserved',false,'reason','provider_call_kind_invalid'); end if;
  if char_length(btrim(coalesce(p_call_key,''))) not between 1 and 240 then return jsonb_build_object('reserved',false,'reason','call_key_invalid'); end if;
  select id into v_existing from public.commercial_france_provider_calls where run_id=p_run_id and provider=p_provider and call_kind=p_call_kind and call_key=btrim(p_call_key);
  if v_existing is not null then return jsonb_build_object('reserved',false,'reason','idempotent_replay','call_id',v_existing); end if;
  v_limit := coalesce((v_control.budget_limits_safe ->> case p_call_kind
    when 'discovery' then 'searchapi_discovery' when 'resolver' then 'searchapi_resolver'
    when 'site_page' then 'site_pages' when 'profile' then 'public_profiles'
    when 'sirene' then 'sirene' when 'scoring' then 'openai_scoring' end)::integer, 0);
  select count(*)::integer into v_used from public.commercial_france_provider_calls
  where run_id=p_run_id and call_kind=p_call_kind and status <> 'cancelled';
  if v_limit <= v_used then return jsonb_build_object('reserved',false,'reason','budget_exceeded','call_kind',p_call_kind,'used',v_used,'limit',v_limit); end if;
  insert into public.commercial_france_provider_calls(run_id,provider,call_kind,call_key,status)
  values(p_run_id,p_provider,p_call_kind,btrim(p_call_key),'reserved') returning id into v_existing;
  update public.commercial_france_run_controls set state='running' where run_id=p_run_id and state='armed';
  return jsonb_build_object('reserved',true,'call_id',v_existing,'used',v_used+1,'limit',v_limit);
end
$$;

create or replace function public.finish_commercial_france_provider_call_v1(
  p_call_id uuid, p_status text, p_duration_ms integer default null,
  p_result_count integer default null, p_error_code text default null,
  p_cost_amount numeric default null, p_cost_currency text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_call public.commercial_france_provider_calls%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  if p_status not in ('succeeded','failed','skipped','cancelled') then raise exception 'provider_call_status_invalid' using errcode = '22023'; end if;
  update public.commercial_france_provider_calls set status=p_status,duration_ms=case when p_duration_ms is null then null else greatest(0,p_duration_ms) end,
    result_count=case when p_result_count is null then null else greatest(0,p_result_count) end,error_code=nullif(left(coalesce(p_error_code,''),120),''),
    cost_amount=case when p_cost_amount is null then null else greatest(0,p_cost_amount) end,cost_currency=case when p_cost_currency is null then null else upper(p_cost_currency) end,finished_at=now()
  where id=p_call_id and status='reserved' returning * into v_call;
  if v_call.id is null then raise exception 'provider_call_not_reservable' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok',true,'call_id',v_call.id,'status',v_call.status,'cost_known',v_call.cost_amount is not null);
end
$$;

create or replace function public.evaluate_commercial_france_run_gate_v1(p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  c public.commercial_france_run_controls%rowtype;
  v_total integer; v_classified integer; v_high integer; v_medium integer; v_low integer; v_dup integer; v_failed integer; v_finished integer; v_p95 numeric;
  v_high_rate numeric := 0; v_medium_rate numeric := 0; v_error_rate numeric := 0; v_duplicate_rate numeric := 0;
  v_budget_exceeded boolean := false; v_incoherent boolean := false; v_hard text := null; v_hold text := null; v_next text;
  v_metrics jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  select * into c from public.commercial_france_run_controls where run_id=p_run_id for update;
  if c.run_id is null then raise exception 'commercial_france_control_missing' using errcode = 'P0002'; end if;
  select count(*)::integer,
    count(*) filter (where coalesce(enrichment_snapshot_safe#>>'{match,confidence}',enrichment_snapshot_safe#>>'{instagram_match,confidence}') in ('HIGH','MEDIUM','LOW'))::integer,
    count(*) filter (where coalesce(enrichment_snapshot_safe#>>'{match,confidence}',enrichment_snapshot_safe#>>'{instagram_match,confidence}')='HIGH')::integer,
    count(*) filter (where coalesce(enrichment_snapshot_safe#>>'{match,confidence}',enrichment_snapshot_safe#>>'{instagram_match,confidence}')='MEDIUM')::integer,
    count(*) filter (where coalesce(enrichment_snapshot_safe#>>'{match,confidence}',enrichment_snapshot_safe#>>'{instagram_match,confidence}')='LOW')::integer,
    count(*) filter (where status in ('duplicate','possible_duplicate','excluded_client'))::integer,
    count(*) filter (where status='failed')::integer,
    count(*) filter (where status in ('completed','rejected','duplicate','possible_duplicate','excluded_client','failed'))::integer,
    bool_or(status='completed' and (business_id is null or selected_for_processing is null))
    into v_total,v_classified,v_high,v_medium,v_low,v_dup,v_failed,v_finished,v_incoherent
  from public.commercial_discovery_items where run_id=p_run_id;
  select percentile_cont(0.95) within group (order by duration_ms) into v_p95 from public.commercial_france_provider_calls where run_id=p_run_id and duration_ms is not null;
  select count(*) filter (where status='failed')::integer,count(*) filter (where status in ('succeeded','failed'))::integer
    into v_failed,v_finished from public.commercial_france_provider_calls where run_id=p_run_id;
  select exists(select 1 from public.commercial_france_provider_calls pc where pc.run_id=p_run_id and pc.call_kind is not null
    and (select count(*) from public.commercial_france_provider_calls x where x.run_id=p_run_id and x.call_kind=pc.call_kind and x.status<>'cancelled')
      > coalesce((c.budget_limits_safe ->> case pc.call_kind when 'discovery' then 'searchapi_discovery' when 'resolver' then 'searchapi_resolver' when 'site_page' then 'site_pages' when 'profile' then 'public_profiles' when 'sirene' then 'sirene' when 'scoring' then 'openai_scoring' end)::integer,0)) into v_budget_exceeded;
  if v_classified > 0 then v_high_rate := v_high::numeric/v_classified; v_medium_rate := v_medium::numeric/v_classified; end if;
  if v_finished > 0 then v_error_rate := v_failed::numeric/v_finished; end if;
  if v_total > 0 then v_duplicate_rate := v_dup::numeric/v_total; end if;
  v_metrics := jsonb_build_object('candidates',v_total,'classified',v_classified,'high',v_high,'medium',v_medium,'low',v_low,'high_rate',round(v_high_rate,4),'medium_rate',round(v_medium_rate,4),'provider_failed',v_failed,'provider_finished',v_finished,'provider_error_rate',round(v_error_rate,4),'duplicates',v_dup,'duplicate_rate',round(v_duplicate_rate,4),'latency_p95_ms',v_p95,'budget_exceeded',v_budget_exceeded,'persistence_incoherent',coalesce(v_incoherent,false));
  if v_budget_exceeded then v_hard := 'budget_exceeded';
  elsif v_error_rate >= coalesce((c.thresholds_safe->>'provider_error_rate_max')::numeric,0.20) and v_finished >= coalesce((c.thresholds_safe->>'sample_min')::integer,10) then v_hard := 'provider_error_rate';
  elsif coalesce(v_p95,0) > coalesce((c.thresholds_safe->>'latency_p95_max_ms')::numeric,15000) then v_hard := 'latency_p95_exceeded';
  elsif coalesce(v_incoherent,false) then v_hard := 'persistence_incoherent';
  elsif v_classified >= coalesce((c.thresholds_safe->>'sample_min')::integer,10) and v_high_rate < coalesce((c.thresholds_safe->>'high_rate_min')::numeric,0.10) then v_hold := 'high_rate_below_gate';
  elsif v_classified >= coalesce((c.thresholds_safe->>'sample_min')::integer,10) and v_medium_rate > coalesce((c.thresholds_safe->>'medium_rate_max')::numeric,0.50) then v_hold := 'medium_rate_above_gate';
  elsif v_total >= coalesce((c.thresholds_safe->>'sample_min')::integer,10) and v_duplicate_rate > coalesce((c.thresholds_safe->>'duplicate_rate_max')::numeric,0.30) then v_hold := 'duplicate_rate_above_gate';
  end if;
  v_next := case when v_hard is not null then 'stopped' when v_hold is not null then 'hold' when c.state in ('armed','running') then 'running' else c.state end;
  update public.commercial_france_run_controls set state=v_next,stop_code=coalesce(v_hard,v_hold),stop_reason=case when v_hard is not null or v_hold is not null then coalesce(v_hard,v_hold) else stop_reason end,metrics_safe=v_metrics where run_id=p_run_id;
  return v_metrics || jsonb_build_object('state',v_next,'stop_code',coalesce(v_hard,v_hold),'sample_ready',v_classified >= coalesce((c.thresholds_safe->>'sample_min')::integer,10));
end
$$;

-- Reuse the durable worker queues, but make HOLD/STOP terminal for France
-- claims. ZA has no control row and therefore keeps its existing behavior.
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
      and not exists (
        select 1 from public.commercial_france_run_controls c
        where c.run_id = r.id and c.state in ('hold', 'stopped', 'cancelled')
      )
    order by r.created_at, r.id for update skip locked limit least(greatest(coalesce(batch_limit, 1), 1), 2)
  )
  update public.commercial_discovery_runs r set status = 'running', started_at = coalesce(r.started_at, now()), discovery_status = 'processing',
    discovery_attempt_count = r.discovery_attempt_count + 1, worker_locked_at = now(), worker_locked_by = left(coalesce(worker_id, 'commercial_worker'), 120)
  from claimable c where r.id = c.id returning r.*;
end
$$;

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
      and not exists (
        select 1 from public.commercial_france_run_controls c
        where c.run_id = r.id and c.state in ('hold', 'stopped', 'cancelled')
      )
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
end
$$;

revoke all on function public.commercial_france_touch_updated_at_v1(),
  public.commercial_france_normalize_handle_v1(text), public.commercial_france_normalize_phone_v1(text),
  public.commercial_france_normalize_address_v1(text),
  public.create_commercial_france_canary_run_v1(uuid,text,text,integer,text,jsonb,jsonb,jsonb),
  public.preflight_commercial_france_identity_v1(uuid,text,text,text,text,text,text,text,text),
  public.claim_commercial_france_identity_v1(uuid,text,text,text,uuid,uuid),
  public.reserve_commercial_france_provider_call_v1(uuid,text,text,text),
  public.finish_commercial_france_provider_call_v1(uuid,text,integer,integer,text,numeric,text),
  public.evaluate_commercial_france_run_gate_v1(uuid)
from public, anon, authenticated;
grant execute on function public.commercial_france_normalize_handle_v1(text), public.commercial_france_normalize_phone_v1(text),
  public.commercial_france_normalize_address_v1(text), public.create_commercial_france_canary_run_v1(uuid,text,text,integer,text,jsonb,jsonb,jsonb),
  public.preflight_commercial_france_identity_v1(uuid,text,text,text,text,text,text,text,text), public.claim_commercial_france_identity_v1(uuid,text,text,text,uuid,uuid),
  public.reserve_commercial_france_provider_call_v1(uuid,text,text,text), public.finish_commercial_france_provider_call_v1(uuid,text,integer,integer,text,numeric,text),
  public.evaluate_commercial_france_run_gate_v1(uuid) to service_role;

comment on table public.commercial_france_run_controls is 'Owner-only, service-role France wave controls. Geography is data, never a hard-coded city list.';
comment on table public.commercial_france_provider_calls is 'Append-only-ish provider reservation and cost telemetry. Null cost means provider price is unknown, never zero.';
comment on table public.commercial_france_identity_claims is 'Cross-run exact identity claims. Soft domain/phone/address matches remain review-only to preserve multi-location establishments.';
comment on function public.evaluate_commercial_france_run_gate_v1(uuid) is 'Transitions only the France control state to running, hold, or stopped; valid already-persisted results are never deleted.';

commit;
