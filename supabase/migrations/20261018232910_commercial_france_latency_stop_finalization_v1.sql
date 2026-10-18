-- Successor only. No backfill, run sweep, threshold/budget change or new state.
-- Apply separately under DB release authorization; preview GETs do not apply it.
create or replace function public.evaluate_commercial_france_run_gate_v1(p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  c public.commercial_france_run_controls%rowtype;
  v_country text;
  v_total integer; v_classified integer; v_high integer; v_medium integer; v_low integer; v_dup integer;
  v_failed integer; v_finished integer; v_p95 numeric; v_classes jsonb;
  v_high_rate numeric := 0; v_medium_rate numeric := 0; v_error_rate numeric := 0; v_duplicate_rate numeric := 0;
  v_budget_exceeded boolean := false; v_incoherent boolean := false;
  v_hard text := null; v_hold text := null; v_next text; v_metrics jsonb;
  v_serp jsonb; v_serp_attempts integer; v_serp_success integer; v_serp_timeouts integer; v_serp_errors integer;
  v_terminalized integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  select * into c from public.commercial_france_run_controls where run_id=p_run_id for update;
  if c.run_id is null then raise exception 'commercial_france_control_missing' using errcode = 'P0002'; end if;
  select country_code into v_country from public.commercial_discovery_runs where id=p_run_id;
  if v_country is distinct from 'FR' then raise exception 'france_control_missing' using errcode = '22023'; end if;
  v_next := c.state;
  v_metrics := c.metrics_safe;

  -- A STOP is sticky; replay only finishes its unstarted work. HOLD/completed/
  -- cancelled are read-only here, never reopened or reclassified by a replay.
  if c.state in ('armed','running') then
    select count(*)::integer,
      count(*) filter (where coalesce(enrichment_snapshot_safe#>>'{match,confidence}',enrichment_snapshot_safe#>>'{instagram_match,confidence}') in ('HIGH','MEDIUM','LOW'))::integer,
      count(*) filter (where coalesce(enrichment_snapshot_safe#>>'{match,confidence}',enrichment_snapshot_safe#>>'{instagram_match,confidence}')='HIGH')::integer,
      count(*) filter (where coalesce(enrichment_snapshot_safe#>>'{match,confidence}',enrichment_snapshot_safe#>>'{instagram_match,confidence}')='MEDIUM')::integer,
      count(*) filter (where coalesce(enrichment_snapshot_safe#>>'{match,confidence}',enrichment_snapshot_safe#>>'{instagram_match,confidence}')='LOW')::integer,
      count(*) filter (where status in ('duplicate','possible_duplicate','excluded_client'))::integer,
      bool_or(status='completed' and (business_id is null or selected_for_processing is null))
      into v_total,v_classified,v_high,v_medium,v_low,v_dup,v_incoherent
    from public.commercial_discovery_items where run_id=p_run_id;

    -- Existing call_kind is the operation class. A discovery row times the
    -- whole multi-request batch, not one request. Keep it visible but never
    -- compare it to the unchanged 15s unit-operation threshold. Gate each
    -- unit class independently so many fast pages cannot hide slow profiles.
    select coalesce(jsonb_object_agg(call_kind,jsonb_build_object(
        'samples',samples,'p95_ms',p95_ms,'unit_gate_applies',call_kind <> 'discovery')),'{}'::jsonb),
      max(p95_ms) filter (where call_kind <> 'discovery')
      into v_classes,v_p95
    from (
      select call_kind,count(*) as samples,
        percentile_cont(0.95) within group (order by duration_ms) as p95_ms
      from public.commercial_france_provider_calls
      where run_id=p_run_id and duration_ms is not null and status in ('succeeded','failed')
      group by call_kind
    ) latency_by_operation;

    -- Logical operation failures keep their established semantics. Partial
    -- SERP timeouts can coexist with a succeeded discovery batch. Expose the
    -- underlying attempts separately, without rewriting provider history.
    select count(*) filter (where status='failed')::integer,
      count(*) filter (where status in ('succeeded','failed'))::integer
      into v_failed,v_finished from public.commercial_france_provider_calls where run_id=p_run_id;
    select case when jsonb_typeof(provider_diagnostic_safe->'queryDiagnostics')='array'
      then provider_diagnostic_safe->'queryDiagnostics' else '[]'::jsonb end
      into v_serp from public.commercial_discovery_runs where id=p_run_id;
    select count(*)::integer,count(*) filter(where d->>'category'='OK')::integer,
      count(*) filter(where d->>'category'='TIMEOUT')::integer,
      count(*) filter(where coalesce(d->>'category','UNKNOWN') <> 'OK')::integer
      into v_serp_attempts,v_serp_success,v_serp_timeouts,v_serp_errors
    from jsonb_array_elements(v_serp) d;

    select exists(select 1 from public.commercial_france_provider_calls pc where pc.run_id=p_run_id
      and (select count(*) from public.commercial_france_provider_calls x
        where x.run_id=p_run_id and x.call_kind=pc.call_kind and x.status<>'cancelled')
      > coalesce((c.budget_limits_safe ->> case pc.call_kind when 'discovery' then 'searchapi_discovery'
        when 'resolver' then 'searchapi_resolver' when 'site_page' then 'site_pages' when 'profile' then 'public_profiles'
        when 'sirene' then 'sirene' when 'scoring' then 'openai_scoring' end)::integer,0)) into v_budget_exceeded;
    if v_classified > 0 then v_high_rate := v_high::numeric/v_classified; v_medium_rate := v_medium::numeric/v_classified; end if;
    if v_finished > 0 then v_error_rate := v_failed::numeric/v_finished; end if;
    if v_total > 0 then v_duplicate_rate := v_dup::numeric/v_total; end if;
    v_metrics := jsonb_build_object('candidates',v_total,'classified',v_classified,'high',v_high,'medium',v_medium,'low',v_low,
      'high_rate',round(v_high_rate,4),'medium_rate',round(v_medium_rate,4),
      'provider_failed',v_failed,'provider_finished',v_finished,'provider_error_rate',round(v_error_rate,4),
      'serp_attempts',v_serp_attempts,'serp_successes',v_serp_success,'serp_timeouts',v_serp_timeouts,'serp_error_attempts',v_serp_errors,
      'serp_timeout_rate',case when v_serp_attempts > 0 then round(v_serp_timeouts::numeric/v_serp_attempts,4) else null end,
      'duplicates',v_dup,'duplicate_rate',round(v_duplicate_rate,4),'latency_p95_ms',v_p95,
      'latency_classes',v_classes,'latency_gate_scope','unit_operation_class_p95',
      'budget_exceeded',v_budget_exceeded,'persistence_incoherent',coalesce(v_incoherent,false));
    if v_budget_exceeded then v_hard := 'budget_exceeded';
    elsif v_error_rate >= coalesce((c.thresholds_safe->>'provider_error_rate_max')::numeric,0.20)
      and v_finished >= coalesce((c.thresholds_safe->>'sample_min')::integer,10) then v_hard := 'provider_error_rate';
    elsif coalesce(v_p95,0) > coalesce((c.thresholds_safe->>'latency_p95_max_ms')::numeric,15000) then v_hard := 'latency_p95_exceeded';
    elsif coalesce(v_incoherent,false) then v_hard := 'persistence_incoherent';
    elsif v_classified >= coalesce((c.thresholds_safe->>'sample_min')::integer,10)
      and v_high_rate < coalesce((c.thresholds_safe->>'high_rate_min')::numeric,0.10) then v_hold := 'high_rate_below_gate';
    elsif v_classified >= coalesce((c.thresholds_safe->>'sample_min')::integer,10)
      and v_medium_rate > coalesce((c.thresholds_safe->>'medium_rate_max')::numeric,0.50) then v_hold := 'medium_rate_above_gate';
    elsif v_total >= coalesce((c.thresholds_safe->>'sample_min')::integer,10)
      and v_duplicate_rate > coalesce((c.thresholds_safe->>'duplicate_rate_max')::numeric,0.30) then v_hold := 'duplicate_rate_above_gate';
    end if;
    v_next := case when v_hard is not null then 'stopped' when v_hold is not null then 'hold' else 'running' end;
    update public.commercial_france_run_controls set state=v_next,stop_code=coalesce(v_hard,v_hold),
      stop_reason=coalesce(v_hard,v_hold,stop_reason),metrics_safe=v_metrics where run_id=p_run_id;
    c.stop_code := coalesce(v_hard,v_hold);
  end if;

  if v_next='stopped' then
    -- Reuse cancellation states and the run_cancelled audit event, but retain
    -- the breaker reason (never claim this was an owner cancellation). Do not
    -- overwrite acquired results or in-flight work; its touched-run finalizer
    -- will invoke this same idempotent path after the batch settles.
    update public.commercial_discovery_items set status='cancelled',
      completed_at=coalesce(completed_at,now()),next_attempt_at=null,locked_at=null,locked_by=null,
      error_code=coalesce(error_code,c.stop_code),
      error_detail_safe=coalesce(error_detail_safe,'{}'::jsonb) || jsonb_build_object(
        'reason','circuit_breaker_stopped','stop_code',c.stop_code)
    where run_id=p_run_id and status in ('pending','retry_scheduled');
    update public.commercial_discovery_runs r set status='cancelled',
      cancel_requested_at=coalesce(cancel_requested_at,now()),cancelled_at=coalesce(cancelled_at,now()),
      completed_at=coalesce(completed_at,now()),worker_locked_at=null,worker_locked_by=null,
      error_summary_safe=coalesce(error_summary_safe,'{}'::jsonb) || jsonb_build_object('france_circuit_breaker_stop',c.stop_code)
    where r.id=p_run_id and r.status in ('queued','running') and not exists (
      select 1 from public.commercial_discovery_items i where i.run_id=p_run_id
        and i.selected_for_processing and i.status in ('pending','processing','retry_scheduled'));
    get diagnostics v_terminalized = row_count;
    if v_terminalized > 0 then
      insert into public.commercial_discovery_audit_events(run_id,event_type,reason_code,metadata_safe)
      values(p_run_id,'run_cancelled',coalesce(c.stop_code,'circuit_breaker_stopped'),
        jsonb_build_object('source','france_circuit_breaker','control_state','stopped'));
    end if;
  end if;
  return v_metrics || jsonb_build_object('state',v_next,'stop_code',c.stop_code,
    'sample_ready',coalesce((v_metrics->>'classified')::integer,0) >= coalesce((c.thresholds_safe->>'sample_min')::integer,10));
end
$$;
revoke all on function public.evaluate_commercial_france_run_gate_v1(uuid) from public,anon,authenticated;
grant execute on function public.evaluate_commercial_france_run_gate_v1(uuid) to service_role;
