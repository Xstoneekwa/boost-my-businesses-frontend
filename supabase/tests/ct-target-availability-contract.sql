\set ON_ERROR_STOP on
set request.jwt.claim.role = 'service_role';

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition,false) then raise exception 'assertion_failed: %',p_message; end if;
end
$$;

select pg_temp.assert_true(
  (select count(*)=5 from pg_tables where schemaname='public' and tablename in (
    'ct_target_availability_observations','ct_target_identity_history','ct_target_identity_current',
    'ct_target_availability_assessments','ct_target_availability_current'
  )), 'all Target Availability tables exist');

select pg_temp.assert_true(
  (select bool_and(c.relrowsecurity and c.relforcerowsecurity)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in (
    'ct_target_availability_observations','ct_target_identity_history','ct_target_identity_current',
    'ct_target_availability_assessments','ct_target_availability_current'
   )), 'Target Availability RLS is enabled and forced');

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'ct_target_availability_observations','ct_target_identity_history','ct_target_identity_current',
    'ct_target_availability_assessments','ct_target_availability_current'
  ] loop
    perform pg_temp.assert_true(
      not has_table_privilege('anon',format('public.%I',v_table),'SELECT,INSERT,UPDATE,DELETE'),
      v_table||' anon denied');
    perform pg_temp.assert_true(
      not has_table_privilege('authenticated',format('public.%I',v_table),'SELECT,INSERT,UPDATE,DELETE'),
      v_table||' authenticated denied');
    perform pg_temp.assert_true(
      has_table_privilege('service_role',format('public.%I',v_table),'SELECT'),
      v_table||' service role select allowed');
  end loop;
end
$$;

create temporary table availability_target_count_before as
select count(*)::integer as value
from public.ig_targets
where account_id='10000000-0000-0000-0001-000000000001';

begin;

insert into public.ct_target_availability_observations (
  tenant_id,account_id,target_id,observed_at,source,source_run_id,source_worker,worker_version,
  source_device_key,instagram_version,searched_username,observed_username,
  observed_stable_platform_user_id,lookup_result,profile_found,verified_badge,followers_surface,
  accessible_profiles_count,terminal_end_detected,repeated_first_profiles_detected,retry_count,
  retry_budget_exhausted,navigation_timeout,recovery_outcome,ui_evidence_quality,network_state,
  session_state,reason_codes,idempotency_key,evidence_safe
) values (
  '10000000-0000-0000-0000-000000000000','10000000-0000-0000-0001-000000000001',
  md5('target:1')::uuid,'2026-07-29 08:30:00+00','worker',null,'fixture-worker','fixture-v1',
  'device-hash-fixture','instagram-fixture-v1','synthetic_target_1','synthetic_target_1',
  'ig-stable-fixture-1','found',true,true,'normal',200,false,false,0,false,false,'not_attempted',
  'high','healthy','healthy',array['target_profile_found','target_verified_status_detected'],
  'availability-fixture-observation-0001','{"fixture":true}'::jsonb
),(
  '10000000-0000-0000-0000-000000000000','10000000-0000-0000-0001-000000000001',
  md5('target:1')::uuid,'2026-07-29 09:30:00+00','worker',null,'fixture-worker','fixture-v1',
  'device-hash-fixture','instagram-fixture-v1','synthetic_target_1','synthetic_target_1',
  'ig-stable-fixture-1','found',true,true,'restricted',50,false,true,1,true,false,'failed',
  'high','healthy','healthy',array['target_verified_status_detected','target_followers_surface_restricted'],
  'availability-fixture-observation-0002','{"fixture":true}'::jsonb
);

insert into public.ct_target_identity_history (
  tenant_id,account_id,target_id,observation_id,previous_username,observed_username,
  stable_platform_user_id,resolution,confidence,reason_codes,idempotency_key,observed_at
) select
  tenant_id,account_id,target_id,id,'synthetic_target_1','synthetic_target_1','ig-stable-fixture-1',
  'unchanged','high',array['target_identity_match_confirmed'],'identity-fixture-history-0001',observed_at
