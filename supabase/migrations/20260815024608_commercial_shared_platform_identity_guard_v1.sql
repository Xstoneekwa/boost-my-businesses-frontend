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
  if v_domain ~ '^(fresha\.com|booksy\.(com|info)|treatwell\.[a-z.]+|calendly\.com|wa\.me|whatsapp\.com|linktr\.ee|beacons\.ai|bio\.site|setmore\.com|glossgenius\.com|vagaro\.com)$' then
    return null;
  end if;
  return v_domain;
end
$$;

create or replace function public.commercial_crm_normalize_business_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.business_name := btrim(new.business_name);
  new.country_code := upper(btrim(new.country_code));
  new.city := nullif(btrim(new.city), '');
  new.vertical := btrim(new.vertical);
  new.subsegment := nullif(btrim(new.subsegment), '');
  new.website := nullif(btrim(new.website), '');
  new.instagram_handle := nullif(btrim(new.instagram_handle), '');
  new.email := nullif(lower(btrim(new.email)), '');
  new.phone := nullif(btrim(new.phone), '');
  new.website_domain_normalized := public.commercial_crm_identity_domain_v2(new.website);
  new.instagram_handle_normalized := nullif(lower(regexp_replace(coalesce(new.instagram_handle, ''), '^@+', '')), '');
  return new;
end
$$;

update public.commercial_businesses
set website = website
where website_domain_normalized is not null
  and public.commercial_crm_identity_domain_v2(website) is null;

comment on function public.commercial_crm_identity_domain_v2(text) is
  'Returns only first-party website domains suitable for Commercial CRM identity matching; shared booking, bio-link, and messaging platforms return NULL.';

commit;
