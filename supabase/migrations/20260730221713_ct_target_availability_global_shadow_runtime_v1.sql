-- Target Availability V1 global Shadow runtime foundations.
-- Additive only. This migration is deliberately dormant: the singleton state
-- remains OFF until the separately gated activation update after deployment.
-- No trigger or function in this file mutates ig_targets or performs lifecycle,
-- replacement, notification, archival, or any other business action.

create table public.ct_target_availability_runtime_state (
  id text primary key,
  capture_enabled boolean not null default false,
  writer_enabled boolean not null default false,
  identity_producer_enabled boolean not null default false,
  assessment_producer_enabled boolean not null default false,
  current_projector_enabled boolean not null default false,
  shadow_enabled boolean not null default false,
  scope_mode text not null default 'off',
  explicit_account_allowlist uuid[] not null default '{}'::uuid[],
  policy_shadow_enabled boolean not null default false,
  enforce_enabled boolean not null default false,
  lifecycle_enabled boolean not null default false,
  replacement_enabled boolean not null default false,
  notifications_enabled boolean not null default false,
  archiving_enabled boolean not null default false,
  auto_killed boolean not null default false,
  auto_kill_reason text,
  auto_killed_at timestamptz,
  auto_kill_metrics_safe jsonb not null default '{}'::jsonb,
  human_reenable_required boolean not null default false,
  config_version bigint not null default 1,
  caps_safe jsonb not null default jsonb_build_object(
    'observations_per_run', 40,
    'observations_per_account_day', 240,
    'observations_global_day', 2000,
    'identity_transitions_per_run', 20,
    'assessments_per_run', 40,
    'current_updates_per_run', 40,
    'retries', 1,
    'pipeline_duration_ms', 1500,
    'batch_size', 20,
    'worker_concurrency', 1,
    'global_concurrency', 4
  ),
  retention_safe jsonb not null default jsonb_build_object(
    'observations_days', 90,
    'identity_history_days', 730,
    'assessments_days', 365,
    'metrics_days', 90,
    'current_state_retained', true,
    'cleanup_enabled', false
  ),
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration',
  constraint ct_target_availability_runtime_state_singleton_check check (id = 'global'),
  constraint ct_target_availability_runtime_state_scope_check
    check (scope_mode in ('off','explicit_allowlist','all_active_accounts')),
  constraint ct_target_availability_runtime_state_allowlist_check check (
    cardinality(explicit_account_allowlist) between 0 and 1000
    and (scope_mode <> 'explicit_allowlist' or cardinality(explicit_account_allowlist) > 0)
  ),
  constraint ct_target_availability_runtime_state_no_business_actions_check check (
    policy_shadow_enabled is false and enforce_enabled is false
    and lifecycle_enabled is false and replacement_enabled is false
    and notifications_enabled is false and archiving_enabled is false
  ),
  constraint ct_target_availability_runtime_state_autokill_check check (
    (not auto_killed and auto_killed_at is null and auto_kill_reason is null)
    or (auto_killed and auto_killed_at is not null and char_length(btrim(auto_kill_reason)) between 1 and 160)
  ),
  constraint ct_target_availability_runtime_state_json_check check (
    jsonb_typeof(caps_safe) = 'object'
    and jsonb_typeof(retention_safe) = 'object'
    and jsonb_typeof(auto_kill_metrics_safe) = 'object'
  )
);

insert into public.ct_target_availability_runtime_state (id)
values ('global')
on conflict (id) do nothing;

create table public.ct_target_availability_processing_checkpoints (
  observation_id uuid primary key references public.ct_target_availability_observations(id) on delete restrict,
  tenant_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  target_id uuid not null references public.ig_targets(id) on delete restrict,
  status text not null,
  attempt_count integer not null default 1,
  engine_version text not null,
  rule_version text not null,
  policy_version text not null,
  processor_release text,
  error_code text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ct_target_availability_checkpoint_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_target_availability_checkpoint_account_target_fkey
    foreign key (account_id, target_id)
    references public.ig_targets(account_id, id) on delete restrict,
  constraint ct_target_availability_checkpoint_status_check
    check (status in ('processing','processed','rejected','failed')),
  constraint ct_target_availability_checkpoint_attempt_check check (attempt_count between 1 and 8),
  constraint ct_target_availability_checkpoint_error_check
    check (error_code is null or char_length(btrim(error_code)) between 1 and 160)
);

