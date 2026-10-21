-- Compass V2 stores normalized evidence and decisions only. Raw payloads remain
-- short-lived in the bounded collector store. All tables are backend-only.

create table if not exists public.compass_external_source_checks (
  id text primary key,
  source text not null,
  checked_at timestamptz not null,
  access_status text not null check (access_status in ('WORKING','LIMITED','BLOCKED','UNKNOWN')),
  coverage_status text not null check (coverage_status in ('FULL','PARTIAL','DEGRADED')),
  source_credibility text not null check (source_credibility in ('HIGH','MEDIUM','LOW','CONTEXTUAL')),
  observed boolean not null default false,
  collection_success boolean not null default false,
  last_success_at timestamptz,
  http_status integer,
  next_allowed_at timestamptz,
  failure_reason text,
  etag_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.compass_external_signals (
  id text primary key,
  source text not null,
  source_native_id text,
  native_id text,
  canonical_url text,
  origin_group_id text,
  device_id text,
  run_type text,
  url text not null,
  retrieved_at timestamptz not null,
  published_at timestamptz,
  publication_date_confidence text not null check (publication_date_confidence in ('HIGH','MEDIUM','LOW')),
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  platform text not null check (platform = 'INSTAGRAM'),
  signal_type text not null,
  action_family text not null,
  symptom_family text not null,
  geography text,
  platform_version text,
  source_credibility text not null check (source_credibility in ('HIGH','MEDIUM','LOW','CONTEXTUAL')),
  access_status text not null check (access_status in ('WORKING','LIMITED','BLOCKED','UNKNOWN')),
  freshness text not null check (freshness in ('CURRENT','STALE')),
  volume integer not null default 1 check (volume >= 0),
  velocity numeric not null default 0,
  official_confirmation boolean not null default false,
  content_hash text not null,
  dedupe_key text not null,
  cluster_id text,
  exclusion_reason jsonb not null default '[]'::jsonb check (jsonb_typeof(exclusion_reason) = 'array'),
  raw_reference text not null,
  author_key text,
  source_family text not null,
  summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_native_id),
  unique (dedupe_key)
);

create index if not exists compass_external_signals_cluster_idx
  on public.compass_external_signals (platform, action_family, symptom_family, last_seen desc);
create index if not exists compass_external_signals_retention_idx
  on public.compass_external_signals (last_seen);

create table if not exists public.compass_signal_clusters (
  id text primary key,
  platform text not null check (platform = 'INSTAGRAM'),
  action_family text not null,
  symptom_family text not null,
  current_evaluation jsonb not null default '{}'::jsonb,
  state text not null check (state in ('ISOLATED','EMERGING','ACCELERATING','STABLE','DECLINING','RESOLVED')),
  unique_signal_count integer not null check (unique_signal_count >= 0),
  unique_source_family_count integer not null check (unique_source_family_count >= 0),
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  velocity numeric not null,
  freshness text not null check (freshness in ('CURRENT','STALE')),
  coverage_status text not null check (coverage_status in ('FULL','PARTIAL','DEGRADED')),
  external_confidence integer not null check (external_confidence between 0 and 100),
  updated_at timestamptz not null default now()
);

alter table public.compass_external_signals
  add constraint compass_external_signals_cluster_fk
  foreign key (cluster_id) references public.compass_signal_clusters(id) on delete set null;

create table if not exists public.compass_cluster_history (
  id text primary key,
  cluster_id text not null references public.compass_signal_clusters(id) on delete cascade,
  observed_at timestamptz not null,
  state text not null check (state in ('ISOLATED','EMERGING','ACCELERATING','STABLE','DECLINING','RESOLVED')),
  unique_signal_count integer not null,
  unique_source_family_count integer not null,
  velocity numeric not null,
  coverage_status text not null,
  external_confidence integer not null check (external_confidence between 0 and 100),
  unique (cluster_id, observed_at)
);

create index if not exists compass_cluster_history_retention_idx
  on public.compass_cluster_history (observed_at);

