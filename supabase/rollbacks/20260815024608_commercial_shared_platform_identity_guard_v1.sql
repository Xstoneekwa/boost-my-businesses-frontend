begin;

do $$
begin
  if exists (
    select 1 from public.commercial_businesses
    where website is not null and public.commercial_crm_identity_domain_v2(website) is null
    group by lower(regexp_replace(regexp_replace(website, '^[a-z][a-z0-9+.-]*://', '', 'i'), '[/?:#].*$', ''))
    having count(*) > 1
  ) then
    raise exception 'rollback_refused_shared_platform_domain_collision';
  end if;
end
$$;

create or replace function public.commercial_crm_normalize_business_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_domain text;
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
  if new.website is null then
    new.website_domain_normalized := null;
  else
    v_domain := lower(regexp_replace(new.website, '^[a-z][a-z0-9+.-]*://', '', 'i'));
    v_domain := regexp_replace(v_domain, '^www\.', '', 'i');
    new.website_domain_normalized := nullif(regexp_replace(v_domain, '[/?:#].*$', ''), '');
  end if;
  new.instagram_handle_normalized := nullif(lower(regexp_replace(coalesce(new.instagram_handle, ''), '^@+', '')), '');
  return new;
end
$$;

update public.commercial_businesses set website = website
where website is not null and public.commercial_crm_identity_domain_v2(website) is null;

drop function public.commercial_crm_identity_domain_v2(text);

commit;
