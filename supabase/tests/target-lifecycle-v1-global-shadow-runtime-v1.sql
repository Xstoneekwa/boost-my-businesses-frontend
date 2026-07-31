begin;

do $$
declare
  v_missing text[];
  v_state public.ct_target_lifecycle_runtime_state;
begin
  select array_agg(name order by name) into v_missing
  from unnest(array[
    'ct_target_lifecycle_runtime_state','ct_target_lifecycle_processing_checkpoints',
    'ct_target_lifecycle_pipeline_metrics','ct_target_lifecycle_alert_events',
    'ct_target_lifecycle_cap_counters','ct_target_lifecycle_pipeline_leases'
  ]) name
  where to_regclass('public.'||name) is null;
  if cardinality(coalesce(v_missing,'{}'::text[]))>0 then
    raise exception 'missing lifecycle runtime tables: %',v_missing;
  end if;

  select * into v_state from public.ct_target_lifecycle_runtime_state where id='global';
  if v_state.id is null or v_state.producer_enabled or v_state.current_projector_enabled or v_state.shadow_enabled
    or v_state.scope_mode<>'off' or v_state.enforce_enabled or v_state.business_actions_enabled
    or v_state.lifecycle_actions_enabled or v_state.replacement_enabled or v_state.notifications_enabled
    or v_state.archiving_enabled or v_state.premium_replacement_enabled then
    raise exception 'lifecycle migration is not dormant or shadow-only';
  end if;

  if has_table_privilege('anon','public.ct_target_lifecycle_runtime_state','select')
    or has_table_privilege('authenticated','public.ct_target_lifecycle_assessments','select') then
    raise exception 'lifecycle table leaked to browser roles';
  end if;
  if not has_table_privilege('service_role','public.ct_target_lifecycle_assessments','select')
    or has_table_privilege('service_role','public.ct_target_lifecycle_assessments','delete')
    or has_table_privilege('service_role','public.ct_target_lifecycle_assessments','truncate') then
    raise exception 'lifecycle assessment grants are not least privilege';
  end if;
  if not exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='ct_target_lifecycle_assessments'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then raise exception 'lifecycle assessment RLS/FORCE RLS missing'; end if;

  if has_function_privilege('anon','public.persist_target_lifecycle_shadow_v1(jsonb,text)','execute')
    or has_function_privilege('authenticated','public.persist_target_lifecycle_shadow_v1(jsonb,text)','execute')
    or not has_function_privilege('service_role','public.persist_target_lifecycle_shadow_v1(jsonb,text)','execute') then
    raise exception 'lifecycle persist RPC execute grants invalid';
  end if;
  if has_function_privilege('anon','public.activate_target_lifecycle_global_shadow_v1(bigint,text)','execute')
    or has_function_privilege('authenticated','public.activate_target_lifecycle_global_shadow_v1(bigint,text)','execute') then
    raise exception 'lifecycle activation RPC leaked';
  end if;

  if not exists(
    select 1 from pg_constraint where conname='ct_target_lifecycle_runtime_shadow_only_check'
  ) or not exists(
    select 1 from pg_constraint where conname='ct_target_lifecycle_assessments_shadow_only_v1_check'
  ) then raise exception 'lifecycle no-business-action constraints missing'; end if;
end
$$;

set local request.jwt.claim.role = 'service_role';

do $$
declare
  v_tenant_id uuid := '10000000-0000-0000-0000-000000000000';
  v_account_id uuid := '10000000-0000-0000-0001-000000000001';
  v_target_id uuid;
  v_other_tenant_id uuid := '20000000-0000-0000-0000-000000000000';
  v_state public.ct_target_lifecycle_runtime_state;
  v_bundle jsonb;
  v_result jsonb;
  v_work jsonb;
  v_current_assessment_id uuid;
  v_expected_assessment_id uuid;
  v_lease_id uuid;