create table if not exists public.compass_fleet_correlations (
  id text primary key,
  cluster_id text not null references public.compass_signal_clusters(id) on delete cascade,
  observed_at timestamptz not null,
  internal_evidence_strength text not null check (internal_evidence_strength in ('CONFIRMED','STRONG','WEAK','NONE')),
  confirmed_platform_rate_limit boolean not null default false,
  affected_accounts jsonb not null default '[]'::jsonb check (jsonb_typeof(affected_accounts) = 'array'),
  exposed_accounts jsonb not null default '[]'::jsonb check (jsonb_typeof(exposed_accounts) = 'array'),
  matched_incident_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(matched_incident_ids) = 'array'),
  score integer not null check (score between 0 and 100),
  factors jsonb not null check (jsonb_typeof(factors) = 'object')
);

create table if not exists public.compass_risk_assessments (
  id text primary key,
  cluster_id text not null references public.compass_signal_clusters(id) on delete cascade,
  correlation_id text not null references public.compass_fleet_correlations(id) on delete cascade,
  assessed_at timestamptz not null,
  score integer not null check (score between 0 and 100),
  raw_score integer not null default 0,
  final_score integer not null default 0,
  caps_applied jsonb not null default '[]'::jsonb,
  level text not null check (level in ('LOW','MODERATE','HIGH','CRITICAL')),
  confidence integer not null check (confidence between 0 and 100),
  coverage_status text not null,
  risk_factors jsonb not null check (jsonb_typeof(risk_factors) = 'object')
);

create table if not exists public.compass_recommendations (
  id text primary key,
  cluster_id text not null references public.compass_signal_clusters(id) on delete cascade,
  risk_assessment_id text not null references public.compass_risk_assessments(id) on delete cascade,
  created_at timestamptz not null,
  action text not null check (action in ('CONTINUE','MONITOR','REDUCE_ACTIVITY','ISOLATE_ACCOUNTS','PAUSE_SELECTED','PAUSE_SCOPE','PREPARE_RECOVERY','NO_ACTION','NEEDS_MORE_EVIDENCE')),
  why jsonb not null check (jsonb_typeof(why) = 'array'),
  affected_scope jsonb not null check (jsonb_typeof(affected_scope) = 'object'),
  confidence integer not null check (confidence between 0 and 100),
  preconditions jsonb not null check (jsonb_typeof(preconditions) = 'array'),
  recheck_at timestamptz not null,
  recovery_checks jsonb not null check (jsonb_typeof(recovery_checks) = 'array')
);

create table if not exists public.compass_fleet_handoffs (
  id text primary key,
  idempotency_key text not null unique,
  recommendation_id text not null references public.compass_recommendations(id) on delete restrict,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'PREPARED' check (status in ('PREPARED','OPENED_IN_FLEET','EXPIRED','SUPERSEDED')),
  actions_executable boolean not null default false check (actions_executable = false)
);

create table if not exists public.compass_operator_decisions (
  id text primary key,
  handoff_id text references public.compass_fleet_handoffs(id) on delete set null,
  decided_at timestamptz not null,
  decision text not null,
  operator_id text,
  rationale text
);