create table public.ct_target_availability_pipeline_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null unique,
  tenant_id uuid references public.clients(id) on delete restrict,
  account_id uuid references public.ig_accounts(id) on delete restrict,
  run_id uuid references public.ig_runs(id) on delete set null,
  component text not null,
  scope_mode text not null,
  counters_safe jsonb not null default '{}'::jsonb,
  latency_ms numeric(12,3),
  cpu_ms numeric(12,3),
  memory_before_bytes bigint,
  memory_peak_bytes bigint,
  memory_after_bytes bigint,
  retained_payload_count integer not null default 0,
  queue_depth integer not null default 0,
  created_at timestamptz not null default now(),
  constraint ct_target_availability_metrics_tenant_account_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint ct_target_availability_metrics_component_check check (
    component in ('observation_writer','identity_producer','assessment_producer','current_projector','pipeline','auto_kill','circuit_breaker','memory_probe')
  ),
  constraint ct_target_availability_metrics_scope_check
    check (scope_mode in ('off','explicit_allowlist','all_active_accounts')),
  constraint ct_target_availability_metrics_key_check
    check (char_length(btrim(metric_key)) between 8 and 200),
  constraint ct_target_availability_metrics_json_check check (jsonb_typeof(counters_safe) = 'object'),
  constraint ct_target_availability_metrics_numbers_check check (
    (latency_ms is null or latency_ms >= 0)
    and (cpu_ms is null or cpu_ms >= 0)
    and (memory_before_bytes is null or memory_before_bytes >= 0)
    and (memory_peak_bytes is null or memory_peak_bytes >= 0)
    and (memory_after_bytes is null or memory_after_bytes >= 0)
    and retained_payload_count = 0
    and queue_depth between 0 and 2000
  )
);

create table public.ct_target_availability_alert_events (
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
  constraint ct_target_availability_alert_severity_check check (severity in ('warning','critical')),
  constraint ct_target_availability_alert_reason_check
    check (char_length(btrim(reason_code)) between 1 and 160),
  constraint ct_target_availability_alert_source_check
    check (char_length(btrim(source_component)) between 1 and 100),
  constraint ct_target_availability_alert_metrics_check check (jsonb_typeof(metrics_safe) = 'object')
);

create table public.ct_target_availability_cap_counters (
  business_date date not null,
  bucket_scope text not null,
  scope_key text not null,
  metric_name text not null,
  counter_value integer not null default 0,
  limit_value integer not null,
  updated_at timestamptz not null default now(),
  primary key (business_date, bucket_scope, scope_key, metric_name),
  constraint ct_target_availability_cap_scope_check check (bucket_scope in ('global','account','run')),
  constraint ct_target_availability_cap_key_check check (char_length(btrim(scope_key)) between 1 and 100),
  constraint ct_target_availability_cap_metric_check
    check (metric_name in ('observations','identity_transitions','assessments','current_updates')),
  constraint ct_target_availability_cap_value_check
    check (counter_value between 0 and 1000000 and limit_value between 1 and 1000000 and counter_value <= limit_value)
);

create table public.ct_target_availability_pipeline_leases (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  batch_key text not null unique,
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ct_target_availability_pipeline_lease_worker_check
    check (char_length(btrim(worker_id)) between 1 and 120),
  constraint ct_target_availability_pipeline_lease_batch_check
    check (char_length(btrim(batch_key)) between 8 and 200),
  constraint ct_target_availability_pipeline_lease_window_check
    check (lease_expires_at > created_at and lease_expires_at <= created_at + interval '5 minutes')
);

create index ct_target_availability_checkpoint_scope_idx
  on public.ct_target_availability_processing_checkpoints (tenant_id, account_id, target_id, processed_at desc);
create index ct_target_availability_checkpoint_status_idx
  on public.ct_target_availability_processing_checkpoints (status, updated_at desc);
create index ct_target_availability_metrics_created_idx
  on public.ct_target_availability_pipeline_metrics (created_at desc);
create index ct_target_availability_metrics_account_idx
  on public.ct_target_availability_pipeline_metrics (tenant_id, account_id, created_at desc)
  where account_id is not null;
create index ct_target_availability_metrics_run_idx
  on public.ct_target_availability_pipeline_metrics (run_id, created_at desc)
  where run_id is not null;
create index ct_target_availability_alert_open_idx
  on public.ct_target_availability_alert_events (created_at desc)
  where acknowledged_at is null;
