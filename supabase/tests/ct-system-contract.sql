\set ON_ERROR_STOP on
set request.jwt.claim.role = 'service_role';

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition,false) then raise exception 'assertion_failed: %',p_message; end if;
end
$$;

select pg_temp.assert_true(
  (select count(*)=12 from pg_tables where schemaname='public' and tablename in (
    'ct_target_evaluation_events','ct_target_evaluated_profiles','ct_target_performance_observations',
    'ct_target_performance_aggregates','ct_target_lifecycle_assessments','ct_target_lifecycle_current',
    'ct_targeting_criteria_snapshots','ct_proposal_batches','ct_proposals','ct_proposal_events',
    'ct_target_replacement_links','ct_email_contract_references'
  )), 'all CT tables exist');

select pg_temp.assert_true(
  (select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname like 'ct_%' and c.relkind='r'),
  'RLS enabled on all CT tables');

select pg_temp.assert_true(not has_table_privilege('anon','public.ct_proposals','SELECT'),'anon denied');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ct_proposals','SELECT'),'authenticated direct read denied');
select pg_temp.assert_true(has_table_privilege('service_role','public.ct_proposals','SELECT,INSERT,UPDATE'),'service role allowed');
select pg_temp.assert_true(not has_table_privilege('anon','public.client_account_notifications','UPDATE'),'anon notification update denied');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.client_account_notifications','UPDATE'),'authenticated notification update denied');
select pg_temp.assert_true(has_table_privilege('service_role','public.client_account_notifications','SELECT,INSERT,UPDATE,DELETE'),'service notification access allowed');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.client_account_notifications'::regclass),'notification RLS remains enabled');
select pg_temp.assert_true((select count(*)=0 from pg_policies where schemaname='public' and tablename='client_account_notifications'),'notification user policy remains absent');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.ct_activate_premium_proposal_v1(uuid,uuid,uuid,text,timestamptz)','EXECUTE'),'authenticated activation denied');
select pg_temp.assert_true(has_function_privilege('service_role','public.ct_activate_premium_proposal_v1(uuid,uuid,uuid,text,timestamptz)','EXECUTE'),'service activation allowed');

do $$
begin
  begin
    perform * from public.ct_resolve_owned_premium_account_v1(
      '10000000-0000-0000-0001-000000000001','90000000-0000-0000-0000-000000000001'
    );
    raise exception 'outsider_was_not_rejected';
  exception when insufficient_privilege then null;
  end;
end
$$;

do $$
declare v_target integer; v_count integer; v_s integer;
begin
  foreach v_target in array array[75,80,85,90] loop
    v_count := v_target;
    for v_s in 1..v_count loop
      perform public.ct_record_target_evaluation_event_v1(
        '10000000-0000-0000-0001-000000000001',
        md5('target:'||(case v_target when 75 then 1 when 80 then 2 when 85 then 3 else 4 end)::text)::uuid,
        'u'||v_target||'_'||lpad(v_s::text,3,'0'),
        '2026-07-28 10:00:00+00','eligible',null,'fixture-worker','verified','fixture-v1',
        'eval-'||v_target||'-'||lpad(v_s::text,3,'0'),'{}'::jsonb
      );
    end loop;
  end loop;
end
$$;

-- Same observed profile, new outcome: event grows, lifecycle numerator does not.
select public.ct_record_target_evaluation_event_v1(
  '10000000-0000-0000-0001-000000000001',md5('target:1')::uuid,'u75_001',
  '2026-07-28 10:01:00+00','filtered',null,'fixture-worker','verified','fixture-v1','eval-75-breakdown','{}'
);
select public.ct_record_target_evaluation_event_v1(
  '10000000-0000-0000-0001-000000000001',md5('target:1')::uuid,'u75_001',
  '2026-07-28 10:01:00+00','filtered',null,'fixture-worker','verified','fixture-v1','eval-75-breakdown','{}'
);
select pg_temp.assert_true((select count(*)=76 from public.ct_target_evaluation_events where target_id=md5('target:1')::uuid),'event idempotence');
select pg_temp.assert_true((select count(*)=75 from public.ct_target_evaluated_profiles where target_id=md5('target:1')::uuid),'unique numerator');
select pg_temp.assert_true((select min(business_date)='2026-07-28'::date from public.ct_target_evaluation_events),'SAST business date');