from public.ct_target_availability_observations
where idempotency_key='availability-fixture-observation-0001';

insert into public.ct_target_identity_current (
  tenant_id,account_id,target_id,current_username,stable_platform_user_id,identity_status,
  confidence,last_history_id,last_observed_at
) select
  tenant_id,account_id,target_id,'synthetic_target_1','ig-stable-fixture-1','unchanged','high',id,observed_at
from public.ct_target_identity_history where idempotency_key='identity-fixture-history-0001';

insert into public.ct_target_availability_assessments (
  tenant_id,account_id,target_id,assessment_key,normalized_username,stable_platform_user_id,
  status,confidence,identity_resolution,reason_codes,evidence_count,distinct_run_count,
  distinct_device_count,latest_observed_at,recheck_required,next_recheck_at,
  quarantine_recommended,quarantine_until,terminal_proof,assessed_at,model_version
) values (
  '10000000-0000-0000-0000-000000000000','10000000-0000-0000-0001-000000000001',
  md5('target:1')::uuid,'availability-fixture-assessment-0001','synthetic_target_1','ig-stable-fixture-1',
  'followers_surface_restricted','medium','unchanged',
  array['target_followers_surface_restricted','target_availability_recheck_required'],2,0,1,
  '2026-07-29 09:30:00+00',true,'2026-07-30 09:30:00+00',true,
  '2026-07-30 09:30:00+00',false,'2026-07-29 10:00:00+00','target-availability-v1'
);

insert into public.ct_target_availability_current (tenant_id,account_id,target_id,assessment_id)
select tenant_id,account_id,target_id,id from public.ct_target_availability_assessments
where assessment_key='availability-fixture-assessment-0001';

-- Idempotency is enforced at the database boundary.
do $$
begin
  begin
    insert into public.ct_target_availability_observations (
      tenant_id,account_id,target_id,observed_at,source,searched_username,lookup_result,
      followers_surface,reason_codes,idempotency_key
    ) values (
      '10000000-0000-0000-0000-000000000000','10000000-0000-0000-0001-000000000001',
      md5('target:1')::uuid,now(),'worker','synthetic_target_1','unknown','unknown',
      array['target_ui_ambiguity'],'availability-fixture-observation-0001'
    );
    raise exception 'availability_duplicate_allowed';
  exception when unique_violation then null;
  end;
end
$$;

-- Append-only observations and assessments cannot be altered.
do $$
begin
  begin
    update public.ct_target_availability_observations set lookup_result='failed'
    where idempotency_key='availability-fixture-observation-0001';
    raise exception 'availability_observation_update_allowed';
  exception when raise_exception then
    if sqlerrm <> 'ct_append_only_relation' then raise; end if;
  end;
  begin
    delete from public.ct_target_availability_assessments
    where assessment_key='availability-fixture-assessment-0001';
    raise exception 'availability_assessment_delete_allowed';
  exception when raise_exception then
    if sqlerrm <> 'ct_append_only_relation' then raise; end if;
  end;
end
$$;

select pg_temp.assert_true(
  (select count(*)=2 from public.ct_target_availability_observations),
  'two observations persisted in the rolled-back local contract');
select pg_temp.assert_true(
  (select status='followers_surface_restricted' and terminal_proof=false
   from public.ct_target_availability_assessments
   where assessment_key='availability-fixture-assessment-0001'),
  'badge plus one restriction remains non-terminal');
select pg_temp.assert_true(
  (select count(*)=(select value from availability_target_count_before)
   from public.ig_targets where account_id='10000000-0000-0000-0001-000000000001'),
  'Availability contract does not mutate targets');

rollback;

select 'CT_TARGET_AVAILABILITY_CONTRACT_CERTIFIED' as certification;
