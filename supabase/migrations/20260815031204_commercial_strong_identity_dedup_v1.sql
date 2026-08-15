begin;

create or replace function public.commercial_crm_identity_domain_v2(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_domain text;
begin
  if nullif(btrim(coalesce(p_url, '')), '') is null then return null; end if;
  v_domain := lower(regexp_replace(p_url, '^[a-z][a-z0-9+.-]*://', '', 'i'));
  v_domain := regexp_replace(v_domain, '^www\.', '', 'i');
  v_domain := nullif(regexp_replace(v_domain, '[/?:#].*$', ''), '');
  if v_domain is null then return null; end if;
  if v_domain ~ '^(fresha\.com|booksy\.(com|info)|treatwell\.[a-z.]+|calendly\.com|wa\.me|whatsapp\.com|linktr\.ee|beacons\.ai|bio\.site|setmore\.com|glossgenius\.com|vagaro\.com|tiktok\.com|instagram\.com|facebook\.com|fb\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|pinterest\.[a-z.]+|g\.co|maps\.app\.goo\.gl)$' then
    return null;
  end if;
  return v_domain;
end
$$;

update public.commercial_businesses
set website = website
where website_domain_normalized is not null
  and public.commercial_crm_identity_domain_v2(website) is null;

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
  if v_business_id is null then
    select id into v_business_id from public.commercial_businesses
    where instagram_handle_normalized = v_handle limit 1;
  end if;
  if v_business_id is null then
    v_domain := public.commercial_crm_identity_domain_v2(p_website);
    if v_domain is not null then
      select id into v_business_id from public.commercial_businesses
      where website_domain_normalized = v_domain limit 1;
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
$$;

comment on function public.commercial_crm_identity_domain_v2(text) is
  'Returns only first-party website domains suitable for Commercial CRM identity matching; shared booking, bio-link, messaging, social, and redirect platforms return NULL.';
comment on function public.preflight_commercial_discovery_candidate_v1(uuid,text,text,text,text,text) is
  'Fail-closed service-role discovery preflight using only strong identity: provider id, canonical Instagram handle, or first-party website domain. Display-name similarity is non-blocking evidence.';

commit;
