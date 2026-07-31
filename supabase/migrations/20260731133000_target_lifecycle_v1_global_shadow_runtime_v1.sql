-- Target Lifecycle V1 global Shadow runtime.
-- Additive, dormant by default and strictly non-authoritative.
-- This migration never mutates CT business state, notifications, archives,
-- campaigns, packages, entitlements, Auto Restart, or Premium replacements.

alter table public.ct_target_lifecycle_assessments
  add column if not exists availability_status text,
  add column if not exists performance_status text,
  add column if not exists utilization_status text,
  add column if not exists identity_status text,
  add column if not exists source_fingerprint text,
  add column if not exists source_availability_assessment_id uuid references public.ct_target_availability_assessments(id) on delete restrict,
  add column if not exists source_max_observed_at timestamptz,
  add column if not exists missing_evidence text[] not null default '{}'::text[],
  add column if not exists recommended_action text,
  add column if not exists valid_until timestamptz,
  add column if not exists engine_version text,
  add column if not exists rule_version text,
  add column if not exists policy_version text,
  add column if not exists engine_revision integer,
  add column if not exists policy_revision integer,
  add column if not exists explanation_safe jsonb not null default '{}'::jsonb,
  add column if not exists enforcement_allowed boolean not null default false,
  add column if not exists business_action_allowed boolean not null default false,
  add column if not exists mutation_executed boolean not null default false,
  add column if not exists processor_release text;

alter table public.ct_target_lifecycle_current
  add column if not exists status text,
  add column if not exists source_max_observed_at timestamptz,
  add column if not exists engine_version text,
  add column if not exists policy_version text,
  add column if not exists engine_revision integer,
  add column if not exists policy_revision integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='ct_target_lifecycle_assessments_domains_v1_check') then
    alter table public.ct_target_lifecycle_assessments add constraint ct_target_lifecycle_assessments_domains_v1_check check (
      (availability_status is null or availability_status in ('healthy','watch','unavailable_confirmed','identity_ambiguous','stale','insufficient'))
      and (performance_status is null or performance_status in ('healthy','watch','low_performance','stale','insufficient'))
      and (utilization_status is null or utilization_status in ('healthy','watch','replacement_recommended','replacement_pending','exhausted','stale_data','insufficient_data'))
    );
  end if;
  if not exists (select 1 from pg_constraint where conname='ct_target_lifecycle_assessments_shadow_only_v1_check') then
    alter table public.ct_target_lifecycle_assessments add constraint ct_target_lifecycle_assessments_shadow_only_v1_check check (
      enforcement_allowed is false and business_action_allowed is false and mutation_executed is false
    );
  end if;
  if not exists (select 1 from pg_constraint where conname='ct_target_lifecycle_assessments_recommendation_v1_check') then
    alter table public.ct_target_lifecycle_assessments add constraint ct_target_lifecycle_assessments_recommendation_v1_check check (
      recommended_action is null or recommended_action in ('monitor','collect_more_evidence','recheck_stale_evidence','operator_identity_review','replacement_review')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname='ct_target_lifecycle_assessments_versions_v1_check') then
    alter table public.ct_target_lifecycle_assessments add constraint ct_target_lifecycle_assessments_versions_v1_check check (
      (engine_revision is null or engine_revision between 1 and 1000000)
      and (policy_revision is null or policy_revision between 1 and 1000000)
      and jsonb_typeof(explanation_safe)='object'
    );
  end if;
end
$$;

create table public.ct_target_lifecycle_runtime_state (
  id text primary key,
  producer_enabled boolean not null default false,
  current_projector_enabled boolean not null default false,
  shadow_enabled boolean not null default false,
  scope_mode text not null default 'off',
  enforce_enabled boolean not null default false,
  business_actions_enabled boolean not null default false,
  lifecycle_actions_enabled boolean not null default false,
  replacement_enabled boolean not null default false,
  notifications_enabled boolean not null default false,
  archiving_enabled boolean not null default false,
  premium_replacement_enabled boolean not null default false,
  auto_killed boolean not null default false,
  auto_kill_reason text,
  auto_killed_at timestamptz,
  auto_kill_metrics_safe jsonb not null default '{}'::jsonb,
  human_reenable_required boolean not null default false,
  config_version bigint not null default 1,
  cursor_target_id uuid,
  scan_count bigint not null default 0,
  last_completed_scan_at timestamptz,
  caps_safe jsonb not null default jsonb_build_object(
    'batch_size',25,
    'retries',1,
    'pipeline_duration_ms',3000,
    'assessments_global_day',1000,
    'assessments_account_day',250,
    'global_concurrency',1
  ),
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration',
  constraint ct_target_lifecycle_runtime_singleton_check check (id='global'),
  constraint ct_target_lifecycle_runtime_scope_check check (scope_mode in ('off','all_active_accounts')),
  constraint ct_target_lifecycle_runtime_shadow_only_check check (
    enforce_enabled is false and business_actions_enabled is false and lifecycle_actions_enabled is false
    and replacement_enabled is false and notifications_enabled is false and archiving_enabled is false
    and premium_replacement_enabled is false
  ),
  constraint ct_target_lifecycle_runtime_autokill_check check (
    (not auto_killed and auto_killed_at is null and auto_kill_reason is null)
    or (auto_killed and auto_killed_at is not null and char_length(btrim(auto_kill_reason)) between 1 and 160)
  ),
  constraint ct_target_lifecycle_runtime_json_check check (
    jsonb_typeof(caps_safe)='object' and jsonb_typeof(auto_kill_metrics_safe)='object'
  )
);