select public.ct_recompute_target_lifecycle_v1('10000000-0000-0000-0001-000000000001',md5('target:1')::uuid,100,'fixture','v1','high','threshold-75','2026-07-28 12:00:00+00');
select public.ct_recompute_target_lifecycle_v1('10000000-0000-0000-0001-000000000001',md5('target:2')::uuid,100,'fixture','v1','high','threshold-80','2026-07-28 12:00:00+00');
select public.ct_recompute_target_lifecycle_v1('10000000-0000-0000-0001-000000000001',md5('target:3')::uuid,100,'fixture','v1','high','threshold-85','2026-07-28 12:00:00+00');
select public.ct_recompute_target_lifecycle_v1('10000000-0000-0000-0001-000000000001',md5('target:4')::uuid,100,'fixture','v1','high','threshold-90','2026-07-28 12:00:00+00');
select public.ct_recompute_target_lifecycle_v1('10000000-0000-0000-0001-000000000001',md5('target:5')::uuid,100,'fixture','v1','low','low-confidence','2026-07-28 12:00:00+00');
select public.ct_recompute_target_lifecycle_v1('10000000-0000-0000-0001-000000000001',md5('target:1')::uuid,100,'fixture','v1','high','stale','2026-09-01 12:00:00+00');

select pg_temp.assert_true((select status='watch' from public.ct_target_lifecycle_assessments where assessment_key='threshold-75'),'75 threshold');
select pg_temp.assert_true((select status='replacement_recommended' from public.ct_target_lifecycle_assessments where assessment_key='threshold-80'),'80 threshold');
select pg_temp.assert_true((select status='replacement_pending' from public.ct_target_lifecycle_assessments where assessment_key='threshold-85'),'85 threshold');
select pg_temp.assert_true((select status='exhausted' from public.ct_target_lifecycle_assessments where assessment_key='threshold-90'),'90 threshold');
select pg_temp.assert_true((select status='insufficient_data' from public.ct_target_lifecycle_assessments where assessment_key='low-confidence'),'low confidence');
select pg_temp.assert_true((select status='stale_data' from public.ct_target_lifecycle_assessments where assessment_key='stale'),'stale data');

-- Restore the current assessment for target 1 after the stale-history test.
select public.ct_recompute_target_lifecycle_v1('10000000-0000-0000-0001-000000000001',md5('target:1')::uuid,100,'fixture','v1','high','threshold-75-current','2026-07-28 12:01:00+00');

insert into public.ct_target_performance_observations (
  tenant_id,account_id,source_target_id,business_date,window_kind,follows,followbacks,
  reliability,reason,observed_at,source_event_key
) values (
  '10000000-0000-0000-0000-000000000000','10000000-0000-0000-0001-000000000001',
  md5('target:1')::uuid,'2026-07-28','business_day',10,5,'verified','worker_verified',
  '2026-07-28 12:00:00+00','performance-fixture-1'
);
select pg_temp.assert_true((select fbr=0.5 from public.ct_target_performance_observations where source_event_key='performance-fixture-1'),'FBR computed independently');
select pg_temp.assert_true((select unique_profiles_evaluated=75 from public.ct_target_lifecycle_assessments where assessment_key='threshold-75'),'FBR does not alter utilization');
select pg_temp.assert_true((select replacement_pending_in_stock=1 from public.ct_target_lifecycle_stock_v1 where account_id='10000000-0000-0000-0001-000000000001'),'replacement pending remains in stock');

do $$
begin
  begin
    update public.ct_target_evaluation_events set outcome='failed'
    where id=(select id from public.ct_target_evaluation_events order by id limit 1);
    raise exception 'append_only_update_allowed';
  exception when raise_exception then
    if sqlerrm <> 'ct_append_only_relation' then raise; end if;
  end;
end
$$;

