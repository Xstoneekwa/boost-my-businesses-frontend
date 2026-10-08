-- Canonical production migration version.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.commercial_discovery_runs drop constraint commercial_france_authorized_canary_keys_v1;
alter table public.commercial_discovery_runs add constraint commercial_france_authorized_canary_keys_v1 check(country_code<>'FR' or idempotency_key in ('commercial-france-beauty-portability-canary-v1','commercial-france-location-evidence-hardening-v1','commercial-france-profile-first-v2-canary'));
alter table public.commercial_discovery_runs add constraint commercial_france_v2_bounds check(idempotency_key<>'commercial-france-profile-first-v2-canary' or (country_code='FR' and city='France' and max_prospects=30 and not force_rescore and discovery_max_attempts=1));
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
    if p_max_prospects<>30 or v_subsegment is not null or v_idempotency_key not in ('commercial-france-beauty-portability-canary-v1','commercial-france-location-evidence-hardening-v1','commercial-france-profile-first-v2-canary') then raise exception 'commercial_france_canary_scope_invalid'; end if;
    perform pg_advisory_xact_lock(hashtext('commercial-france-beauty-portability-canary-v1'));
    select * into v_run from public.commercial_discovery_runs where country_code='FR' and idempotency_key=v_idempotency_key;
    if found then return jsonb_build_object('id',v_run.id,'status',v_run.status,'city',v_run.city,'max_prospects',v_run.max_prospects,'idempotent_replay',true); end if;
  end if;
  if v_city='France' and v_idempotency_key='commercial-france-location-evidence-hardening-v1' and not exists(select 1 from public.commercial_discovery_runs where country_code='FR' and idempotency_key='commercial-france-beauty-portability-canary-v1' and status in ('completed','completed_with_errors')) then raise exception 'commercial_france_first_canary_not_finished'; end if;
  if v_city='France' and v_idempotency_key='commercial-france-profile-first-v2-canary' and not exists(select 1 from public.commercial_discovery_runs where country_code='FR' and idempotency_key='commercial-france-location-evidence-hardening-v1' and status in ('completed','completed_with_errors')) then raise exception 'commercial_france_second_canary_not_finished'; end if;
  insert into public.commercial_discovery_runs (
    campaign_id, requested_by, provider, country_code, city, subsegment,
    max_prospects, status, idempotency_key, discovery_max_attempts
  ) values (
    v_campaign_id, p_actor_user_id, 'searchapi', case when v_city='France' then 'FR' else 'ZA' end, v_city, v_subsegment,
    p_max_prospects, 'queued', v_idempotency_key, case when v_idempotency_key='commercial-france-profile-first-v2-canary' then 1 else 3 end
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




create table public.commercial_france_serp_pages_v2 (
 run_id uuid not null references public.commercial_discovery_runs(id),
 query_id text not null check(query_id ~ '^f([1-9]|10)-(control|candidate)$'),
 page integer not null check(page in (1,2)),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '29 days',
 primary key(run_id,query_id,page),
 check(expires_at<=created_at+interval '29 days')
);
alter table public.commercial_france_serp_pages_v2 enable row level security;
alter table public.commercial_france_serp_pages_v2 force row level security;
revoke all on public.commercial_france_serp_pages_v2 from public,anon,authenticated;
grant select,insert,update,delete on public.commercial_france_serp_pages_v2 to service_role;
create policy commercial_france_capture_service on public.commercial_france_serp_pages_v2 for all to service_role using(true) with check(exists(select 1 from public.commercial_discovery_runs r where r.id=run_id and r.idempotency_key='commercial-france-profile-first-v2-canary'));

create table public.commercial_france_score_reservations_v2(
 item_id uuid primary key references public.commercial_discovery_items(id),
 run_id uuid not null references public.commercial_discovery_runs(id),
 reserved_at timestamptz not null default now()
);
create index commercial_france_score_run_v2 on public.commercial_france_score_reservations_v2(run_id);
alter table public.commercial_france_score_reservations_v2 enable row level security;
alter table public.commercial_france_score_reservations_v2 force row level security;
revoke all on public.commercial_france_score_reservations_v2 from public,anon,authenticated;
grant select,insert on public.commercial_france_score_reservations_v2 to service_role;
create policy commercial_france_score_service on public.commercial_france_score_reservations_v2 for all to service_role using(true) with check(true);
create or replace function public.reserve_commercial_france_score_v2(p_item_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_run uuid; v_inserted integer;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'service_role_required' using errcode='42501';end if;
 select i.run_id into v_run from public.commercial_discovery_items i join public.commercial_discovery_runs r on r.id=i.run_id where i.id=p_item_id and r.idempotency_key='commercial-france-profile-first-v2-canary' and i.selected_for_processing and i.precheck_decision='PRECHECK_PASS' and i.enriched_at is not null and i.location_country='FR';
 if v_run is null then return false;end if;
 perform pg_advisory_xact_lock(hashtext(v_run::text));
 if (select count(*) from public.commercial_france_score_reservations_v2 where run_id=v_run)>=30 then return false;end if;
 insert into public.commercial_france_score_reservations_v2(item_id,run_id) values(p_item_id,v_run) on conflict do nothing;
 get diagnostics v_inserted=row_count;return v_inserted=1;
end $$;
revoke all on function public.reserve_commercial_france_score_v2(uuid) from public,anon,authenticated;
grant execute on function public.reserve_commercial_france_score_v2(uuid) to service_role;
-- Production already has pg_cron. Local disposable tests do not install it.
-- 29-day expiry plus hourly sweep stays below the requested 30-day retention.
do $retention$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('commercial-france-serp-v2-retention','17 * * * *',
   'delete from public.commercial_france_serp_pages_v2 where expires_at <= now()');
 end if;
end $retention$;
commit;