create index ct_target_availability_leases_live_idx
  on public.ct_target_availability_pipeline_leases (lease_expires_at);

create trigger ct_target_availability_pipeline_metrics_append_only
before update or delete on public.ct_target_availability_pipeline_metrics
for each row execute function public.ct_reject_append_only_mutation_v1();

create or replace function public.claim_target_availability_observation_capacity_v1(
  p_account_id uuid,
  p_run_id uuid,
  p_global_limit integer,
  p_account_limit integer,
  p_run_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_date date := (now() at time zone 'Africa/Johannesburg')::date;
  v_run_key text := coalesce(p_run_id::text, 'no-run');
  v_current integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_account_id is null or p_global_limit not between 1 and 1000000
    or p_account_limit not between 1 and 1000000 or p_run_limit not between 1 and 1000000 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('ct_target_availability_capacity_v1'));
  select counter_value into v_current from public.ct_target_availability_cap_counters
    where business_date=v_date and bucket_scope='global' and scope_key='global' and metric_name='observations';
  if coalesce(v_current, 0) + 1 > p_global_limit then return false; end if;
  select counter_value into v_current from public.ct_target_availability_cap_counters
    where business_date=v_date and bucket_scope='account' and scope_key=p_account_id::text and metric_name='observations';
  if coalesce(v_current, 0) + 1 > p_account_limit then return false; end if;
  select counter_value into v_current from public.ct_target_availability_cap_counters
    where business_date=v_date and bucket_scope='run' and scope_key=v_run_key and metric_name='observations';
  if coalesce(v_current, 0) + 1 > p_run_limit then return false; end if;

  insert into public.ct_target_availability_cap_counters
    (business_date,bucket_scope,scope_key,metric_name,counter_value,limit_value)
  values
    (v_date,'global','global','observations',1,p_global_limit),
    (v_date,'account',p_account_id::text,'observations',1,p_account_limit),
    (v_date,'run',v_run_key,'observations',1,p_run_limit)
  on conflict (business_date,bucket_scope,scope_key,metric_name) do update
    set counter_value=public.ct_target_availability_cap_counters.counter_value+1,
        limit_value=least(public.ct_target_availability_cap_counters.limit_value,excluded.limit_value),
        updated_at=now();
  return true;
end;
$$;

create or replace function public.claim_target_availability_pipeline_lease_v1(
  p_worker_id text,
  p_batch_key text,
  p_global_limit integer,
  p_ttl_seconds integer default 30
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 120
    or char_length(btrim(coalesce(p_batch_key,''))) not between 8 and 200
    or p_global_limit not between 1 and 64 or p_ttl_seconds not between 5 and 300 then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('ct_target_availability_pipeline_lease_v1'));
  delete from public.ct_target_availability_pipeline_leases where lease_expires_at <= now();
  select id into v_id from public.ct_target_availability_pipeline_leases where batch_key=p_batch_key;
  if v_id is not null then return null; end if;
  if (select count(*) from public.ct_target_availability_pipeline_leases where lease_expires_at>now()) >= p_global_limit then
    return null;
  end if;
  insert into public.ct_target_availability_pipeline_leases (worker_id,batch_key,lease_expires_at)
  values (btrim(p_worker_id),btrim(p_batch_key),now()+make_interval(secs=>p_ttl_seconds)) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.claim_target_availability_projection_capacity_v1(
  p_account_id uuid,
  p_run_id uuid,
  p_identity_count integer,
  p_assessment_count integer,
  p_current_count integer,
  p_identity_run_limit integer,
  p_assessment_run_limit integer,
  p_current_run_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_date date := (now() at time zone 'Africa/Johannesburg')::date;
  v_run_key text := coalesce(p_run_id::text, 'no-run:'||coalesce(p_account_id::text,'missing-account'));
  v_metric text;
  v_increment integer;
  v_limit integer;
  v_current integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_account_id is null
    or p_identity_count not between 0 and 500 or p_assessment_count not between 0 and 500 or p_current_count not between 0 and 500
    or p_identity_run_limit not between 1 and 500 or p_assessment_run_limit not between 1 and 500 or p_current_run_limit not between 1 and 500 then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext('ct_target_availability_projection_capacity_v1:'||v_run_key));
  foreach v_metric in array array['identity_transitions','assessments','current_updates'] loop
    v_increment := case v_metric when 'identity_transitions' then p_identity_count when 'assessments' then p_assessment_count else p_current_count end;
    v_limit := case v_metric when 'identity_transitions' then p_identity_run_limit when 'assessments' then p_assessment_run_limit else p_current_run_limit end;
    select counter_value into v_current from public.ct_target_availability_cap_counters
      where business_date=v_date and bucket_scope='run' and scope_key=v_run_key and metric_name=v_metric;
    if coalesce(v_current,0)+v_increment > v_limit then return false; end if;
  end loop;
  insert into public.ct_target_availability_cap_counters
    (business_date,bucket_scope,scope_key,metric_name,counter_value,limit_value)
  values
    (v_date,'run',v_run_key,'identity_transitions',p_identity_count,p_identity_run_limit),
    (v_date,'run',v_run_key,'assessments',p_assessment_count,p_assessment_run_limit),
    (v_date,'run',v_run_key,'current_updates',p_current_count,p_current_run_limit)
  on conflict (business_date,bucket_scope,scope_key,metric_name) do update
    set counter_value=public.ct_target_availability_cap_counters.counter_value+excluded.counter_value,
        limit_value=least(public.ct_target_availability_cap_counters.limit_value,excluded.limit_value),
        updated_at=now();
  return true;
