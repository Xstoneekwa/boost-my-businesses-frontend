-- Exactly two authorized France runs; preserve historical rows and SA behavior.
-- Canonical production migration timestamp.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.commercial_discovery_runs add constraint commercial_france_authorized_canary_keys_v1 check(country_code<>'FR' or idempotency_key in ('commercial-france-beauty-portability-canary-v1','commercial-france-location-evidence-hardening-v1'));
drop index public.commercial_france_one_portability_canary_v1;
create unique index commercial_france_two_authorized_canarys_v1 on public.commercial_discovery_runs(country_code,idempotency_key) where country_code='FR';
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
    if p_max_prospects<>30 or v_subsegment is not null or v_idempotency_key not in ('commercial-france-beauty-portability-canary-v1','commercial-france-location-evidence-hardening-v1') then raise exception 'commercial_france_canary_scope_invalid'; end if;
    perform pg_advisory_xact_lock(hashtext('commercial-france-beauty-portability-canary-v1'));
    select * into v_run from public.commercial_discovery_runs where country_code='FR' and idempotency_key=v_idempotency_key;
    if found then return jsonb_build_object('id',v_run.id,'status',v_run.status,'city',v_run.city,'max_prospects',v_run.max_prospects,'idempotent_replay',true); end if;
  end if;
  if v_city='France' and v_idempotency_key='commercial-france-location-evidence-hardening-v1' and not exists(select 1 from public.commercial_discovery_runs where country_code='FR' and idempotency_key='commercial-france-beauty-portability-canary-v1' and status in ('completed','completed_with_errors')) then raise exception 'commercial_france_first_canary_not_finished'; end if;
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
    where c.id=v_run.campaign_id and (c.metadata_safe->>'human_review_run_id' is distinct from v_run.id::text) and not exists(select 1 from public.commercial_discovery_runs newer where newer.campaign_id=v_run.campaign_id and newer.country_code='FR' and newer.created_at>v_run.created_at);
  end if;
  return to_jsonb(v_run);
end $$;
commit;