insert into public.ct_target_lifecycle_runtime_state(id) values ('global') on conflict (id) do nothing;

create table public.ct_target_lifecycle_processing_checkpoints (
  assessment_key text primary key,
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  target_id uuid not null references public.ig_targets(id) on delete restrict,
  source_fingerprint text not null,
  assessment_id uuid not null references public.ct_target_lifecycle_assessments(id) on delete restrict,
  status text not null,
  processor_release text,
  processed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ct_target_lifecycle_checkpoint_tenant_account_fkey foreign key (tenant_id,account_id)
    references public.client_instagram_accounts(client_id,account_id) on delete restrict,
  constraint ct_target_lifecycle_checkpoint_account_target_fkey foreign key (account_id,target_id)
    references public.ig_targets(account_id,id) on delete restrict,
  constraint ct_target_lifecycle_checkpoint_key_check check (char_length(btrim(assessment_key)) between 8 and 200),
  constraint ct_target_lifecycle_checkpoint_fingerprint_check check (char_length(btrim(source_fingerprint)) between 16 and 128),
  constraint ct_target_lifecycle_checkpoint_status_check check (status in ('processed','deduplicated','out_of_order_skipped','version_regression_skipped'))
);

create table public.ct_target_lifecycle_pipeline_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null unique,
  counters_safe jsonb not null default '{}'::jsonb,
  latency_ms numeric(12,3) not null,
  latency_p50_ms numeric(12,3) not null,
  latency_p95_ms numeric(12,3) not null,
  cpu_ms numeric(12,3) not null,
  memory_before_bytes bigint not null,
  memory_after_bytes bigint not null,
  created_at timestamptz not null default now(),
  constraint ct_target_lifecycle_metrics_key_check check (char_length(btrim(metric_key)) between 8 and 200),
  constraint ct_target_lifecycle_metrics_json_check check (jsonb_typeof(counters_safe)='object'),
  constraint ct_target_lifecycle_metrics_nonnegative_check check (
    latency_ms>=0 and latency_p50_ms>=0 and latency_p95_ms>=0 and cpu_ms>=0
    and memory_before_bytes>=0 and memory_after_bytes>=0
  ),
  constraint ct_target_lifecycle_metrics_no_actions_check check (
    coalesce((counters_safe->>'business_actions')::integer,0)=0
    and coalesce((counters_safe->>'notifications')::integer,0)=0
    and coalesce((counters_safe->>'archives')::integer,0)=0
    and coalesce((counters_safe->>'replacements')::integer,0)=0
  )
);

create table public.ct_target_lifecycle_alert_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  severity text not null,
  reason_code text not null,
  source_component text not null,
  metrics_safe jsonb not null default '{}'::jsonb,
  requires_human_review boolean not null default true,
  acknowledged_at timestamptz,
  acknowledged_by text,
  created_at timestamptz not null default now(),
  constraint ct_target_lifecycle_alert_severity_check check (severity in ('warning','critical')),
  constraint ct_target_lifecycle_alert_reason_check check (char_length(btrim(reason_code)) between 1 and 160),
  constraint ct_target_lifecycle_alert_source_check check (char_length(btrim(source_component)) between 1 and 120),
  constraint ct_target_lifecycle_alert_json_check check (jsonb_typeof(metrics_safe)='object')
);

create table public.ct_target_lifecycle_cap_counters (
  business_date date not null,
  bucket_scope text not null,
  scope_key text not null,
  counter_value integer not null default 0,
  limit_value integer not null,
  updated_at timestamptz not null default now(),
  primary key (business_date,bucket_scope,scope_key),
  constraint ct_target_lifecycle_cap_scope_check check (bucket_scope in ('global','account')),
  constraint ct_target_lifecycle_cap_key_check check (char_length(btrim(scope_key)) between 1 and 100),
  constraint ct_target_lifecycle_cap_values_check check (
    counter_value between 0 and 1000000 and limit_value between 1 and 1000000 and counter_value<=limit_value
  )
);