end;
$$;

create or replace function public.release_target_availability_pipeline_lease_v1(p_lease_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  delete from public.ct_target_availability_pipeline_leases where id=p_lease_id;
  return found;
end;
$$;

create or replace function public.trigger_target_availability_auto_kill_v1(
  p_reason text,
  p_source_component text,
  p_metrics_safe jsonb default '{}'::jsonb
)
returns public.ct_target_availability_runtime_state
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state public.ct_target_availability_runtime_state;
  v_event_key text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 1 and 160
    or char_length(btrim(coalesce(p_source_component,''))) not between 1 and 100
    or jsonb_typeof(coalesce(p_metrics_safe,'{}'::jsonb)) <> 'object' then
    raise exception 'target_availability_auto_kill_input_invalid';
  end if;
  update public.ct_target_availability_runtime_state set
    capture_enabled=false,
    writer_enabled=false,
    identity_producer_enabled=false,
    assessment_producer_enabled=false,
    current_projector_enabled=false,
    shadow_enabled=false,
    scope_mode='off',
    explicit_account_allowlist='{}'::uuid[],
    auto_killed=true,
    auto_kill_reason=btrim(p_reason),
    auto_killed_at=coalesce(auto_killed_at,now()),
    auto_kill_metrics_safe=coalesce(p_metrics_safe,'{}'::jsonb),
    human_reenable_required=true,
    config_version=config_version+1,
    updated_at=now(),
    updated_by='auto_kill:'||btrim(p_source_component)
  where id='global'
  returning * into v_state;
  v_event_key := 'target-availability-auto-kill:'||encode(digest(btrim(p_reason)||':'||coalesce(v_state.auto_killed_at::text,''),'sha256'),'hex');
  insert into public.ct_target_availability_alert_events
    (event_key,severity,reason_code,source_component,metrics_safe,requires_human_review)
  values (v_event_key,'critical',btrim(p_reason),btrim(p_source_component),coalesce(p_metrics_safe,'{}'::jsonb),true)
  on conflict (event_key) do nothing;
  return v_state;
end;
$$;

create or replace function public.persist_target_availability_pipeline_v1(
  p_observation_id uuid,
  p_bundle jsonb,
  p_processor_release text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_observation public.ct_target_availability_observations;
  v_transition jsonb := p_bundle->'transition';
  v_identity jsonb := p_bundle->'identity';
  v_assessment jsonb := p_bundle->'assessment';
  v_current jsonb := p_bundle->'current';
  v_metric jsonb := p_bundle->'metric';
  v_history_id uuid;
  v_assessment_id uuid;
  v_existing public.ct_target_availability_current;
  v_row_count integer := 0;
  v_current_outcome text := 'unchanged';
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_observation_id is null or jsonb_typeof(p_bundle) <> 'object' then
    raise exception 'target_availability_pipeline_bundle_invalid';
  end if;
  select * into v_observation from public.ct_target_availability_observations where id=p_observation_id;
  if not found then raise exception 'target_availability_observation_missing'; end if;
  if exists (select 1 from public.ct_target_availability_processing_checkpoints where observation_id=p_observation_id and status='processed') then
    return jsonb_build_object('outcome','deduplicated','observation_id',p_observation_id);
  end if;
  if not exists (
    select 1 from public.client_instagram_accounts cia
    join public.ig_accounts a on a.id=cia.account_id
    join public.ig_targets t on t.id=v_observation.target_id and t.account_id=a.id
    where cia.client_id=v_observation.tenant_id and cia.account_id=v_observation.account_id
      and cia.active is true and cia.onboarding_status='ready' and cia.provisioning_status='ready' and cia.login_status='connected'
      and a.archived_at is null and a.trashed_at is null and coalesce(a.admin_lifecycle_status,'active')='active'
      and t.archived_at is null and t.deleted_at is null
  ) then
    raise exception 'target_availability_scope_not_active';
  end if;
  if (v_identity->>'tenantId')::uuid<>v_observation.tenant_id
    or (v_identity->>'accountId')::uuid<>v_observation.account_id
    or (v_identity->>'targetId')::uuid<>v_observation.target_id
    or (v_assessment->>'tenantId')::uuid<>v_observation.tenant_id
    or (v_assessment->>'accountId')::uuid<>v_observation.account_id
    or (v_assessment->>'targetId')::uuid<>v_observation.target_id
    or (v_current->>'tenantId')::uuid<>v_observation.tenant_id
    or (v_current->>'accountId')::uuid<>v_observation.account_id
    or (v_current->>'targetId')::uuid<>v_observation.target_id then
    raise exception 'target_availability_cross_tenant_or_scope_mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_observation.tenant_id::text||':'||v_observation.account_id::text||':'||v_observation.target_id::text));

  insert into public.ct_target_availability_processing_checkpoints
    (observation_id,tenant_id,account_id,target_id,status,attempt_count,engine_version,rule_version,policy_version,processor_release)
  values (
    p_observation_id,v_observation.tenant_id,v_observation.account_id,v_observation.target_id,'processing',1,
    v_assessment->>'engineVersion',v_assessment->>'ruleVersion',v_current->>'policyVersion',nullif(btrim(p_processor_release),'')
  )
  on conflict (observation_id) do update set
    status='processing',attempt_count=least(8,public.ct_target_availability_processing_checkpoints.attempt_count+1),
    error_code=null,updated_at=now(),processor_release=excluded.processor_release;

  begin
  if v_transition is not null and jsonb_typeof(v_transition)='object' then
    v_history_id := (v_transition->>'transitionId')::uuid;
    insert into public.ct_target_identity_history (
      id,tenant_id,account_id,target_id,observation_id,previous_username,observed_username,
      stable_platform_user_id,resolution,confidence,reason_codes,idempotency_key,observed_at,
      transition_type_v3,evidence_count,first_observed_at,last_observed_at,source_observation_ids,rule_version,engine_version
    ) values (
      v_history_id,v_observation.tenant_id,v_observation.account_id,v_observation.target_id,p_observation_id,
      v_transition->>'previousUsername',nullif(v_transition->>'observedUsername',''),nullif(v_transition->>'stablePlatformUserId',''),
      case v_transition->>'transitionType' when 'identity_confirmed' then 'unchanged' when 'username_change_confirmed' then 'matched_rename' when 'identity_conflict' then 'conflict' else 'unresolved' end,
      v_transition->>'confidence',array[v_transition->>'transitionType'],'target-identity-transition:'||(v_transition->>'transitionId'),
      (v_transition->>'lastObservedAt')::timestamptz,v_transition->>'transitionType',(v_transition->>'evidenceCount')::integer,
      (v_transition->>'firstObservedAt')::timestamptz,(v_transition->>'lastObservedAt')::timestamptz,
      array(select jsonb_array_elements_text(v_transition->'sourceObservationIds')::uuid),v_transition->>'ruleVersion',v_transition->>'engineVersion'
    ) on conflict (id) do nothing;
  else
    v_history_id := nullif(v_identity->>'lastTransitionId','')::uuid;
  end if;

  insert into public.ct_target_identity_current (
    tenant_id,account_id,target_id,current_username,stable_platform_user_id,identity_status,confidence,last_history_id,last_observed_at,updated_at,
    observed_username,domain_identity_status,evidence_count,first_seen_at,last_seen_at,last_confirmed_at,stale_after,source_version
  ) values (
    v_observation.tenant_id,v_observation.account_id,v_observation.target_id,v_identity->>'canonicalUsername',nullif(v_identity->>'stablePlatformUserId',''),
    case v_identity->>'identityStatus' when 'identity_confirmed' then 'unchanged' when 'username_change_confirmed' then 'matched_rename' when 'identity_conflict' then 'conflict' else 'unresolved' end,
    v_identity->>'confidence',v_history_id,coalesce((v_identity->>'lastSeenAt')::timestamptz,v_observation.observed_at),(v_identity->>'updatedAt')::timestamptz,
    nullif(v_identity->>'observedUsername',''),v_identity->>'identityStatus',(v_identity->>'evidenceCount')::integer,
    nullif(v_identity->>'firstSeenAt','')::timestamptz,nullif(v_identity->>'lastSeenAt','')::timestamptz,nullif(v_identity->>'lastConfirmedAt','')::timestamptz,
    nullif(v_identity->>'staleAfter','')::timestamptz,v_identity->>'sourceVersion'
  ) on conflict (tenant_id,account_id,target_id) do update set
    current_username=excluded.current_username,stable_platform_user_id=excluded.stable_platform_user_id,
    identity_status=excluded.identity_status,confidence=excluded.confidence,last_history_id=coalesce(excluded.last_history_id,public.ct_target_identity_current.last_history_id),
    last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at,observed_username=excluded.observed_username,
    domain_identity_status=excluded.domain_identity_status,evidence_count=excluded.evidence_count,first_seen_at=excluded.first_seen_at,
    last_seen_at=excluded.last_seen_at,last_confirmed_at=excluded.last_confirmed_at,stale_after=excluded.stale_after,source_version=excluded.source_version
  where excluded.last_observed_at>=public.ct_target_identity_current.last_observed_at;

  v_assessment_id := (v_assessment->>'assessmentId')::uuid;
  insert into public.ct_target_availability_assessments (
    id,tenant_id,account_id,target_id,assessment_key,normalized_username,stable_platform_user_id,status,confidence,identity_resolution,
    reason_codes,evidence_count,distinct_run_count,distinct_device_count,latest_observed_at,recheck_required,next_recheck_at,
    quarantine_recommended,quarantine_until,terminal_proof,assessed_at,model_version,assessment_status_v3,identity_status_v3,
    contributing_observation_ids,ignored_observation_ids,repeat_count,rule_version,engine_version,engine_revision,policy_revision,
    first_evidence_at,last_evidence_at,valid_until,explanation_safe,missing_evidence
  ) values (
    v_assessment_id,v_observation.tenant_id,v_observation.account_id,v_observation.target_id,v_assessment->>'assessmentKey',v_identity->>'canonicalUsername',
    nullif(v_identity->>'stablePlatformUserId',''),
    case v_assessment->>'status' when 'available' then 'available' when 'likely_available' then 'available' when 'identity_changed' then 'username_changed'
      when 'verified_restricted_suspected' then 'verified_restricted' when 'verified_restricted_confirmed' then 'verified_restricted'
      when 'temporarily_unavailable' then 'temporarily_unavailable' when 'unavailable_confirmed' then 'permanently_unavailable'
      when 'unavailable_suspected' then 'deleted_or_not_found' when 'conflicting_evidence' then 'identity_conflict'
      when 'stale' then 'stale_evidence' else 'insufficient_evidence' end,
    v_assessment->>'confidence',case v_assessment->>'identityStatus' when 'identity_confirmed' then 'unchanged' when 'username_change_confirmed' then 'matched_rename' when 'identity_conflict' then 'conflict' else 'unresolved' end,
    array(select jsonb_array_elements_text(v_assessment->'reasonCodes')),(v_identity->>'evidenceCount')::integer,(v_assessment->>'repeatCount')::integer,0,
    nullif(v_assessment->>'lastEvidenceAt','')::timestamptz,(v_assessment->'missingEvidence')<> '[]'::jsonb,
    case when (v_assessment->'missingEvidence')<> '[]'::jsonb then (v_assessment->>'validUntil')::timestamptz else null end,
    false,null,false,(v_assessment->>'assessedAt')::timestamptz,v_assessment->>'engineVersion',v_assessment->>'status',v_assessment->>'identityStatus',
    array(select jsonb_array_elements_text(v_assessment->'contributingObservationIds')::uuid),array(select jsonb_array_elements_text(v_assessment->'ignoredObservationIds')::uuid),
    (v_assessment->>'repeatCount')::integer,v_assessment->>'ruleVersion',v_assessment->>'engineVersion',(v_assessment->>'engineRevision')::integer,(v_assessment->>'policyRevision')::integer,
    nullif(v_assessment->>'firstEvidenceAt','')::timestamptz,nullif(v_assessment->>'lastEvidenceAt','')::timestamptz,(v_assessment->>'validUntil')::timestamptz,
    jsonb_build_object('explanation',coalesce(v_assessment->'explanation','[]'::jsonb)),array(select jsonb_array_elements_text(v_assessment->'missingEvidence'))
  ) on conflict (id) do nothing;

  select * into v_existing from public.ct_target_availability_current
    where tenant_id=v_observation.tenant_id and account_id=v_observation.account_id and target_id=v_observation.target_id for update;
  if found and (
    coalesce((v_current->>'engineRevision')::integer,0)<coalesce(v_existing.engine_revision,0)
    or (coalesce((v_current->>'engineRevision')::integer,0)=coalesce(v_existing.engine_revision,0)
      and coalesce((v_current->>'policyRevision')::integer,0)<coalesce(v_existing.policy_revision,0))
  ) then
    raise exception 'target_availability_version_regression';
  end if;
  insert into public.ct_target_availability_current (
    tenant_id,account_id,target_id,assessment_id,updated_at,availability_status,confidence,identity_status,latest_observation_at,
    confirmed_at,valid_until,stale_after,reason_codes,engine_version,policy_version,engine_revision,policy_revision
  ) values (
    v_observation.tenant_id,v_observation.account_id,v_observation.target_id,v_assessment_id,(v_current->>'updatedAt')::timestamptz,
    v_current->>'availabilityStatus',v_current->>'confidence',v_current->>'identityStatus',nullif(v_current->>'latestObservationAt','')::timestamptz,
    nullif(v_current->>'confirmedAt','')::timestamptz,(v_current->>'validUntil')::timestamptz,(v_current->>'staleAfter')::timestamptz,
    array(select jsonb_array_elements_text(v_current->'reasonCodes')),v_current->>'engineVersion',v_current->>'policyVersion',
    (v_current->>'engineRevision')::integer,(v_current->>'policyRevision')::integer
  ) on conflict (tenant_id,account_id,target_id) do update set
    assessment_id=excluded.assessment_id,updated_at=excluded.updated_at,availability_status=excluded.availability_status,
    confidence=excluded.confidence,identity_status=excluded.identity_status,latest_observation_at=excluded.latest_observation_at,
    confirmed_at=excluded.confirmed_at,valid_until=excluded.valid_until,stale_after=excluded.stale_after,reason_codes=excluded.reason_codes,
    engine_version=excluded.engine_version,policy_version=excluded.policy_version,engine_revision=excluded.engine_revision,policy_revision=excluded.policy_revision
  where coalesce(excluded.engine_revision,0)>coalesce(public.ct_target_availability_current.engine_revision,0)
    or (coalesce(excluded.engine_revision,0)=coalesce(public.ct_target_availability_current.engine_revision,0)
      and coalesce(excluded.policy_revision,0)>coalesce(public.ct_target_availability_current.policy_revision,0))
    or (coalesce(excluded.engine_revision,0)=coalesce(public.ct_target_availability_current.engine_revision,0)
      and coalesce(excluded.policy_revision,0)=coalesce(public.ct_target_availability_current.policy_revision,0)
      and coalesce(excluded.latest_observation_at,excluded.updated_at)>coalesce(public.ct_target_availability_current.latest_observation_at,public.ct_target_availability_current.updated_at))
    or (coalesce(excluded.latest_observation_at,excluded.updated_at)=coalesce(public.ct_target_availability_current.latest_observation_at,public.ct_target_availability_current.updated_at)
      and excluded.updated_at>=public.ct_target_availability_current.updated_at and excluded.assessment_id::text>public.ct_target_availability_current.assessment_id::text);
  get diagnostics v_row_count = row_count;
  v_current_outcome := case when v_row_count=1 then 'projected' else 'stale_or_duplicate' end;

  if v_metric is not null and jsonb_typeof(v_metric)='object' then
    insert into public.ct_target_availability_pipeline_metrics (
      metric_key,tenant_id,account_id,run_id,component,scope_mode,counters_safe,latency_ms,cpu_ms,
      memory_before_bytes,memory_peak_bytes,memory_after_bytes,retained_payload_count,queue_depth
    ) values (
      v_metric->>'metricKey',v_observation.tenant_id,v_observation.account_id,v_observation.source_run_id,
      coalesce(nullif(v_metric->>'component',''),'pipeline'),coalesce(nullif(v_metric->>'scopeMode',''),'all_active_accounts'),
      coalesce(v_metric->'countersSafe','{}'::jsonb),nullif(v_metric->>'latencyMs','')::numeric,nullif(v_metric->>'cpuMs','')::numeric,
      nullif(v_metric->>'memoryBeforeBytes','')::bigint,nullif(v_metric->>'memoryPeakBytes','')::bigint,nullif(v_metric->>'memoryAfterBytes','')::bigint,0,
      coalesce(nullif(v_metric->>'queueDepth','')::integer,0)
    ) on conflict (metric_key) do nothing;
  end if;

  update public.ct_target_availability_processing_checkpoints set
    status='processed',processed_at=now(),updated_at=now(),error_code=null
  where observation_id=p_observation_id;
  return jsonb_build_object('outcome','processed','observation_id',p_observation_id,'assessment_id',v_assessment_id,'current_outcome',v_current_outcome);
  exception when others then
    update public.ct_target_availability_processing_checkpoints set
      status='failed',error_code=left(regexp_replace(sqlerrm,'[^a-zA-Z0-9_.:-]+','_','g'),160),updated_at=now()
    where observation_id=p_observation_id;
    return jsonb_build_object(
      'outcome','failed',
      'observation_id',p_observation_id,
      'error_code',left(regexp_replace(sqlerrm,'[^a-zA-Z0-9_.:-]+','_','g'),160)
    );
  end;
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'ct_target_availability_runtime_state','ct_target_availability_processing_checkpoints',
    'ct_target_availability_pipeline_metrics','ct_target_availability_alert_events',
    'ct_target_availability_cap_counters','ct_target_availability_pipeline_leases'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('alter table public.%I force row level security',v_table);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated, service_role',v_table);
    execute format('create policy %I on public.%I to service_role using (true) with check (true)',v_table||'_service_role_all',v_table);
  end loop;
end $$;

grant select,update on table public.ct_target_availability_runtime_state to service_role;
grant select,insert,update on table public.ct_target_availability_processing_checkpoints to service_role;
grant select,insert on table public.ct_target_availability_pipeline_metrics to service_role;
grant select,insert,update on table public.ct_target_availability_alert_events to service_role;
grant select,insert,update on table public.ct_target_availability_cap_counters to service_role;
grant select,insert,delete on table public.ct_target_availability_pipeline_leases to service_role;

revoke all on function public.claim_target_availability_observation_capacity_v1(uuid,uuid,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.claim_target_availability_projection_capacity_v1(uuid,uuid,integer,integer,integer,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.claim_target_availability_pipeline_lease_v1(text,text,integer,integer) from public,anon,authenticated;
revoke all on function public.release_target_availability_pipeline_lease_v1(uuid) from public,anon,authenticated;
revoke all on function public.trigger_target_availability_auto_kill_v1(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.persist_target_availability_pipeline_v1(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_target_availability_observation_capacity_v1(uuid,uuid,integer,integer,integer) to service_role;
grant execute on function public.claim_target_availability_projection_capacity_v1(uuid,uuid,integer,integer,integer,integer,integer,integer) to service_role;
grant execute on function public.claim_target_availability_pipeline_lease_v1(text,text,integer,integer) to service_role;
grant execute on function public.release_target_availability_pipeline_lease_v1(uuid) to service_role;
grant execute on function public.trigger_target_availability_auto_kill_v1(text,text,jsonb) to service_role;
grant execute on function public.persist_target_availability_pipeline_v1(uuid,jsonb,text) to service_role;

comment on table public.ct_target_availability_runtime_state is
  'Dynamic fail-closed Target Availability Shadow state. Business action flags are constrained OFF in V1.';
comment on table public.ct_target_availability_pipeline_metrics is
  'Persistent bounded technical metrics only; no business payloads or client-visible data.';
comment on function public.trigger_target_availability_auto_kill_v1(text,text,jsonb) is
  'Disables every Availability producer and requires explicit human re-enable. Instagram runtime remains untouched.';