create table if not exists public.compass_outcomes (
  id text primary key,
  cluster_id text not null references public.compass_signal_clusters(id) on delete cascade,
  handoff_id text references public.compass_fleet_handoffs(id) on delete set null,
  observed_at timestamptz not null,
  outcome text not null,
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object')
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'compass_external_source_checks', 'compass_external_signals', 'compass_signal_clusters',
    'compass_cluster_history', 'compass_fleet_correlations', 'compass_risk_assessments',
    'compass_recommendations', 'compass_fleet_handoffs', 'compass_operator_decisions', 'compass_outcomes'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end $$;

create or replace function public.persist_compass_assessment_v1(
  p_cluster jsonb,
  p_signal_ids jsonb,
  p_correlation jsonb,
  p_risk jsonb,
  p_recommendation jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_value jsonb;
begin
  if jsonb_typeof(p_cluster) <> 'object'
     or jsonb_typeof(p_signal_ids) <> 'array'
     or jsonb_typeof(p_correlation) <> 'object'
     or jsonb_typeof(p_risk) <> 'object'
     or jsonb_typeof(p_recommendation) <> 'object' then
    raise exception 'INVALID_COMPASS_ASSESSMENT_PAYLOAD';
  end if;

  insert into public.compass_signal_clusters (
    id, platform, action_family, symptom_family, state, unique_signal_count,
    unique_source_family_count, first_seen, last_seen, velocity, freshness,
    coverage_status, external_confidence, updated_at, current_evaluation
  ) values (
    p_cluster->>'id', p_cluster->>'platform', p_cluster->>'action_family', p_cluster->>'symptom_family',
    p_cluster->>'state', (p_cluster->>'unique_signal_count')::integer,
    (p_cluster->>'unique_source_family_count')::integer, (p_cluster->>'first_seen')::timestamptz,
    (p_cluster->>'last_seen')::timestamptz, (p_cluster->>'velocity')::numeric,
    p_cluster->>'freshness', p_cluster->>'coverage_status',
    (p_cluster->>'external_confidence')::integer, (p_cluster->>'observed_at')::timestamptz, coalesce(p_cluster->'current_evaluation','{}'::jsonb)
  ) on conflict (id) do update set
    state = excluded.state,
    unique_signal_count = excluded.unique_signal_count,
    unique_source_family_count = excluded.unique_source_family_count,
    last_seen = excluded.last_seen,
    velocity = excluded.velocity,
    freshness = excluded.freshness,
    coverage_status = excluded.coverage_status,
    external_confidence = excluded.external_confidence,
    updated_at = excluded.updated_at,
    current_evaluation = excluded.current_evaluation
    where compass_signal_clusters.updated_at <= excluded.updated_at;

  if not found then
    select current_evaluation into current_value from public.compass_signal_clusters where id=p_cluster->>'id';
    return jsonb_build_object('ok',true,'stale_ignored',true,'current_evaluation',current_value);
  end if;

  update public.compass_external_signals
  set cluster_id = p_cluster->>'id', updated_at = (p_cluster->>'observed_at')::timestamptz
  where id in (select value from jsonb_array_elements_text(p_signal_ids));

  insert into public.compass_cluster_history (
    id, cluster_id, observed_at, state, unique_signal_count,
    unique_source_family_count, velocity, coverage_status, external_confidence
  ) values (
    p_cluster->>'history_id', p_cluster->>'id', (p_cluster->>'observed_at')::timestamptz,
    p_cluster->>'state', (p_cluster->>'unique_signal_count')::integer,
    (p_cluster->>'unique_source_family_count')::integer, (p_cluster->>'velocity')::numeric,
    p_cluster->>'coverage_status', (p_cluster->>'external_confidence')::integer
  ) on conflict do nothing;

  insert into public.compass_fleet_correlations (
    id, cluster_id, observed_at, internal_evidence_strength,
    confirmed_platform_rate_limit, affected_accounts, exposed_accounts,
    matched_incident_ids, score, factors
  ) values (
    p_correlation->>'id', p_cluster->>'id', (p_cluster->>'observed_at')::timestamptz,
    p_correlation->>'internal_evidence_strength',
    (p_correlation->>'confirmed_platform_rate_limit')::boolean,
    p_correlation->'affected_accounts', p_correlation->'exposed_accounts',
    p_correlation->'matched_incident_ids', (p_correlation->>'score')::integer,
    p_correlation->'factors'
  ) on conflict (id) do nothing;

  insert into public.compass_risk_assessments (
    id, cluster_id, correlation_id, assessed_at, score, level,
    confidence, coverage_status, risk_factors,raw_score,final_score,caps_applied
  ) values (
    p_risk->>'id', p_cluster->>'id', p_correlation->>'id',
    (p_cluster->>'observed_at')::timestamptz, (p_risk->>'score')::integer,
    p_risk->>'level', (p_risk->>'confidence')::integer,
    p_risk->>'coverage_status', p_risk->'risk_factors',coalesce((p_risk->>'raw_score')::integer,(p_risk->>'score')::integer),
    coalesce((p_risk->>'final_score')::integer,(p_risk->>'score')::integer),coalesce(p_risk->'caps_applied','[]'::jsonb)
  ) on conflict (id) do nothing;

  insert into public.compass_recommendations (
    id, cluster_id, risk_assessment_id, created_at, action, why,
    affected_scope, confidence, preconditions, recheck_at, recovery_checks
  ) values (
    p_recommendation->>'id', p_cluster->>'id', p_risk->>'id',
    (p_cluster->>'observed_at')::timestamptz, p_recommendation->>'action',
    p_recommendation->'why', p_recommendation->'affected_scope',
    (p_recommendation->>'confidence')::integer, p_recommendation->'preconditions',
    (p_recommendation->>'recheck_at')::timestamptz,
    p_recommendation->'recovery_checks'
  ) on conflict (id) do nothing;

  select current_evaluation into current_value from public.compass_signal_clusters where id=p_cluster->>'id';
  return jsonb_build_object(
    'ok', true, 'current_evaluation',current_value,
    'cluster_id', p_cluster->>'id',
    'correlation_id', p_correlation->>'id',
    'risk_assessment_id', p_risk->>'id',
    'recommendation_id', p_recommendation->>'id'
  );
end;
$$;

revoke all on function public.persist_compass_assessment_v1(jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persist_compass_assessment_v1(jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

-- Only indexes serving the actual bounded read and retention paths.
create index compass_checks_time_idx on public.compass_external_source_checks(checked_at desc);
create index compass_checks_source_time_idx on public.compass_external_source_checks(source,checked_at desc);
create index compass_signals_expiry_idx on public.compass_external_signals((coalesce(published_at,first_seen)));
create index compass_signals_event_idx on public.compass_external_signals(published_at desc);
create index compass_clusters_latest_idx on public.compass_signal_clusters(last_seen desc);
create index compass_risks_latest_idx on public.compass_risk_assessments(assessed_at desc);
create index compass_recommendations_latest_idx on public.compass_recommendations(created_at desc);
create index compass_correlations_cluster_idx on public.compass_fleet_correlations(cluster_id);
create index compass_risks_correlation_idx on public.compass_risk_assessments(correlation_id);
create index compass_recommendations_risk_idx on public.compass_recommendations(risk_assessment_id);
create index compass_recommendations_cluster_idx on public.compass_recommendations(cluster_id);
create index compass_handoffs_recommendation_idx on public.compass_fleet_handoffs(recommendation_id);
create index compass_outcomes_cluster_idx on public.compass_outcomes(cluster_id);
create index compass_correlations_time_idx on public.compass_fleet_correlations(observed_at);

create function public.persist_compass_assessment_batch_v1(p_assessments jsonb) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare item jsonb; results jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_assessments) is distinct from 'array' or jsonb_array_length(p_assessments)>50 then raise exception 'INVALID_ASSESSMENT_BATCH'; end if;
  -- Stable lock ordering avoids cross-batch deadlocks.
  for item in select value from jsonb_array_elements(p_assessments) order by value->'cluster'->>'id' loop
    results := results || jsonb_build_array(public.persist_compass_assessment_v1(item->'cluster',item->'signal_ids',item->'correlation',item->'risk',item->'recommendation'));
  end loop;
  return results;
end $$;
revoke all on function public.persist_compass_assessment_batch_v1(jsonb) from public,anon,authenticated;
grant execute on function public.persist_compass_assessment_batch_v1(jsonb) to service_role;

create function public.prune_compass_v1() returns void
language plpgsql security invoker set search_path=public as $$
begin
  -- Never delete receipts, operator decisions or outcomes. Their FKs protect assessments.
  delete from public.compass_external_source_checks where id in (
    select c.id from public.compass_external_source_checks c where checked_at<now()-interval '72 hours'
    and exists(select 1 from public.compass_external_source_checks newer where newer.source=c.source and newer.checked_at>c.checked_at) limit 500);
  delete from public.compass_external_signals where id in (select id from public.compass_external_signals where coalesce(published_at,first_seen)<now()-interval '30 days' limit 500);
  delete from public.compass_signal_clusters c where c.id in (
    select old.id from public.compass_signal_clusters old where old.updated_at<now()-interval '365 days'
    and not exists(select 1 from public.compass_outcomes o where o.cluster_id=old.id)
    and not exists(select 1 from public.compass_recommendations r join public.compass_fleet_handoffs h on h.recommendation_id=r.id where r.cluster_id=old.id)
    limit 100);
  delete from public.compass_cluster_history where id in (select id from public.compass_cluster_history where observed_at<now()-interval '365 days'
    and cluster_id not in (select cluster_id from public.compass_outcomes)
    and cluster_id not in (select r.cluster_id from public.compass_recommendations r join public.compass_fleet_handoffs h on h.recommendation_id=r.id) limit 500);
  -- Long-lived episodes retain one year of evaluations, plus linked decision evidence.
  delete from public.compass_recommendations r where r.id in (select x.id from public.compass_recommendations x
    where x.created_at<now()-interval '365 days' and not exists(select 1 from public.compass_fleet_handoffs h where h.recommendation_id=x.id)
    and not exists(select 1 from public.compass_signal_clusters c where c.current_evaluation->>'recommendationId'=x.id) limit 500);
  delete from public.compass_risk_assessments r where r.id in (select x.id from public.compass_risk_assessments x
    where x.assessed_at<now()-interval '365 days' and not exists(select 1 from public.compass_recommendations q where q.risk_assessment_id=x.id) limit 500);
  delete from public.compass_fleet_correlations r where r.id in (select x.id from public.compass_fleet_correlations x
    where x.observed_at<now()-interval '365 days' and not exists(select 1 from public.compass_risk_assessments q where q.correlation_id=x.id) limit 500);
end $$;
revoke all on function public.prune_compass_v1() from public,anon,authenticated;
grant execute on function public.prune_compass_v1() to service_role;

create function public.ingest_compass_collection_v1(p_signals jsonb,p_checks jsonb) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare item jsonb;
begin
  if jsonb_typeof(p_signals) is distinct from 'array' or jsonb_typeof(p_checks) is distinct from 'array'
    or jsonb_array_length(p_signals)>500 or jsonb_array_length(p_checks)>50 then raise exception 'INVALID_COLLECTION_BATCH'; end if;
  for item in select value from jsonb_array_elements(p_signals) order by value->>'id' loop
    insert into public.compass_external_signals select * from jsonb_populate_record(null::public.compass_external_signals,
      jsonb_build_object('created_at',now(),'updated_at',now(),'summary','','exclusion_reason','[]'::jsonb,'volume',1,'velocity',0,'official_confirmation',false) || item)
    on conflict(id) do update set retrieved_at=excluded.retrieved_at,last_seen=greatest(compass_external_signals.last_seen,excluded.last_seen),updated_at=now()
    where compass_external_signals.content_hash=excluded.content_hash and compass_external_signals.published_at is not distinct from excluded.published_at;
    if not found then raise exception 'SIGNAL_IDENTITY_CONFLICT'; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_checks) order by value->>'id' loop
    insert into public.compass_external_source_checks select * from jsonb_populate_record(null::public.compass_external_source_checks,
      jsonb_build_object('created_at',now(),'observed',false,'collection_success',false) || item) on conflict(id) do nothing;
  end loop;
  perform public.prune_compass_v1();
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.ingest_compass_collection_v1(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_compass_collection_v1(jsonb,jsonb) to service_role;
