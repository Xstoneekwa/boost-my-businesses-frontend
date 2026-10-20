-- Shared DB smoke only. All fixture writes are rolled back, no provider transport.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
SET LOCAL plpgsql.check_asserts=on;
SET LOCAL request.jwt.claims='{"role":"service_role"}';

DO $fixture$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  -- Reuse only existing FK references. Never create an owner/campaign/business.
  INSERT INTO public.commercial_discovery_runs(
    id,campaign_id,requested_by,provider,country_code,city,subsegment,max_prospects,status,idempotency_key,discovery_status)
  SELECT v_id,campaign_id,requested_by,'searchapi','FR','Paris',null,10,'running',
    'commercial-france-dinum-ledger-smoke-'||v_id::text||'-v1','completed'
  FROM public.commercial_discovery_runs WHERE country_code='FR' ORDER BY created_at LIMIT 1;
  ASSERT FOUND, 'smoke_requires_existing_france_fk_references';
  INSERT INTO public.commercial_france_run_controls(run_id,state,budget_limits_safe,thresholds_safe)
  VALUES(v_id,'armed','{"sirene":2,"searchapi_discovery":60,"searchapi_resolver":10,"public_profiles":10,"site_pages":15,"openai_scoring":4}',
    '{"sample_min":10,"latency_p95_max_ms":15000,"provider_error_rate_max":0.2}');
  PERFORM set_config('bmb.dinum_smoke_fixture',v_id::text,true);
END
$fixture$;

SET LOCAL ROLE service_role;
DO $smoke$
DECLARE
  v_id uuid := current_setting('bmb.dinum_smoke_fixture')::uuid;
  r jsonb; first_call uuid; direct_call uuid; call_id uuid;
  rejected boolean := false;
  passed jsonb := '[]'::jsonb;