begin
  select t.id into strict v_target_id from public.ig_targets t
    where t.account_id=v_account_id and t.normalized_username='synthetic_target_1';
  select * into v_state from public.activate_target_lifecycle_global_shadow_v1(1,'local_contract_test');
  if not v_state.producer_enabled or not v_state.current_projector_enabled or not v_state.shadow_enabled
    or v_state.scope_mode<>'all_active_accounts' or v_state.enforce_enabled or v_state.business_actions_enabled
    or v_state.lifecycle_actions_enabled or v_state.replacement_enabled or v_state.notifications_enabled
    or v_state.archiving_enabled or v_state.premium_replacement_enabled then
    raise exception 'lifecycle activation violated shadow-only contract';
  end if;

  v_work:=public.list_target_lifecycle_work_v1(null,25);
  if jsonb_array_length(v_work->'rows')=0
    or not exists(
      select 1 from jsonb_array_elements(v_work->'rows') row
      where row->>'tenant_id'=v_tenant_id::text and row->>'account_id'=v_account_id::text
    ) then raise exception 'global active-account work list is empty or incorrectly scoped'; end if;
  if not exists(
    select 1 from jsonb_array_elements(v_work->'rows') row
    where row ? 'performance_skips' and row ? 'performance_errors'
      and row ? 'performance_event_observed_at' and row ? 'unique_profiles_evaluated'
  ) then raise exception 'performance skips/errors or utilization numerator missing from work source'; end if;

  if not public.claim_target_lifecycle_assessment_capacity_v1(
    v_account_id,v_target_id,1000,250,'local-capacity-check-0001'
  ) then raise exception 'capacity claim unexpectedly rejected'; end if;
  if (select counter_value from public.ct_target_lifecycle_cap_counters
      where bucket_scope='global' and scope_key='global')<>1
    or (select counter_value from public.ct_target_lifecycle_cap_counters
      where bucket_scope='account' and scope_key=v_account_id::text)<>1 then
    raise exception 'capacity counters did not increment atomically';
  end if;

  v_lease_id:=public.claim_target_lifecycle_pipeline_lease_v1('local-test-worker','local-test-batch-0001',1,60);
  if v_lease_id is null or not public.release_target_lifecycle_pipeline_lease_v1(v_lease_id) then
    raise exception 'pipeline lease claim/release failed';
  end if;

  v_bundle:=jsonb_build_object(
    'tenant_id',v_tenant_id,'account_id',v_account_id,'target_id',v_target_id,
    'normalized_username','synthetic_target_1','assessment_key','local-lifecycle-assessment-0001',
    'source_fingerprint',repeat('a',64),'source_availability_assessment_id',null,
    'source_max_observed_at','2026-07-31T12:00:00.000Z','status','insufficient_data',
    'availability_status','insufficient','performance_status','insufficient','utilization_status','insufficient_data',
    'utilization_ratio',null,'unique_profiles_evaluated',0,'estimated_exploitable_audience',null,
    'denominator_source','ig_targets.followers_count','denominator_version','ig-target-followers-v1',
    'confidence','unknown','identity_status','insufficient_identity_evidence',
    'reason_codes',jsonb_build_array('lifecycle_source_evidence_insufficient'),
    'missing_evidence',jsonb_build_array('availability','performance','utilization'),
    'replacement_state','none','recommended_action','collect_more_evidence',
    'assessed_at','2026-07-31T12:00:00.000Z','valid_until','2026-08-14T12:00:00.000Z',
    'engine_version','target-lifecycle-global-shadow-v1','rule_version','target-lifecycle-priority-v1',
    'policy_version','target-lifecycle-no-action-v1','engine_revision',2,'policy_revision',2,
    'explanation_safe',jsonb_build_object('mode','global_shadow','source_fingerprint',repeat('a',64)),
    'enforcement_allowed',false,'business_action_allowed',false,'mutation_executed',false,
    'performance_observation',jsonb_build_object(
      'source_event_key','local-performance-observation-0001','follows',120,'followbacks',18,
      'reliability','strong','observed_at','2026-07-31T11:00:00.000Z','reason','legacy_counter',
      'metadata_safe',jsonb_build_object('source','local_contract_test')
    )
  );

  v_result:=public.persist_target_lifecycle_shadow_v1(v_bundle,'local-test-release');
  if v_result->>'outcome'<>'processed' or coalesce((v_result->>'business_actions')::integer,-1)<>0 then
    raise exception 'first lifecycle persistence was not action-free processed: %',v_result;
  end if;
  v_expected_assessment_id:=(v_result->>'assessment_id')::uuid;

  v_result:=public.persist_target_lifecycle_shadow_v1(v_bundle,'local-test-release');
  if v_result->>'outcome'<>'deduplicated' then raise exception 'lifecycle replay was not deduplicated: %',v_result; end if;

  v_result:=public.persist_target_lifecycle_shadow_v1(
    jsonb_set(jsonb_set(v_bundle,'{assessment_key}','"local-lifecycle-assessment-0002"'),
      '{source_max_observed_at}','"2026-07-31T10:00:00.000Z"'),'local-test-release'
  );
  if v_result->>'outcome'<>'out_of_order_skipped' then raise exception 'out-of-order lifecycle event was not skipped: %',v_result; end if;

  v_result:=public.persist_target_lifecycle_shadow_v1(
    jsonb_set(jsonb_set(jsonb_set(v_bundle,'{assessment_key}','"local-lifecycle-assessment-0003"'),
      '{source_max_observed_at}','"2026-07-31T13:00:00.000Z"'),'{engine_revision}','1'),'local-test-release'
  );
  if v_result->>'outcome'<>'version_regression_skipped' then raise exception 'version regression was not skipped: %',v_result; end if;

  v_result := public.persist_target_lifecycle_shadow_v1(
    jsonb_set(jsonb_set(jsonb_set(v_bundle,
      '{assessment_key}','"local-lifecycle-assessment-policy-regression"'),
      '{source_fingerprint}','"1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd77"'),
      '{policy_revision}','1'),
    'local-test-release'
  );
  if v_result->>'outcome'<>'version_regression_skipped' then raise exception 'policy regression was not skipped: %',v_result; end if;

  select assessment_id into v_current_assessment_id from public.ct_target_lifecycle_current
    where tenant_id=v_tenant_id and account_id=v_account_id and target_id=v_target_id;
  if v_current_assessment_id<>v_expected_assessment_id then raise exception 'CAS current projector selected the wrong assessment'; end if;

  v_result:=public.persist_target_lifecycle_shadow_v1(
    jsonb_set(jsonb_set(v_bundle,'{tenant_id}',to_jsonb(v_other_tenant_id)),
      '{assessment_key}','"local-lifecycle-cross-tenant-0001"'),'local-test-release'
  );
  if v_result->>'outcome'<>'cross_tenant_rejected' then raise exception 'cross-tenant lifecycle write was not rejected: %',v_result; end if;

  if (select count(*) from public.ct_target_lifecycle_assessments
      where enforcement_allowed or business_action_allowed or mutation_executed)<>0 then
    raise exception 'lifecycle assessment authorized a business action';
  end if;

  if not public.record_target_lifecycle_pipeline_metric_v1(
    'local-lifecycle-metric-0001',jsonb_build_object('business_actions',0,'notifications',0,'archives',0,'replacements',0),
    10,5,9,1,1000,1000
  ) then raise exception 'pipeline metric was not persisted'; end if;

  select * into v_state from public.trigger_target_lifecycle_auto_kill_v1(
    'local_contract_critical_signal','local_contract_test',jsonb_build_object('cross_tenant',0)
  );
  if not v_state.auto_killed or not v_state.human_reenable_required or v_state.producer_enabled
    or v_state.current_projector_enabled or v_state.shadow_enabled or v_state.scope_mode<>'off' then
    raise exception 'automatic kill did not restore dormant fail-closed state';
  end if;
end
$$;

rollback;
