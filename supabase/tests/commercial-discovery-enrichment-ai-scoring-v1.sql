select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.create_commercial_discovery_run_v1(uuid,text,text,integer,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.create_commercial_discovery_run_v1(uuid,text,text,integer,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.create_commercial_discovery_run_v1(uuid,text,text,integer,text)', 'EXECUTE'),
  'discovery trigger RPC is service-role-only'
);

select pg_temp.assert_true(
  (select count(*) = 3 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('commercial_discovery_runs','commercial_discovery_items','commercial_business_identifiers')
     and c.relrowsecurity and c.relforcerowsecurity),
  'all discovery tables force RLS'
);

select pg_temp.expect_error(
  $$select public.create_commercial_discovery_run_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','Durban',null,3,'bad-city')$$,
  'commercial_discovery_city_not_allowed', 'strict city scope'
);
select pg_temp.expect_error(
  $$select public.create_commercial_discovery_run_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b','Cape Town',null,31,'bad-max')$$,
  'commercial_discovery_max_prospects_invalid', 'database max 30'
);

select public.create_commercial_discovery_run_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b', 'Cape Town', 'Skin Clinic', 3, 'discovery-run-fixture'
);
select pg_temp.assert_true(
  (public.create_commercial_discovery_run_v1(
    '580d7856-d60f-4838-a5f9-3b405d6ae79b', 'Cape Town', 'Skin Clinic', 3, 'discovery-run-fixture'
  )->>'idempotent_replay')::boolean,
  'run creation is idempotent'
);

select public.claim_commercial_discovery_run_v1(
  (select id from public.commercial_discovery_runs where idempotency_key = 'discovery-run-fixture')
);

select public.ingest_commercial_discovery_candidate_v1(
  (select id from public.commercial_discovery_runs where idempotency_key = 'discovery-run-fixture'),
  '{
    "provider":"searchapi","provider_external_id":"fixture_glow_clinic","source_url":"https://www.instagram.com/fixture_glow_clinic/","source_query":"fixture query",
    "business_name":"Fixture Glow Clinic","country_code":"ZA","city":"Cape Town","vertical":"Beauty/Aesthetics","subsegment":"Skin Clinic",
    "instagram_handle":"fixture_glow_clinic","website":"https://fixture-glow.example/book","business_status":"open",
    "qualification_status":"qualified","item_status":"created","lead_score":8.4,"score_percent":84,"priority":"urgent","score_priority":"P1",
    "recommended_channel":"instagram","recommended_angle":"A","scoring_model_version":"BMB_SCORING_MODEL_V1","ai_confidence":0.91,
    "ai_model":"test-model","ai_prompt_version":"BMB_COMMERCIAL_AI_V1","needs_manual_review":true,"hard_gate_codes":[],"source_snapshot_hash":"fixture-hash",
    "source_snapshot_safe":{"source":"fixture"},"enrichment_snapshot_safe":{"is_private":false},"enrichment_provenance_safe":{"provider":"searchapi"},
    "analysis_snapshot_safe":{"reasoning":"fixture"},"score_breakdown_safe":{"targetingFit":{"value":9}},
    "personalization_context_safe":{"evidence":["booking link"]},"audience_context_safe":{"source":"verified_discovery_peers","suggestions":[]}
  }'::jsonb,
  'discovery-run-fixture:fixture_glow_clinic'
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.commercial_leads l join public.commercial_businesses b on b.id = l.business_id
    where b.instagram_handle_normalized = 'fixture_glow_clinic' and l.lead_score = 8.4 and l.score_priority = 'P1'
      and l.scoring_model_version = 'BMB_SCORING_MODEL_V1' and l.ai_prompt_version = 'BMB_COMMERCIAL_AI_V1'
      and b.email is null and l.qualification_status = 'qualified' and l.outreach_status = 'not_started' and l.approved_at is null),
  'P1 is staged for Liam without approval or outreach'
);
select pg_temp.assert_true(
  (select count(*) = 5 from public.commercial_events e join public.commercial_leads l on l.id = e.lead_id
   join public.commercial_businesses b on b.id = l.business_id where b.instagram_handle_normalized = 'fixture_glow_clinic'),
  'append-only discovery evidence chain is complete'
);