BEGIN
  ASSERT has_function_privilege('service_role','public.reserve_commercial_france_provider_call_v1(uuid,text,text,text)','EXECUTE')
    AND NOT has_function_privilege('anon','public.reserve_commercial_france_provider_call_v1(uuid,text,text,text)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.reserve_commercial_france_provider_call_v1(uuid,text,text,text)','EXECUTE');
  passed := passed || jsonb_build_array('service_only_permissions');

  r := public.reserve_commercial_france_provider_call_v1(v_id,'unknown','sirene','unknown:initial');
  ASSERT r->>'reason'='provider_call_kind_invalid';
  passed := passed || jsonb_build_array('unknown_provider_rejected');

  r := public.reserve_commercial_france_provider_call_v1(v_id,'dinum','profile','dinum:wrong-unit');
  ASSERT r->>'reason'='provider_call_kind_invalid';
  passed := passed || jsonb_build_array('dinum_wrong_unit_rpc_rejected');

  BEGIN
    INSERT INTO public.commercial_france_provider_calls(run_id,provider,call_kind,call_key)
    VALUES(v_id,'dinum','profile','dinum:table-wrong-unit');
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  ASSERT rejected;
  passed := passed || jsonb_build_array('dinum_wrong_unit_table_rejected');

  r := public.reserve_commercial_france_provider_call_v1(v_id,'dinum','sirene','dinum:fixture:initial');
  ASSERT r->>'reserved'='true' AND (r->>'used')::int=1 AND (r->>'limit')::int=2;
  first_call := (r->>'call_id')::uuid;
  ASSERT EXISTS(SELECT 1 FROM public.commercial_france_provider_calls WHERE id=first_call AND provider='dinum' AND call_kind='sirene' AND status='reserved');
  passed := passed || jsonb_build_array('dinum_distinct_provider_reserved');

  ASSERT EXISTS(SELECT 1 FROM public.commercial_france_run_controls WHERE run_id=v_id AND state='running' AND budget_limits_safe->>'sirene'='2' AND NOT (budget_limits_safe ? 'dinum'));
  passed := passed || jsonb_build_array('existing_budget_reused_no_new_budget');

  r := public.reserve_commercial_france_provider_call_v1(v_id,'dinum','sirene','dinum:fixture:initial');
  ASSERT r->>'reserved'='false' AND r->>'reason'='idempotent_replay' AND (r->>'call_id')::uuid=first_call;
  ASSERT (SELECT count(*) FROM public.commercial_france_provider_calls WHERE run_id=v_id)=1;
  passed := passed || jsonb_build_array('replay_no_additional_reservation');

  r := public.reserve_commercial_france_provider_call_v1(v_id,'sirene','sirene','sirene:fixture:direct');
  ASSERT r->>'reserved'='true' AND (r->>'used')::int=2 AND (r->>'limit')::int=2;
  direct_call := (r->>'call_id')::uuid;
  passed := passed || jsonb_build_array('direct_sirene_preserved_shared_second_unit');

  r := public.reserve_commercial_france_provider_call_v1(v_id,'dinum','sirene','dinum:fixture:verification');
  ASSERT r->>'reserved'='false' AND r->>'reason'='budget_exceeded' AND (r->>'used')::int=2;
  ASSERT (SELECT count(*) FROM public.commercial_france_provider_calls WHERE run_id=v_id AND call_kind='sirene')=2;
  passed := passed || jsonb_build_array('third_official_lookup_denied_before_transport');

  r := public.reserve_commercial_france_provider_call_v1(v_id,'searchapi','profile','searchapi:fixture:profile');
  ASSERT r->>'reserved'='true';
  call_id := (r->>'call_id')::uuid;
  PERFORM public.finish_commercial_france_provider_call_v1(call_id,'skipped',0,0,'sql_smoke_no_transport');
  passed := passed || jsonb_build_array('searchapi_preserved');

  r := public.reserve_commercial_france_provider_call_v1(v_id,'openai','scoring','openai:fixture:scoring');
  ASSERT r->>'reserved'='true';
  call_id := (r->>'call_id')::uuid;
  PERFORM public.finish_commercial_france_provider_call_v1(call_id,'skipped',0,0,'sql_smoke_no_transport');
  passed := passed || jsonb_build_array('openai_preserved_no_actual_call');

  PERFORM public.finish_commercial_france_provider_call_v1(first_call,'succeeded',1,0);
  PERFORM public.finish_commercial_france_provider_call_v1(direct_call,'succeeded',1,0);
  ASSERT (SELECT count(*) FROM public.commercial_france_provider_calls WHERE run_id=v_id AND finished_at IS NULL)=0;
  passed := passed || jsonb_build_array('generic_finish_preserved');

  r := public.evaluate_commercial_france_run_gate_v1(v_id);
  ASSERT r->>'state'='running' AND r#>>'{latency_classes,sirene,samples}'='2'
    AND r->>'budget_exceeded'='false';
  passed := passed || jsonb_build_array('unchanged_gate_and_latency_accounting');

  UPDATE public.commercial_france_run_controls SET state='hold' WHERE run_id=v_id;
  r := public.reserve_commercial_france_provider_call_v1(v_id,'dinum','sirene','dinum:fixture:hold');
  ASSERT r->>'reason'='run_not_running';
  passed := passed || jsonb_build_array('hold_blocks_reservation');

  UPDATE public.commercial_france_run_controls SET state='stopped' WHERE run_id=v_id;
  r := public.reserve_commercial_france_provider_call_v1(v_id,'dinum','sirene','dinum:fixture:stop');
  ASSERT r->>'reason'='run_not_running';
  passed := passed || jsonb_build_array('stop_blocks_reservation');

  PERFORM set_config('bmb.dinum_smoke_result',jsonb_build_object('tests_passed',jsonb_array_length(passed),
    'tests',passed,'fixture_id',v_id,'provider_calls',0,'rollback_required',true)::text,true);
END
$smoke$;
SELECT current_setting('bmb.dinum_smoke_result')::jsonb AS smoke;
ROLLBACK;