create table public.ct_target_lifecycle_pipeline_leases (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  batch_key text not null unique,
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ct_target_lifecycle_lease_worker_check check (char_length(btrim(worker_id)) between 1 and 120),
  constraint ct_target_lifecycle_lease_batch_check check (char_length(btrim(batch_key)) between 8 and 200),
  constraint ct_target_lifecycle_lease_window_check check (
    lease_expires_at>created_at and lease_expires_at<=created_at+interval '5 minutes'
  )
);

create index ct_target_lifecycle_assessments_source_idx
  on public.ct_target_lifecycle_assessments(tenant_id,account_id,target_id,source_max_observed_at desc,engine_revision desc);
create index ct_target_lifecycle_current_status_idx
  on public.ct_target_lifecycle_current(status,updated_at desc);
create index ct_target_lifecycle_checkpoint_scope_idx
  on public.ct_target_lifecycle_processing_checkpoints(tenant_id,account_id,target_id,processed_at desc);
create index ct_target_lifecycle_metrics_created_idx
  on public.ct_target_lifecycle_pipeline_metrics(created_at desc);
create index ct_target_lifecycle_alert_open_idx
  on public.ct_target_lifecycle_alert_events(created_at desc) where acknowledged_at is null;
create index ct_target_lifecycle_leases_live_idx
  on public.ct_target_lifecycle_pipeline_leases(lease_expires_at);

create trigger ct_target_lifecycle_pipeline_metrics_append_only
before update or delete on public.ct_target_lifecycle_pipeline_metrics
for each row execute function public.ct_reject_append_only_mutation_v1();