select pg_temp.assert_true(
  public.preflight_commercial_discovery_candidate_v1(
    (select id from public.commercial_discovery_runs where idempotency_key = 'discovery-run-fixture'),
    'searchapi', 'another-id', 'fixture_glow_clinic', null, 'Different Name'
  )->>'status' = 'duplicate',
  'same Instagram handle is duplicate before AI'
);
select pg_temp.assert_true(
  public.preflight_commercial_discovery_candidate_v1(
    (select id from public.commercial_discovery_runs where idempotency_key = 'discovery-run-fixture'),
    'searchapi', 'another-id', 'different_handle', 'https://fixture-glow.example/other', 'Different Name'
  )->>'status' = 'duplicate',
  'same website domain is duplicate before AI'
);
select pg_temp.assert_true(
  public.preflight_commercial_discovery_candidate_v1(
    (select id from public.commercial_discovery_runs where idempotency_key = 'discovery-run-fixture'),
    'searchapi', 'fixture_glow_clinic', 'different_handle', null, 'Different Name'
  )->>'status' = 'duplicate',
  'same provider external ID is duplicate before AI'
);
select pg_temp.assert_true(
  public.preflight_commercial_discovery_candidate_v1(
    (select id from public.commercial_discovery_runs where idempotency_key = 'discovery-run-fixture'),
    'searchapi', 'new-id', 'different_handle', null, 'Fixture Glow Clinic'
  )->>'status' = 'duplicate',
  'same normalized name and city is duplicate before AI'
);
select pg_temp.assert_true(
  public.preflight_commercial_discovery_candidate_v1(
    (select id from public.commercial_discovery_runs where idempotency_key = 'discovery-run-fixture'),
    'searchapi', 'ambiguous-id', 'ambiguous_handle', null, 'Fixture Glow Clinic Sandton'
  )->>'status' = 'possible_duplicate',
  'ambiguous same-city name is held without silent merge'
);

insert into public.commercial_businesses (business_name,country_code,city,vertical,subsegment,instagram_handle)
values ('Different City Only Fixture','ZA','Johannesburg','Beauty/Aesthetics','Beauty Salon','different_city_only');
select pg_temp.assert_true(
  public.preflight_commercial_discovery_candidate_v1(
    (select id from public.commercial_discovery_runs where idempotency_key = 'discovery-run-fixture'),
    'searchapi', 'different-city-id', 'different_city_new', null, 'Different City Only Fixture'
  )->>'status' = 'clear',
  'same name in a different city is not silently merged'
);

select pg_temp.expect_error(
  format($sql$select public.ingest_commercial_discovery_candidate_v1(%L,'{"provider":"searchapi","provider_external_id":"missing_ig","business_name":"Missing Instagram","country_code":"ZA","city":"Cape Town","vertical":"Beauty/Aesthetics","qualification_status":"enriched","item_status":"created","lead_score":5,"score_percent":50,"priority":"normal","score_priority":"P3"}'::jsonb,'missing-ig')$sql$,
    (select id from public.commercial_discovery_runs where idempotency_key = 'discovery-run-fixture')),
  'commercial_discovery_business_identity_invalid', 'missing Instagram fails closed'
);

select pg_temp.assert_true(
  (public.ingest_commercial_discovery_candidate_v1(
    (select id from public.commercial_discovery_runs where idempotency_key = 'discovery-run-fixture'),
    '{"provider":"searchapi"}'::jsonb,
    'discovery-run-fixture:fixture_glow_clinic'
  )->>'idempotent_replay')::boolean,
  'candidate ingestion replay creates no duplicate'
);

insert into public.ig_accounts (id, username) values ('91000000-0000-4000-8000-000000000001','existing_bmb_client');
insert into public.client_instagram_accounts (client_id, account_id, active)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','91000000-0000-4000-8000-000000000001',true);

select public.ingest_commercial_discovery_candidate_v1(
  (select id from public.commercial_discovery_runs where idempotency_key = 'discovery-run-fixture'),
  '{"provider":"searchapi","provider_external_id":"existing_bmb_client","business_name":"Existing Client","country_code":"ZA","city":"Cape Town","vertical":"Beauty/Aesthetics","subsegment":"Beauty Salon","instagram_handle":"existing_bmb_client","qualification_status":"qualified","item_status":"created","lead_score":9,"score_percent":90,"priority":"urgent","score_priority":"P1","source_snapshot_safe":{},"enrichment_snapshot_safe":{},"enrichment_provenance_safe":{},"analysis_snapshot_safe":{},"score_breakdown_safe":{},"personalization_context_safe":{},"audience_context_safe":{}}'::jsonb,
  'discovery-run-fixture:existing_bmb_client'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.commercial_discovery_items where provider_external_id = 'existing_bmb_client' and status = 'excluded_client')
  and not exists (select 1 from public.commercial_businesses where instagram_handle_normalized = 'existing_bmb_client'),
  'existing BMB client is excluded before lead creation'
);

select public.finalize_commercial_discovery_run_v1(
  (select id from public.commercial_discovery_runs where idempotency_key = 'discovery-run-fixture'),
  'completed', '{"discovered":2,"created":1,"duplicates":1,"enriched":2,"scored":1,"qualified":1,"p1":1}'::jsonb,
  '["fixture query"]'::jsonb, '{}'::jsonb
);
select pg_temp.assert_true(
  (public.commercial_discovery_run_read_model_v1(10)#>>'{summary,p1}')::integer = 1,
  'owner read model projects run status and counts'
);