create temporary table fixture_batch_result as
select public.ct_create_premium_proposal_batch_v1(
  '10000000-0000-0000-0001-000000000001','10000000-0000-0000-0000-000000000001',
  'batch-idempotency-0001','low_stock',
  jsonb_build_object('eligibleTargetCount',6,'activeTargets','[]'::jsonb,'blacklistFingerprint','fixture'),
  (select jsonb_agg(jsonb_build_object(
    'username','candidate_'||s,'displayUsername','candidate_'||s,'score',100-s,
    'eligibilityStatus','eligible','replacementOfTargetId',case when s=3 then md5('target:3')::text else null end
  )) from generate_series(1,10)s),
  '2026-07-28 12:00:00+00'
) result;

select public.ct_create_premium_proposal_batch_v1(
  '10000000-0000-0000-0001-000000000001','10000000-0000-0000-0000-000000000001',
  'batch-idempotency-0001','low_stock',
  jsonb_build_object('eligibleTargetCount',6,'activeTargets','[]'::jsonb,'blacklistFingerprint','fixture'),
  (select jsonb_agg(jsonb_build_object('username','candidate_'||s,'displayUsername','candidate_'||s,'score',100-s,'eligibilityStatus','eligible')) from generate_series(1,10)s),
  '2026-07-28 12:00:00+00'
);
select pg_temp.assert_true((select count(*)=1 from public.ct_proposal_batches where idempotency_key='batch-idempotency-0001'),'batch idempotence');
select pg_temp.assert_true((select count(*)=10 from public.ct_proposals p join public.ct_proposal_batches b on b.id=p.batch_id where b.idempotency_key='batch-idempotency-0001'),'batch size 10');
select pg_temp.assert_true((select review_expires_at-ready_at=interval '5 days' from public.ct_proposal_batches where idempotency_key='batch-idempotency-0001'),'J+5 exact');

select public.ct_decide_premium_proposal_v1(
  '10000000-0000-0000-0001-000000000001',(select id from public.ct_proposals where normalized_username='candidate_1'),
  '10000000-0000-0000-0000-000000000001','accept','decision-candidate-1','2026-07-28 12:01:00+00'
);
select public.ct_decide_premium_proposal_v1(
  '10000000-0000-0000-0001-000000000001',(select id from public.ct_proposals where normalized_username='candidate_1'),
  '10000000-0000-0000-0000-000000000001','accept','decision-candidate-1','2026-07-28 12:01:00+00'
);
do $$ begin
  begin
    perform public.ct_decide_premium_proposal_v1(
      '10000000-0000-0000-0001-000000000001',(select id from public.ct_proposals where normalized_username='candidate_1'),
      '10000000-0000-0000-0000-000000000001','reject','conflicting-decision','2026-07-28 12:02:00+00');
    raise exception 'conflicting_decision_allowed';
  exception when serialization_failure then null; end;
end $$;

select public.ct_decide_premium_proposal_v1(
  '10000000-0000-0000-0001-000000000001',(select id from public.ct_proposals where normalized_username='candidate_2'),
  '10000000-0000-0000-0000-000000000001','reject','decision-candidate-2','2026-07-28 12:01:00+00'
);
update public.ct_proposal_batches set ready_at='2026-07-22 12:00:00+00',review_expires_at='2026-07-27 12:00:00+00'
where idempotency_key='batch-idempotency-0001';
select public.ct_claim_expired_premium_batch_v1('fixture-timeout-worker','2026-07-28 12:00:00+00');
select pg_temp.assert_true((select status='rejected' from public.ct_proposals where normalized_username='candidate_2'),'rejected never auto accepted');
select pg_temp.assert_true((select status='auto_accepted' from public.ct_proposals where normalized_username='candidate_3'),'pending auto accepted at J+5');