create or replace function public.list_target_lifecycle_work_v1(
  p_after_target_id uuid default null,
  p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_rows jsonb;
  v_next_cursor uuid;
  v_wrapped boolean := false;
begin
  perform public.ct_assert_service_role_v1();
  if p_limit not between 1 and 100 then raise exception 'target_lifecycle_limit_invalid'; end if;

  with candidates as (
    select cia.client_id tenant_id,cia.account_id,t.id target_id,
      coalesce(nullif(lower(btrim(t.normalized_username)),''),lower(btrim(t.target_username))) normalized_username,
      t.updated_at target_updated_at,t.followers_count,
      coalesce(t.provider_checked_at,t.metrics_updated_at,t.updated_at) denominator_observed_at,
      t.follows_sent_count,t.followbacks_count,t.followback_ratio,
      coalesce(t.metrics_updated_at,t.updated_at) metrics_observed_at,
      t.followbacks_metrics_reliable_at performance_reliable_at,
      coalesce(ep.unique_profiles_evaluated,0) unique_profiles_evaluated,
      ep.last_evaluated_at,
      (t.last_exhausted_at is not null and nullif(btrim(t.exhaustion_reason),'') is not null) terminal_proof,
      ac.assessment_id availability_assessment_id,ac.availability_status,
      coalesce(ac.confidence,'unknown') availability_confidence,ac.identity_status availability_identity_status,
      ac.latest_observation_at availability_latest_observation_at,ac.valid_until availability_valid_until,
      coalesce(ac.reason_codes,'{}'::text[]) availability_reason_codes,
      ic.domain_identity_status identity_status,lc.status lifecycle_status
    from public.client_instagram_accounts cia
    join public.clients c on c.id=cia.client_id and c.status='active'
    join public.ig_accounts ia on ia.id=cia.account_id and ia.archived_at is null and ia.trashed_at is null
      and ia.admin_lifecycle_status='active'
    join public.ig_targets t on t.account_id=cia.account_id and t.archived_at is null and t.deleted_at is null
    left join lateral (
      select count(*)::integer unique_profiles_evaluated,max(first_evaluated_at) last_evaluated_at
      from public.ct_target_evaluated_profiles e
      where e.tenant_id=cia.client_id and e.account_id=cia.account_id and e.target_id=t.id
    ) ep on true
    left join public.ct_target_availability_current ac
      on ac.tenant_id=cia.client_id and ac.account_id=cia.account_id and ac.target_id=t.id
    left join public.ct_target_identity_current ic
      on ic.tenant_id=cia.client_id and ic.account_id=cia.account_id and ic.target_id=t.id
    left join public.ct_target_lifecycle_current lcur
      on lcur.tenant_id=cia.client_id and lcur.account_id=cia.account_id and lcur.target_id=t.id
    left join public.ct_target_lifecycle_assessments lc on lc.id=lcur.assessment_id
    where cia.active and cia.onboarding_status='ready' and cia.provisioning_status='ready' and cia.login_status='connected'
      and (p_after_target_id is null or t.id>p_after_target_id)
    order by t.id
    limit p_limit
  )
  select coalesce(jsonb_agg(to_jsonb(candidates) order by target_id),'[]'::jsonb),
    (array_agg(target_id order by target_id desc))[1]
    into v_rows,v_next_cursor from candidates;

  if jsonb_array_length(v_rows)=0 and p_after_target_id is not null then
    v_wrapped := true;
    with candidates as (
      select cia.client_id tenant_id,cia.account_id,t.id target_id,
        coalesce(nullif(lower(btrim(t.normalized_username)),''),lower(btrim(t.target_username))) normalized_username,
        t.updated_at target_updated_at,t.followers_count,
        coalesce(t.provider_checked_at,t.metrics_updated_at,t.updated_at) denominator_observed_at,
        t.follows_sent_count,t.followbacks_count,t.followback_ratio,
        coalesce(t.metrics_updated_at,t.updated_at) metrics_observed_at,
        t.followbacks_metrics_reliable_at performance_reliable_at,
        coalesce(ep.unique_profiles_evaluated,0) unique_profiles_evaluated,
        ep.last_evaluated_at,
        (t.last_exhausted_at is not null and nullif(btrim(t.exhaustion_reason),'') is not null) terminal_proof,
        ac.assessment_id availability_assessment_id,ac.availability_status,
        coalesce(ac.confidence,'unknown') availability_confidence,ac.identity_status availability_identity_status,
        ac.latest_observation_at availability_latest_observation_at,ac.valid_until availability_valid_until,
        coalesce(ac.reason_codes,'{}'::text[]) availability_reason_codes,
        ic.domain_identity_status identity_status,lc.status lifecycle_status
      from public.client_instagram_accounts cia
      join public.clients c on c.id=cia.client_id and c.status='active'
      join public.ig_accounts ia on ia.id=cia.account_id and ia.archived_at is null and ia.trashed_at is null
        and ia.admin_lifecycle_status='active'
      join public.ig_targets t on t.account_id=cia.account_id and t.archived_at is null and t.deleted_at is null
      left join lateral (
        select count(*)::integer unique_profiles_evaluated,max(first_evaluated_at) last_evaluated_at
        from public.ct_target_evaluated_profiles e
        where e.tenant_id=cia.client_id and e.account_id=cia.account_id and e.target_id=t.id
      ) ep on true
      left join public.ct_target_availability_current ac
        on ac.tenant_id=cia.client_id and ac.account_id=cia.account_id and ac.target_id=t.id
      left join public.ct_target_identity_current ic
        on ic.tenant_id=cia.client_id and ic.account_id=cia.account_id and ic.target_id=t.id
      left join public.ct_target_lifecycle_current lcur
        on lcur.tenant_id=cia.client_id and lcur.account_id=cia.account_id and lcur.target_id=t.id
      left join public.ct_target_lifecycle_assessments lc on lc.id=lcur.assessment_id
      where cia.active and cia.onboarding_status='ready' and cia.provisioning_status='ready' and cia.login_status='connected'
      order by t.id limit p_limit
    )
    select coalesce(jsonb_agg(to_jsonb(candidates) order by target_id),'[]'::jsonb),
      (array_agg(target_id order by target_id desc))[1]
      into v_rows,v_next_cursor from candidates;
  end if;
  return jsonb_build_object('rows',v_rows,'next_cursor',v_next_cursor,'wrapped',v_wrapped);
end
$$;

create or replace function public.claim_target_lifecycle_assessment_capacity_v1(
  p_account_id uuid,
  p_target_id uuid,
  p_global_limit integer,
  p_account_limit integer,
  p_idempotency_key text
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_date date := (now() at time zone 'Africa/Johannesburg')::date;
  v_current integer;
begin
  perform public.ct_assert_service_role_v1();
  if p_account_id is null or p_target_id is null or char_length(btrim(coalesce(p_idempotency_key,''))) not between 8 and 200
    or p_global_limit not between 1 and 100000 or p_account_limit not between 1 and 10000 then return false; end if;
  if exists(select 1 from public.ct_target_lifecycle_assessments where account_id=p_account_id and target_id=p_target_id and assessment_key=p_idempotency_key) then return true; end if;
  perform pg_advisory_xact_lock(hashtext('ct_target_lifecycle_capacity_v1'));
  select counter_value into v_current from public.ct_target_lifecycle_cap_counters
    where business_date=v_date and bucket_scope='global' and scope_key='global';
  if coalesce(v_current,0)+1>p_global_limit then return false; end if;
  select counter_value into v_current from public.ct_target_lifecycle_cap_counters
    where business_date=v_date and bucket_scope='account' and scope_key=p_account_id::text;
  if coalesce(v_current,0)+1>p_account_limit then return false; end if;
  insert into public.ct_target_lifecycle_cap_counters(business_date,bucket_scope,scope_key,counter_value,limit_value)
  values (v_date,'global','global',1,p_global_limit),(v_date,'account',p_account_id::text,1,p_account_limit)
  on conflict(business_date,bucket_scope,scope_key) do update set
    counter_value=public.ct_target_lifecycle_cap_counters.counter_value+1,
    limit_value=least(public.ct_target_lifecycle_cap_counters.limit_value,excluded.limit_value),updated_at=now();
  return true;
end
$$;

create or replace function public.claim_target_lifecycle_pipeline_lease_v1(
  p_worker_id text,p_batch_key text,p_global_limit integer,p_ttl_seconds integer default 60
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare v_id uuid;
begin
  perform public.ct_assert_service_role_v1();
  if char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 120
    or char_length(btrim(coalesce(p_batch_key,''))) not between 8 and 200
    or p_global_limit not between 1 and 8 or p_ttl_seconds not between 15 and 300 then return null; end if;
  perform pg_advisory_xact_lock(hashtext('ct_target_lifecycle_lease_v1'));
  delete from public.ct_target_lifecycle_pipeline_leases where lease_expires_at<=now();
  if exists(select 1 from public.ct_target_lifecycle_pipeline_leases where batch_key=btrim(p_batch_key)) then return null; end if;
  if (select count(*) from public.ct_target_lifecycle_pipeline_leases where lease_expires_at>now())>=p_global_limit then return null; end if;
  insert into public.ct_target_lifecycle_pipeline_leases(worker_id,batch_key,lease_expires_at)
  values(btrim(p_worker_id),btrim(p_batch_key),now()+make_interval(secs=>p_ttl_seconds)) returning id into v_id;
  return v_id;
end
$$;

create or replace function public.release_target_lifecycle_pipeline_lease_v1(p_lease_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform public.ct_assert_service_role_v1();
  delete from public.ct_target_lifecycle_pipeline_leases where id=p_lease_id;
  return found;
end
$$;

create or replace function public.persist_target_lifecycle_shadow_v1(
  p_bundle jsonb,p_processor_release text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant_id uuid := nullif(p_bundle->>'tenant_id','')::uuid;
  v_account_id uuid := nullif(p_bundle->>'account_id','')::uuid;
  v_target_id uuid := nullif(p_bundle->>'target_id','')::uuid;
  v_assessment_key text := btrim(coalesce(p_bundle->>'assessment_key',''));
  v_assessment_id uuid;
  v_existing_id uuid;
  v_existing_source_at timestamptz;
  v_existing_engine_revision integer;
  v_existing_policy_revision integer;
  v_source_at timestamptz := nullif(p_bundle->>'source_max_observed_at','')::timestamptz;
  v_engine_revision integer := coalesce((p_bundle->>'engine_revision')::integer,0);
  v_policy_revision integer := coalesce((p_bundle->>'policy_revision')::integer,0);
  v_created boolean := false;
  v_outcome text := 'processed';
  v_perf jsonb := coalesce(p_bundle->'performance_observation','{}'::jsonb);
begin
  perform public.ct_assert_service_role_v1();
  if jsonb_typeof(coalesce(p_bundle,'{}'::jsonb))<>'object' then raise exception 'target_lifecycle_bundle_invalid'; end if;
  if coalesce((p_bundle->>'enforcement_allowed')::boolean,true)
    or coalesce((p_bundle->>'business_action_allowed')::boolean,true)
    or coalesce((p_bundle->>'mutation_executed')::boolean,true) then raise exception 'target_lifecycle_business_action_forbidden'; end if;
  if not exists(
    select 1 from public.ct_target_lifecycle_runtime_state s where s.id='global'
      and s.producer_enabled and s.current_projector_enabled and s.shadow_enabled and s.scope_mode='all_active_accounts'
      and not s.auto_killed and not s.human_reenable_required
      and not s.enforce_enabled and not s.business_actions_enabled and not s.lifecycle_actions_enabled
      and not s.replacement_enabled and not s.notifications_enabled and not s.archiving_enabled and not s.premium_replacement_enabled
  ) then raise exception 'target_lifecycle_shadow_inactive'; end if;
  if not exists(
    select 1 from public.client_instagram_accounts cia
    join public.clients c on c.id=cia.client_id and c.status='active'
    join public.ig_accounts ia on ia.id=cia.account_id and ia.archived_at is null and ia.trashed_at is null and ia.admin_lifecycle_status='active'
    where cia.client_id=v_tenant_id and cia.account_id=v_account_id and cia.active
      and cia.onboarding_status='ready' and cia.provisioning_status='ready' and cia.login_status='connected'
  ) then return jsonb_build_object('outcome','cross_tenant_rejected'); end if;
  if not exists(select 1 from public.ig_targets t where t.id=v_target_id and t.account_id=v_account_id and t.archived_at is null and t.deleted_at is null)
    then return jsonb_build_object('outcome','cross_tenant_rejected'); end if;
  if char_length(v_assessment_key) not between 8 and 200 or v_source_at is null
    or v_engine_revision<1 or v_policy_revision<1 then
    raise exception 'target_lifecycle_bundle_incomplete';
  end if;

  insert into public.ct_target_performance_observations(
    tenant_id,account_id,source_target_id,business_date,window_kind,follows,followbacks,reliability,reason,observed_at,source_event_key,metadata_safe
  ) values (
    v_tenant_id,v_account_id,v_target_id,(nullif(v_perf->>'observed_at','')::timestamptz at time zone 'Africa/Johannesburg')::date,'lifetime',
    coalesce((v_perf->>'follows')::integer,0),coalesce((v_perf->>'followbacks')::integer,0),coalesce(v_perf->>'reliability','unknown'),
    coalesce(v_perf->>'reason','legacy_counter'),nullif(v_perf->>'observed_at','')::timestamptz,btrim(v_perf->>'source_event_key'),coalesce(v_perf->'metadata_safe','{}'::jsonb)
  ) on conflict(tenant_id,account_id,source_target_id,source_event_key) do nothing;

  insert into public.ct_target_lifecycle_assessments(
    tenant_id,account_id,target_id,assessment_key,status,utilization_ratio,unique_profiles_evaluated,estimated_exploitable_audience,
    denominator_source,denominator_version,confidence,reason_codes,replacement_state,assessed_at,archived_at,archive_reason,
    availability_status,performance_status,utilization_status,identity_status,source_fingerprint,source_availability_assessment_id,
    source_max_observed_at,missing_evidence,recommended_action,valid_until,engine_version,rule_version,policy_version,
    engine_revision,policy_revision,explanation_safe,enforcement_allowed,business_action_allowed,mutation_executed,processor_release
  ) values (
    v_tenant_id,v_account_id,v_target_id,v_assessment_key,p_bundle->>'status',nullif(p_bundle->>'utilization_ratio','')::numeric,
    coalesce((p_bundle->>'unique_profiles_evaluated')::integer,0),nullif(p_bundle->>'estimated_exploitable_audience','')::integer,
    p_bundle->>'denominator_source',p_bundle->>'denominator_version',p_bundle->>'confidence',
    coalesce(array(select jsonb_array_elements_text(coalesce(p_bundle->'reason_codes','[]'::jsonb))),'{}'::text[]),
    coalesce(p_bundle->>'replacement_state','none'),nullif(p_bundle->>'assessed_at','')::timestamptz,null,null,
    p_bundle->>'availability_status',p_bundle->>'performance_status',p_bundle->>'utilization_status',p_bundle->>'identity_status',
    p_bundle->>'source_fingerprint',nullif(p_bundle->>'source_availability_assessment_id','')::uuid,v_source_at,
    coalesce(array(select jsonb_array_elements_text(coalesce(p_bundle->'missing_evidence','[]'::jsonb))),'{}'::text[]),
    p_bundle->>'recommended_action',nullif(p_bundle->>'valid_until','')::timestamptz,p_bundle->>'engine_version',p_bundle->>'rule_version',
    p_bundle->>'policy_version',v_engine_revision,v_policy_revision,
    coalesce(p_bundle->'explanation_safe','{}'::jsonb),false,false,false,nullif(btrim(p_processor_release),'')
  ) on conflict(tenant_id,account_id,target_id,assessment_key) do nothing returning id into v_assessment_id;
  if v_assessment_id is null then
    select id into v_assessment_id from public.ct_target_lifecycle_assessments
      where tenant_id=v_tenant_id and account_id=v_account_id and target_id=v_target_id and assessment_key=v_assessment_key;
    if v_assessment_id is null then raise exception 'target_lifecycle_idempotency_payload_mismatch'; end if;
    v_outcome := 'deduplicated';
  else v_created := true;
  end if;

  select c.assessment_id,a.source_max_observed_at,a.engine_revision,a.policy_revision
    into v_existing_id,v_existing_source_at,v_existing_engine_revision,v_existing_policy_revision
  from public.ct_target_lifecycle_current c join public.ct_target_lifecycle_assessments a on a.id=c.assessment_id
  where c.tenant_id=v_tenant_id and c.account_id=v_account_id and c.target_id=v_target_id for update of c;
  if v_existing_id is not null then
    if coalesce(v_existing_engine_revision,0)>v_engine_revision
      or (coalesce(v_existing_engine_revision,0)=v_engine_revision and coalesce(v_existing_policy_revision,0)>v_policy_revision)
      then v_outcome:='version_regression_skipped';
    elsif v_existing_source_at is not null and v_existing_source_at>v_source_at then v_outcome:='out_of_order_skipped';
    elsif v_existing_id=v_assessment_id then v_outcome:='deduplicated';
    else
      update public.ct_target_lifecycle_current set assessment_id=v_assessment_id,status=p_bundle->>'status',source_max_observed_at=v_source_at,
        engine_version=p_bundle->>'engine_version',policy_version=p_bundle->>'policy_version',engine_revision=v_engine_revision,
        policy_revision=v_policy_revision,updated_at=now()
      where tenant_id=v_tenant_id and account_id=v_account_id and target_id=v_target_id;
    end if;
  else
    insert into public.ct_target_lifecycle_current(
      tenant_id,account_id,target_id,assessment_id,status,source_max_observed_at,engine_version,policy_version,engine_revision,policy_revision,updated_at
    ) values (
      v_tenant_id,v_account_id,v_target_id,v_assessment_id,p_bundle->>'status',v_source_at,p_bundle->>'engine_version',p_bundle->>'policy_version',
      v_engine_revision,v_policy_revision,now()
    );
  end if;
  insert into public.ct_target_lifecycle_processing_checkpoints(
    assessment_key,tenant_id,account_id,target_id,source_fingerprint,assessment_id,status,processor_release,processed_at
  ) values (
    v_assessment_key,v_tenant_id,v_account_id,v_target_id,p_bundle->>'source_fingerprint',v_assessment_id,v_outcome,nullif(btrim(p_processor_release),''),now()
  ) on conflict(assessment_key) do nothing;
  return jsonb_build_object('outcome',v_outcome,'assessment_id',v_assessment_id,'assessment_created',v_created,'business_actions',0);
end
$$;

create or replace function public.advance_target_lifecycle_scan_cursor_v1(
  p_expected_config_version bigint,p_next_cursor uuid,p_wrapped boolean default false
)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform public.ct_assert_service_role_v1();
  update public.ct_target_lifecycle_runtime_state set cursor_target_id=p_next_cursor,
    scan_count=scan_count+case when p_wrapped then 1 else 0 end,
    last_completed_scan_at=case when p_wrapped then now() else last_completed_scan_at end,
    updated_at=now(),updated_by='backend_target_lifecycle_pipeline'
  where id='global' and config_version=p_expected_config_version and not auto_killed;
  return found;
end
$$;

create or replace function public.record_target_lifecycle_pipeline_metric_v1(
  p_metric_key text,p_counters_safe jsonb,p_latency_ms numeric,p_latency_p50_ms numeric,p_latency_p95_ms numeric,
  p_cpu_ms numeric,p_memory_before_bytes bigint,p_memory_after_bytes bigint
)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform public.ct_assert_service_role_v1();
  insert into public.ct_target_lifecycle_pipeline_metrics(
    metric_key,counters_safe,latency_ms,latency_p50_ms,latency_p95_ms,cpu_ms,memory_before_bytes,memory_after_bytes
  ) values (
    btrim(p_metric_key),coalesce(p_counters_safe,'{}'::jsonb),p_latency_ms,p_latency_p50_ms,p_latency_p95_ms,p_cpu_ms,p_memory_before_bytes,p_memory_after_bytes
  ) on conflict(metric_key) do nothing;
  return found;
end
$$;

create or replace function public.trigger_target_lifecycle_auto_kill_v1(
  p_reason text,p_source_component text,p_metrics_safe jsonb default '{}'::jsonb
)
returns public.ct_target_lifecycle_runtime_state
language plpgsql security definer set search_path='' as $$
declare v_state public.ct_target_lifecycle_runtime_state;v_key text;
begin
  perform public.ct_assert_service_role_v1();
  if char_length(btrim(coalesce(p_reason,''))) not between 1 and 160
    or char_length(btrim(coalesce(p_source_component,''))) not between 1 and 120
    or jsonb_typeof(coalesce(p_metrics_safe,'{}'::jsonb))<>'object' then raise exception 'target_lifecycle_auto_kill_input_invalid'; end if;
  update public.ct_target_lifecycle_runtime_state set producer_enabled=false,current_projector_enabled=false,shadow_enabled=false,
    scope_mode='off',auto_killed=true,auto_kill_reason=btrim(p_reason),auto_killed_at=coalesce(auto_killed_at,now()),
    auto_kill_metrics_safe=coalesce(p_metrics_safe,'{}'::jsonb),human_reenable_required=true,config_version=config_version+1,
    updated_at=now(),updated_by='auto_kill:'||btrim(p_source_component) where id='global' returning * into v_state;
  v_key:='target-lifecycle-auto-kill:'||encode(extensions.digest(
    btrim(p_reason)||':'||coalesce(v_state.auto_killed_at::text,''),'sha256'
  ),'hex');
  insert into public.ct_target_lifecycle_alert_events(event_key,severity,reason_code,source_component,metrics_safe,requires_human_review)
  values(v_key,'critical',btrim(p_reason),btrim(p_source_component),coalesce(p_metrics_safe,'{}'::jsonb),true) on conflict(event_key) do nothing;
  return v_state;
end
$$;

create or replace function public.activate_target_lifecycle_global_shadow_v1(
  p_expected_config_version bigint,p_actor text default 'operator'
)
returns public.ct_target_lifecycle_runtime_state
language plpgsql security definer set search_path='' as $$
declare v_state public.ct_target_lifecycle_runtime_state;
begin
  perform public.ct_assert_service_role_v1();
  update public.ct_target_lifecycle_runtime_state set producer_enabled=true,current_projector_enabled=true,shadow_enabled=true,
    scope_mode='all_active_accounts',cursor_target_id=null,enforce_enabled=false,business_actions_enabled=false,lifecycle_actions_enabled=false,
    replacement_enabled=false,notifications_enabled=false,archiving_enabled=false,premium_replacement_enabled=false,
    config_version=config_version+1,updated_at=now(),updated_by='activation:'||left(btrim(coalesce(p_actor,'operator')),100)
  where id='global' and config_version=p_expected_config_version and not auto_killed and not human_reenable_required returning * into v_state;
  if v_state.id is null then raise exception 'target_lifecycle_activation_compare_and_swap_failed'; end if;
  return v_state;
end
$$;

create or replace function public.deactivate_target_lifecycle_global_shadow_v1(p_actor text default 'operator')
returns public.ct_target_lifecycle_runtime_state
language plpgsql security definer set search_path='' as $$
declare v_state public.ct_target_lifecycle_runtime_state;
begin
  perform public.ct_assert_service_role_v1();
  update public.ct_target_lifecycle_runtime_state set producer_enabled=false,current_projector_enabled=false,shadow_enabled=false,
    scope_mode='off',cursor_target_id=null,config_version=config_version+1,updated_at=now(),
    updated_by='deactivation:'||left(btrim(coalesce(p_actor,'operator')),100) where id='global' returning * into v_state;
  return v_state;
end
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'ct_target_evaluation_events','ct_target_evaluated_profiles','ct_target_performance_observations','ct_target_performance_aggregates',
    'ct_target_lifecycle_assessments','ct_target_lifecycle_current','ct_target_lifecycle_runtime_state',
    'ct_target_lifecycle_processing_checkpoints','ct_target_lifecycle_pipeline_metrics','ct_target_lifecycle_alert_events',
    'ct_target_lifecycle_cap_counters','ct_target_lifecycle_pipeline_leases'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('alter table public.%I force row level security',v_table);
    execute format('revoke all on table public.%I from public,anon,authenticated',v_table);
  end loop;
end
$$;

create policy ct_target_lifecycle_runtime_state_service_role_all on public.ct_target_lifecycle_runtime_state to service_role using(true) with check(true);
create policy ct_target_lifecycle_processing_checkpoints_service_role_all on public.ct_target_lifecycle_processing_checkpoints to service_role using(true) with check(true);
create policy ct_target_lifecycle_pipeline_metrics_service_role_all on public.ct_target_lifecycle_pipeline_metrics to service_role using(true) with check(true);
create policy ct_target_lifecycle_alert_events_service_role_all on public.ct_target_lifecycle_alert_events to service_role using(true) with check(true);
create policy ct_target_lifecycle_cap_counters_service_role_all on public.ct_target_lifecycle_cap_counters to service_role using(true) with check(true);
create policy ct_target_lifecycle_pipeline_leases_service_role_all on public.ct_target_lifecycle_pipeline_leases to service_role using(true) with check(true);

revoke all on public.ct_target_evaluation_events,public.ct_target_evaluated_profiles,public.ct_target_performance_observations,
  public.ct_target_performance_aggregates,public.ct_target_lifecycle_assessments,public.ct_target_lifecycle_current from service_role;
grant select,insert on public.ct_target_evaluation_events,public.ct_target_evaluated_profiles,public.ct_target_performance_observations,
  public.ct_target_lifecycle_assessments to service_role;
grant select,insert,update on public.ct_target_performance_aggregates,public.ct_target_lifecycle_current to service_role;
grant select on public.ct_target_lifecycle_runtime_state,public.ct_target_lifecycle_processing_checkpoints,
  public.ct_target_lifecycle_pipeline_metrics,public.ct_target_lifecycle_alert_events,public.ct_target_lifecycle_cap_counters,
  public.ct_target_lifecycle_pipeline_leases to service_role;

do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.list_target_lifecycle_work_v1(uuid,integer)',
    'public.claim_target_lifecycle_assessment_capacity_v1(uuid,uuid,integer,integer,text)',
    'public.claim_target_lifecycle_pipeline_lease_v1(text,text,integer,integer)',
    'public.release_target_lifecycle_pipeline_lease_v1(uuid)',
    'public.persist_target_lifecycle_shadow_v1(jsonb,text)',
    'public.advance_target_lifecycle_scan_cursor_v1(bigint,uuid,boolean)',
    'public.record_target_lifecycle_pipeline_metric_v1(text,jsonb,numeric,numeric,numeric,numeric,bigint,bigint)',
    'public.trigger_target_lifecycle_auto_kill_v1(text,text,jsonb)',
    'public.activate_target_lifecycle_global_shadow_v1(bigint,text)',
    'public.deactivate_target_lifecycle_global_shadow_v1(text)'
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',v_signature);
    execute format('grant execute on function %s to service_role',v_signature);
  end loop;
end
$$;
