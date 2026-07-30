\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then raise exception 'assertion_failed: %', p_message; end if;
end
$$;

select pg_temp.assert_true(
  (select count(*) = 4
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('ct_target_identity_history','ct_target_identity_current','ct_target_availability_assessments','ct_target_availability_current')
     and c.relrowsecurity and c.relforcerowsecurity),
  'RLS remains enabled and forced on all evolved tables');

select pg_temp.assert_true(
  (select count(*) = 37
   from information_schema.columns
   where table_schema = 'public' and (table_name, column_name) in (
     values
       ('ct_target_identity_history','transition_type_v3'),('ct_target_identity_history','evidence_count'),
       ('ct_target_identity_history','first_observed_at'),('ct_target_identity_history','last_observed_at'),
       ('ct_target_identity_history','source_observation_ids'),('ct_target_identity_history','rule_version'),
       ('ct_target_identity_history','engine_version'),('ct_target_identity_current','observed_username'),
       ('ct_target_identity_current','domain_identity_status'),('ct_target_identity_current','evidence_count'),
       ('ct_target_identity_current','first_seen_at'),('ct_target_identity_current','last_seen_at'),
       ('ct_target_identity_current','last_confirmed_at'),('ct_target_identity_current','stale_after'),
       ('ct_target_identity_current','source_version'),('ct_target_availability_assessments','assessment_status_v3'),
       ('ct_target_availability_assessments','identity_status_v3'),('ct_target_availability_assessments','contributing_observation_ids'),
       ('ct_target_availability_assessments','ignored_observation_ids'),('ct_target_availability_assessments','repeat_count'),
       ('ct_target_availability_assessments','rule_version'),('ct_target_availability_assessments','engine_version'),
       ('ct_target_availability_assessments','engine_revision'),('ct_target_availability_assessments','policy_revision'),
       ('ct_target_availability_assessments','first_evidence_at'),('ct_target_availability_assessments','last_evidence_at'),
       ('ct_target_availability_assessments','valid_until'),('ct_target_availability_assessments','explanation_safe'),
       ('ct_target_availability_assessments','missing_evidence'),('ct_target_availability_current','availability_status'),
       ('ct_target_availability_current','confidence'),('ct_target_availability_current','identity_status'),
       ('ct_target_availability_current','latest_observation_at'),('ct_target_availability_current','confirmed_at'),
       ('ct_target_availability_current','valid_until'),('ct_target_availability_current','stale_after'),
       ('ct_target_availability_current','reason_codes')
   )), 'all mandatory additive columns exist');

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'ct_target_identity_history','ct_target_identity_current',
    'ct_target_availability_assessments','ct_target_availability_current'
  ] loop
    perform pg_temp.assert_true(
      not has_table_privilege('anon', format('public.%I', v_table), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
      v_table || ' anon denied');
    perform pg_temp.assert_true(
      not has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
      v_table || ' authenticated denied');
    perform pg_temp.assert_true(has_table_privilege('service_role', format('public.%I', v_table), 'SELECT,INSERT'), v_table || ' service_role read/insert');
    perform pg_temp.assert_true(not has_table_privilege('service_role', format('public.%I', v_table), 'DELETE,TRUNCATE,REFERENCES,TRIGGER'), v_table || ' service_role destructive denied');
  end loop;
end
$$;

begin;
set local request.jwt.claim.role = 'service_role';

insert into public.ct_target_availability_observations (
  id, tenant_id, account_id, target_id, observed_at, source, searched_username,
  observed_username, observed_stable_platform_user_id, lookup_result, profile_found,
  followers_surface, reason_codes, idempotency_key
) values (
  '42000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0001-000000000001',md5('target:1')::uuid,'2026-07-30 10:00:00+00',
  'synthetic','synthetic_target_1','synthetic_target_1','ig-stable-fixture-1','found',true,
  'normal',array['profile_available'],'identity-current-v3-observation-0001'
);

insert into public.ct_target_identity_history (
  id, tenant_id, account_id, target_id, observation_id, previous_username, observed_username,
  stable_platform_user_id, resolution, confidence, reason_codes, idempotency_key, observed_at,
  transition_type_v3, evidence_count, first_observed_at, last_observed_at,
  source_observation_ids, rule_version, engine_version
) values (
  '42000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0001-000000000001',md5('target:1')::uuid,
  '42000000-0000-0000-0000-000000000001','synthetic_target_1','synthetic_target_1',
  'ig-stable-fixture-1','unchanged','high',array['identity_confirmed'],'identity-current-v3-history-0001',
  '2026-07-30 10:00:00+00','identity_confirmed',1,'2026-07-30 10:00:00+00','2026-07-30 10:00:00+00',
  array['42000000-0000-0000-0000-000000000001'::uuid],'target-availability-rules-v1','target-availability-engine-v3'
);

insert into public.ct_target_identity_current (
  tenant_id, account_id, target_id, current_username, stable_platform_user_id, identity_status,
  confidence, last_history_id, last_observed_at, observed_username, domain_identity_status,
  evidence_count, first_seen_at, last_seen_at, last_confirmed_at, stale_after, source_version
) values (
  '10000000-0000-0000-0000-000000000000','10000000-0000-0000-0001-000000000001',
  md5('target:1')::uuid,'synthetic_target_1','ig-stable-fixture-1','unchanged','high',
  '42000000-0000-0000-0000-000000000002','2026-07-30 10:00:00+00','synthetic_target_1',
  'identity_confirmed',1,'2026-07-30 10:00:00+00','2026-07-30 10:00:00+00',
  '2026-07-30 10:00:00+00','2026-07-31 10:00:00+00','target-availability-engine-v3'
);

insert into public.ct_target_availability_assessments (
  id, tenant_id, account_id, target_id, assessment_key, normalized_username, stable_platform_user_id,
  status, confidence, identity_resolution, reason_codes, evidence_count, distinct_run_count,
  distinct_device_count, latest_observed_at, recheck_required, quarantine_recommended, terminal_proof,
  assessed_at, model_version, assessment_status_v3, identity_status_v3,
  contributing_observation_ids, ignored_observation_ids, repeat_count, rule_version, engine_version,
  engine_revision, policy_revision, first_evidence_at, last_evidence_at, valid_until,
  explanation_safe, missing_evidence
) values (
  '42000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0001-000000000001',md5('target:1')::uuid,'identity-current-v3-assessment-0001',
  'synthetic_target_1','ig-stable-fixture-1','available','medium','unchanged',array['profile_available'],
  1,1,1,'2026-07-30 10:00:00+00',true,false,false,'2026-07-30 10:01:00+00','target-availability-engine-v3',
  'likely_available','identity_confirmed',array['42000000-0000-0000-0000-000000000001'::uuid],
  '{}'::uuid[],1,'target-availability-rules-v1','target-availability-engine-v3',3,1,
  '2026-07-30 10:00:00+00','2026-07-30 10:00:00+00','2026-07-31 10:01:00+00',
  '{"summary":"Fresh profile availability is observed."}'::jsonb,array['second_fresh_distinct_run_confirmation']
);

insert into public.ct_target_availability_current (
  tenant_id, account_id, target_id, assessment_id, availability_status, confidence, identity_status,
  latest_observation_at, valid_until, stale_after, reason_codes, engine_version, policy_version,
  engine_revision, policy_revision
) values (
  '10000000-0000-0000-0000-000000000000','10000000-0000-0000-0001-000000000001',
  md5('target:1')::uuid,'42000000-0000-0000-0000-000000000003','likely_available','medium',
  'identity_confirmed','2026-07-30 10:00:00+00','2026-07-31 10:01:00+00','2026-08-01 10:01:00+00',
  array['profile_available'],'target-availability-engine-v3','target-availability-policy-v1',3,1
);

select pg_temp.assert_true(
  (select availability_status = 'likely_available' and engine_revision = 3
   from public.ct_target_availability_current where target_id = md5('target:1')::uuid),
  'versioned Availability current round-trips locally');

rollback;

select 'CT_TARGET_AVAILABILITY_IDENTITY_ASSESSMENT_CURRENT_V1_CERTIFIED' as certification;