select public.ct_activate_premium_proposal_v1(
  '10000000-0000-0000-0001-000000000001',(select id from public.ct_proposals where normalized_username='candidate_1'),
  '10000000-0000-0000-0000-000000000001','activate-candidate-1','2026-07-28 12:03:00+00'
);
select public.ct_activate_premium_proposal_v1(
  '10000000-0000-0000-0001-000000000001',(select id from public.ct_proposals where normalized_username='candidate_1'),
  '10000000-0000-0000-0000-000000000001','activate-candidate-1','2026-07-28 12:03:00+00'
);
select pg_temp.assert_true((select count(*)=1 from public.ig_targets where account_id='10000000-0000-0000-0001-000000000001' and normalized_username='candidate_1'),'activation idempotent');

select public.ct_activate_premium_proposal_v1(
  '10000000-0000-0000-0001-000000000001',(select id from public.ct_proposals where normalized_username='candidate_3'),
  '10000000-0000-0000-0000-000000000001','activate-candidate-3','2026-07-28 12:04:00+00'
);
select pg_temp.assert_true((select state='ready' from public.ct_target_replacement_links l join public.ct_proposals p on p.id=l.proposal_id where p.normalized_username='candidate_3'),'replacement first link ready');
select pg_temp.assert_true((select status='valid' from public.ig_targets where id=md5('target:3')::uuid),'old target not archived');

insert into public.account_protection_list_entries (account_id,list_kind,normalized_username,active,source_surface)
values ('10000000-0000-0000-0001-000000000001','interaction_blacklist','candidate_4',true,'fixture');
do $$ begin
  begin
    perform public.ct_activate_premium_proposal_v1(
      '10000000-0000-0000-0001-000000000001',(select id from public.ct_proposals where normalized_username='candidate_4'),
      '10000000-0000-0000-0000-000000000001','activate-candidate-4','2026-07-28 12:06:00+00');
    raise exception 'blacklist_activation_allowed';
  exception when check_violation then null; end;
end $$;
select pg_temp.assert_true((select status='auto_accepted' and activated_target_id is null from public.ct_proposals where normalized_username='candidate_4'),'activation rollback complete');

do $$ begin
  update public.ig_accounts set admin_lifecycle_status='paused' where id='10000000-0000-0000-0001-000000000001';
  begin perform * from public.ct_resolve_owned_premium_account_v1('10000000-0000-0000-0001-000000000001',null); raise exception 'pause_not_blocked'; exception when insufficient_privilege then null; end;
  update public.ig_accounts set admin_lifecycle_status='active' where id='10000000-0000-0000-0001-000000000001';

  update public.client_account_entitlements set plan_key='pro',commercial_package_code='pro' where account_id='10000000-0000-0000-0001-000000000001';
  begin perform * from public.ct_resolve_owned_premium_account_v1('10000000-0000-0000-0001-000000000001',null); raise exception 'downgrade_not_blocked'; exception when insufficient_privilege then null; end;
  update public.client_account_entitlements set plan_key='premium',commercial_package_code='premium' where account_id='10000000-0000-0000-0001-000000000001';

  update public.ig_accounts set admin_lifecycle_status='cancelled' where id='10000000-0000-0000-0001-000000000001';
  begin perform * from public.ct_resolve_owned_premium_account_v1('10000000-0000-0000-0001-000000000001',null); raise exception 'cancel_not_blocked'; exception when insufficient_privilege then null; end;
  update public.ig_accounts set admin_lifecycle_status='active' where id='10000000-0000-0000-0001-000000000001';
end $$;

insert into public.client_account_notifications (
  client_id,account_id,category,notification_key,action_required,action_ref_type,action_ref_id
) values (
  '10000000-0000-0000-0000-000000000000','10000000-0000-0000-0001-000000000001',
  'premium_ct_review_required','fixture-premium-review',true,'proposal_batch',
  (select id from public.ct_proposal_batches where idempotency_key='batch-idempotency-0001')
);
update public.client_account_notifications set action_completed_at=now(),action_outcome='completed'
where notification_key='fixture-premium-review';
select pg_temp.assert_true((select action_completed_at is not null and action_outcome='completed' from public.client_account_notifications where notification_key='fixture-premium-review'),'notification action state');
select pg_temp.assert_true((select count(*)=8 and bool_and(not enabled) from public.ct_email_contract_references),'email contracts disabled');

select 'CT_SYSTEM_SQL_CONTRACT_CERTIFIED' as certification;
