create or replace function public.ct_assert_service_role_v1()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not pg_has_role(current_user, 'service_role', 'member') then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
end
$$;

create or replace function public.ct_resolve_owned_premium_account_v1(
  p_account_id uuid,
  p_actor_auth_user_id uuid default null
)
returns table (tenant_id uuid, entitlement_id uuid, entitlement_version text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ct_assert_service_role_v1();

  return query
  select cia.client_id,
         cae.id,
         coalesce(cae.metadata->>'version', cae.updated_at::text)
  from public.client_instagram_accounts cia
  join public.clients c on c.id = cia.client_id and c.status = 'active'
  join public.ig_accounts ia on ia.id = cia.account_id
  join public.client_account_entitlements cae
    on cae.client_id = cia.client_id
   and cae.account_id = cia.account_id
   and cae.status = 'entitlement_consumed'
   and cae.commercial_package_code = 'premium'
  where cia.account_id = p_account_id
    and cia.active
    and ia.admin_lifecycle_status = 'active'
    and (
      p_actor_auth_user_id is null or exists (
        select 1 from public.client_users cu
        where cu.client_id = cia.client_id
          and cu.auth_user_id = p_actor_auth_user_id
          and cu.status = 'active'
      )
    )
  order by cae.consumed_at desc nulls last, cae.updated_at desc
  limit 1;

  if not found then
    raise exception 'premium_account_ownership_or_state_invalid' using errcode = '42501';
  end if;
end
$$;

create or replace function public.ct_record_target_evaluation_event_v1(
  p_account_id uuid,
  p_target_id uuid,
  p_normalized_username text,
  p_evaluated_at timestamptz,
  p_outcome text,
  p_source_run_id uuid,
  p_source_worker text,
  p_attribution_reliability text,
  p_worker_version text,
  p_idempotency_key text,
  p_metadata_safe jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_username text := lower(btrim(coalesce(p_normalized_username, '')));
  v_event_id uuid;
  v_event_created boolean := false;
  v_profile_created boolean := false;
  v_rows integer := 0;
begin
  select r.tenant_id into v_tenant_id
  from public.ct_resolve_owned_premium_account_v1(p_account_id, null) r;

  if not exists (
    select 1 from public.ig_targets t
    where t.id = p_target_id and t.account_id = p_account_id
  ) then
    raise exception 'target_account_mismatch' using errcode = '23514';
  end if;

  insert into public.ct_target_evaluation_events (
    tenant_id, account_id, target_id, normalized_username, evaluated_at, business_date,
    outcome, source_run_id, source_worker, attribution_reliability, worker_version,
    idempotency_key, metadata_safe
  ) values (
    v_tenant_id, p_account_id, p_target_id, v_username, p_evaluated_at,
    (p_evaluated_at at time zone 'Africa/Johannesburg')::date,
    p_outcome, p_source_run_id, nullif(btrim(p_source_worker), ''), p_attribution_reliability,
    nullif(btrim(p_worker_version), ''), p_idempotency_key, coalesce(p_metadata_safe, '{}'::jsonb)
  )
  on conflict (tenant_id, account_id, idempotency_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select e.id into v_event_id
    from public.ct_target_evaluation_events e
    where e.tenant_id = v_tenant_id
      and e.account_id = p_account_id
      and e.idempotency_key = p_idempotency_key
      and e.target_id = p_target_id
      and e.normalized_username = v_username;
    if v_event_id is null then
      raise exception 'idempotency_key_payload_mismatch' using errcode = '23505';
    end if;
  else
    v_event_created := true;
  end if;

  insert into public.ct_target_evaluated_profiles (
    tenant_id, account_id, target_id, normalized_username, first_event_id,
    first_evaluated_at, first_business_date
  ) values (
    v_tenant_id, p_account_id, p_target_id, v_username, v_event_id,
    p_evaluated_at, (p_evaluated_at at time zone 'Africa/Johannesburg')::date
  )
  on conflict (tenant_id, account_id, target_id, normalized_username) do nothing;
  get diagnostics v_rows = row_count;
  v_profile_created := v_rows = 1;

  return jsonb_build_object(
    'eventId', v_event_id,
    'eventCreated', v_event_created,
    'uniqueProfileCreated', v_profile_created,
    'businessDate', (p_evaluated_at at time zone 'Africa/Johannesburg')::date
  );
end
$$;

create or replace function public.ct_recompute_target_lifecycle_v1(
  p_account_id uuid,
  p_target_id uuid,
  p_estimated_exploitable_audience integer,
  p_denominator_source text,
  p_denominator_version text,
  p_confidence text,
  p_assessment_key text,
  p_assessed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_unique_count integer;
  v_ratio numeric;
  v_status text;
  v_replacement_state text := 'none';
  v_assessment_id uuid;
  v_last_evaluated_at timestamptz;
begin
  select r.tenant_id into v_tenant_id
  from public.ct_resolve_owned_premium_account_v1(p_account_id, null) r;

  perform 1 from public.ig_targets t
  where t.id = p_target_id and t.account_id = p_account_id
  for update;
  if not found then
    raise exception 'target_account_mismatch' using errcode = '23514';
  end if;

  select count(*)::integer, max(first_evaluated_at)
    into v_unique_count, v_last_evaluated_at
  from public.ct_target_evaluated_profiles
  where tenant_id = v_tenant_id and account_id = p_account_id and target_id = p_target_id;

  if p_estimated_exploitable_audience is not null and p_estimated_exploitable_audience > 0 then
    v_ratio := v_unique_count::numeric / p_estimated_exploitable_audience::numeric;
  end if;

  v_status := case
    when p_confidence in ('low','unknown') or p_estimated_exploitable_audience is null then 'insufficient_data'
    when v_last_evaluated_at is null or v_last_evaluated_at < p_assessed_at - interval '30 days' then 'stale_data'
    when v_ratio >= 0.90 then 'exhausted'
    when v_ratio >= 0.85 then 'replacement_pending'
    when v_ratio >= 0.80 then 'replacement_recommended'
    when v_ratio >= 0.75 then 'watch'
    else 'healthy'
  end;

  v_replacement_state := case v_status
    when 'replacement_recommended' then 'recommended'
    when 'replacement_pending' then 'pending'
    when 'exhausted' then 'pending'
    else 'none'
  end;

  insert into public.ct_target_lifecycle_assessments (
    tenant_id, account_id, target_id, assessment_key, status, utilization_ratio,
    unique_profiles_evaluated, estimated_exploitable_audience, denominator_source,
    denominator_version, confidence, reason_codes, replacement_state, assessed_at
  ) values (
    v_tenant_id, p_account_id, p_target_id, p_assessment_key, v_status, v_ratio,
    v_unique_count, p_estimated_exploitable_audience, p_denominator_source,
    p_denominator_version, p_confidence, array[v_status], v_replacement_state, p_assessed_at
  )
  on conflict (tenant_id, account_id, target_id, assessment_key) do nothing
  returning id into v_assessment_id;

  if v_assessment_id is null then
    select id into v_assessment_id
    from public.ct_target_lifecycle_assessments
    where tenant_id = v_tenant_id and account_id = p_account_id
      and target_id = p_target_id and assessment_key = p_assessment_key;
  end if;

  insert into public.ct_target_lifecycle_current (tenant_id, account_id, target_id, assessment_id)
  values (v_tenant_id, p_account_id, p_target_id, v_assessment_id)
  on conflict (tenant_id, account_id, target_id) do update
    set assessment_id = excluded.assessment_id, updated_at = now();

  return jsonb_build_object(
    'assessmentId', v_assessment_id,
    'status', v_status,
    'uniqueProfilesEvaluated', v_unique_count,
    'utilizationRatio', v_ratio,
    'replacementState', v_replacement_state
  );
end
$$;

create or replace function public.ct_create_premium_proposal_batch_v1(
  p_account_id uuid,
  p_actor_auth_user_id uuid,
  p_idempotency_key text,
  p_trigger_reason text,
  p_snapshot jsonb,
  p_proposals jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_entitlement_id uuid;
  v_entitlement_version text;
  v_snapshot_id uuid;
  v_batch_id uuid;
  v_existing boolean := false;
  v_fingerprint text;
  v_proposal jsonb;
  v_username text;
  v_count integer;
begin
  select r.tenant_id, r.entitlement_id, r.entitlement_version
    into v_tenant_id, v_entitlement_id, v_entitlement_version
  from public.ct_resolve_owned_premium_account_v1(p_account_id, p_actor_auth_user_id) r;

  if jsonb_typeof(p_snapshot) <> 'object' or jsonb_typeof(p_proposals) <> 'array' then
    raise exception 'snapshot_or_proposals_invalid' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_proposals);
  if v_count < 1 or v_count > 20 then
    raise exception 'proposal_batch_size_invalid' using errcode = '22023';
  end if;

  v_fingerprint := encode(extensions.digest(p_snapshot::text, 'sha256'), 'hex');
  insert into public.ct_targeting_criteria_snapshots (
    tenant_id, account_id, plan, entitlement_id, entitlement_version,
    eligible_target_count, active_targets, blacklist_fingerprint, languages,
    geographies, niches, follower_range, engagement_expectations, account_analysis_data,
    target_performance_summary, lifecycle_summary, scoring_config_version,
    search_strategy_version, review_duration, batch_size, rejection_cooldown,
    trigger_reason, canonical_payload, fingerprint, created_at
  ) values (
    v_tenant_id, p_account_id, 'premium', v_entitlement_id, v_entitlement_version,
    coalesce((p_snapshot->>'eligibleTargetCount')::integer, 0), coalesce(p_snapshot->'activeTargets','[]'::jsonb),
    coalesce(p_snapshot->>'blacklistFingerprint','none'), coalesce(p_snapshot->'languages','[]'::jsonb),
    coalesce(p_snapshot->'geographies','[]'::jsonb), coalesce(p_snapshot->'niches','[]'::jsonb),
    coalesce(p_snapshot->'followerRange','{}'::jsonb), coalesce(p_snapshot->'engagementExpectations','{}'::jsonb),
    coalesce(p_snapshot->'accountAnalysisData','{}'::jsonb), coalesce(p_snapshot->'targetPerformanceSummary','{}'::jsonb),
    coalesce(p_snapshot->'lifecycleSummary','{}'::jsonb), coalesce(p_snapshot->>'scoringConfigVersion','v1'),
    coalesce(p_snapshot->>'searchStrategyVersion','v1'), interval '5 days', v_count,
    interval '30 days', p_trigger_reason, p_snapshot, v_fingerprint, p_now
  )
  on conflict (tenant_id, account_id, fingerprint) do nothing
  returning id into v_snapshot_id;

  if v_snapshot_id is null then
    select id into v_snapshot_id from public.ct_targeting_criteria_snapshots
    where tenant_id=v_tenant_id and account_id=p_account_id and fingerprint=v_fingerprint;
  end if;

  insert into public.ct_proposal_batches (
    tenant_id, account_id, snapshot_id, status, trigger_reason, idempotency_key,
    ready_at, review_expires_at, created_at, updated_at
  ) values (
    v_tenant_id, p_account_id, v_snapshot_id, 'ready_for_review', p_trigger_reason,
    p_idempotency_key, p_now, p_now + interval '5 days', p_now, p_now
  )
  on conflict (tenant_id, account_id, idempotency_key) do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    v_existing := true;
    select id into v_batch_id from public.ct_proposal_batches
    where tenant_id=v_tenant_id and account_id=p_account_id and idempotency_key=p_idempotency_key;
    return jsonb_build_object('batchId',v_batch_id,'snapshotId',v_snapshot_id,'created',false);
  end if;

  for v_proposal in select value from jsonb_array_elements(p_proposals)
  loop
    v_username := lower(btrim(coalesce(v_proposal->>'normalizedUsername', v_proposal->>'username', '')));
    insert into public.ct_proposals (
      tenant_id, account_id, batch_id, snapshot_id, replacement_of_target_id,
      normalized_username, display_username, candidate_data, score, score_breakdown,
      scoring_version, eligibility_status, exclusion_reasons
    ) values (
      v_tenant_id, p_account_id, v_batch_id, v_snapshot_id,
      nullif(v_proposal->>'replacementOfTargetId','')::uuid, v_username,
      coalesce(nullif(btrim(v_proposal->>'displayUsername'),''), v_username),
      coalesce(v_proposal->'candidateData','{}'::jsonb), coalesce((v_proposal->>'score')::numeric,0),
      coalesce(v_proposal->'scoreBreakdown','{}'::jsonb), coalesce(v_proposal->>'scoringVersion','v1'),
      coalesce(v_proposal->>'eligibilityStatus','eligible'),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_proposal->'exclusionReasons','[]'::jsonb))), '{}')
    );
  end loop;

  insert into public.ct_proposal_events (
    tenant_id, account_id, batch_id, event_type, actor_type, actor_id, idempotency_key, payload_safe, occurred_at
  ) values (
    v_tenant_id, p_account_id, v_batch_id, 'batch_ready', 'service', p_actor_auth_user_id,
    p_idempotency_key || ':batch-ready', jsonb_build_object('proposalCount',v_count), p_now
  );

  return jsonb_build_object('batchId',v_batch_id,'snapshotId',v_snapshot_id,'created',not v_existing,'proposalCount',v_count);
end
$$;

create or replace function public.ct_decide_premium_proposal_v1(
  p_account_id uuid,
  p_proposal_id uuid,
  p_actor_auth_user_id uuid,
  p_decision text,
  p_idempotency_key text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_proposal public.ct_proposals%rowtype;
  v_status text;
begin
  select r.tenant_id into v_tenant_id
  from public.ct_resolve_owned_premium_account_v1(p_account_id, p_actor_auth_user_id) r;
  if p_decision not in ('accept','reject') then raise exception 'decision_invalid'; end if;

  select * into v_proposal from public.ct_proposals
  where id=p_proposal_id and tenant_id=v_tenant_id and account_id=p_account_id
  for update;
  if not found then raise exception 'proposal_not_found' using errcode='P0002'; end if;

  v_status := case when p_decision='accept' then 'accepted' else 'rejected' end;
  if v_proposal.status = v_status then
    return jsonb_build_object('proposalId',p_proposal_id,'status',v_status,'changed',false);
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'proposal_decision_conflict' using errcode='40001';
  end if;

  update public.ct_proposals set
    status=v_status, decision_actor_type='client', decision_actor_id=p_actor_auth_user_id,
    decided_at=p_now, updated_at=p_now, version=version+1
  where id=p_proposal_id;

  update public.ct_proposal_batches set status='partially_reviewed',updated_at=p_now,version=version+1
  where id=v_proposal.batch_id and status='ready_for_review';

  insert into public.ct_proposal_events (
    tenant_id,account_id,batch_id,proposal_id,event_type,actor_type,actor_id,idempotency_key,occurred_at
  ) values (
    v_tenant_id,p_account_id,v_proposal.batch_id,p_proposal_id,
    case when p_decision='accept' then 'accepted' else 'rejected' end,
    'client',p_actor_auth_user_id,p_idempotency_key,p_now
  ) on conflict (tenant_id,account_id,idempotency_key) do nothing;

  return jsonb_build_object('proposalId',p_proposal_id,'status',v_status,'changed',true);
end
$$;

create or replace function public.ct_decide_premium_proposals_bulk_v1(
  p_account_id uuid,
  p_proposal_ids uuid[],
  p_actor_auth_user_id uuid,
  p_decision text,
  p_idempotency_key text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_results jsonb := '[]'::jsonb;
begin
  if coalesce(array_length(p_proposal_ids,1),0) < 1 or array_length(p_proposal_ids,1) > 10 then
    raise exception 'bulk_size_invalid';
  end if;
  foreach v_id in array p_proposal_ids loop
    v_results := v_results || jsonb_build_array(public.ct_decide_premium_proposal_v1(
      p_account_id,v_id,p_actor_auth_user_id,p_decision,p_idempotency_key||':'||v_id::text,p_now
    ));
  end loop;
  return jsonb_build_object('results',v_results);
end
$$;

create or replace function public.ct_claim_expired_premium_batch_v1(
  p_worker_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.ct_proposal_batches%rowtype;
  v_claim_token uuid := gen_random_uuid();
  v_count integer;
begin
  perform public.ct_assert_service_role_v1();
  select * into v_batch from public.ct_proposal_batches
  where status in ('ready_for_review','partially_reviewed') and review_expires_at <= p_now
  order by review_expires_at,id
  for update skip locked limit 1;
  if not found then return jsonb_build_object('claimed',false); end if;

  update public.ct_proposal_batches set
    status='activating',claimed_at=p_now,claim_token=v_claim_token,updated_at=p_now,version=version+1
  where id=v_batch.id;

  update public.ct_proposals set
    status='auto_accepted',decision_actor_type='system_timeout',decided_at=p_now,updated_at=p_now,version=version+1
  where batch_id=v_batch.id and status='pending';
  get diagnostics v_count = row_count;

  insert into public.ct_proposal_events (
    tenant_id,account_id,batch_id,proposal_id,event_type,actor_type,idempotency_key,payload_safe,occurred_at
  )
  select tenant_id,account_id,batch_id,id,'auto_accepted','system_timeout',
         'timeout:'||v_batch.id::text||':'||id::text,jsonb_build_object('worker',p_worker_id),p_now
  from public.ct_proposals where batch_id=v_batch.id and status='auto_accepted' and decided_at=p_now
  on conflict (tenant_id,account_id,idempotency_key) do nothing;

  return jsonb_build_object('claimed',true,'batchId',v_batch.id,'claimToken',v_claim_token,'autoAcceptedCount',v_count);
end
$$;

create or replace function public.ct_activate_premium_proposal_v1(
  p_account_id uuid,
  p_proposal_id uuid,
  p_actor_auth_user_id uuid,
  p_idempotency_key text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_proposal public.ct_proposals%rowtype;
  v_target_id uuid;
begin
  select r.tenant_id into v_tenant_id
  from public.ct_resolve_owned_premium_account_v1(p_account_id,p_actor_auth_user_id) r;

  select * into v_proposal from public.ct_proposals
  where id=p_proposal_id and tenant_id=v_tenant_id and account_id=p_account_id
  for update;
  if not found then raise exception 'proposal_not_found' using errcode='P0002'; end if;
  if v_proposal.status='activated' and v_proposal.activation_idempotency_key=p_idempotency_key then
    return jsonb_build_object('proposalId',p_proposal_id,'targetId',v_proposal.activated_target_id,'activated',false);
  end if;
  if v_proposal.status not in ('accepted','auto_accepted','activation_pending') then
    raise exception 'proposal_not_activatable' using errcode='23514';
  end if;
  if v_proposal.eligibility_status <> 'eligible' then raise exception 'proposal_not_eligible'; end if;
  if exists (
    select 1 from public.account_protection_list_entries e
    where e.account_id=p_account_id and e.list_kind='interaction_blacklist' and e.active
      and e.normalized_username=v_proposal.normalized_username
  ) then raise exception 'candidate_blacklisted' using errcode='23514'; end if;
  if exists (
    select 1 from public.ig_targets t where t.account_id=p_account_id
      and t.normalized_username=v_proposal.normalized_username
      and t.archived_at is null and t.deleted_at is null
  ) then raise exception 'active_target_duplicate' using errcode='23505'; end if;

  update public.ct_proposals set status='activation_pending',activation_idempotency_key=p_idempotency_key,updated_at=p_now,version=version+1
  where id=p_proposal_id;

  insert into public.ig_targets (
    account_id,target_username,status,source,input_username,normalized_username,canonical_username,
    verification_status,quality_status,batch_id,actor_type,metadata_safe,created_at,updated_at
  ) values (
    p_account_id,v_proposal.display_username,'pending_verification','ct_premium_proposal',
    v_proposal.display_username,v_proposal.normalized_username,v_proposal.normalized_username,
    'pending','unknown',v_proposal.batch_id,'system',
    jsonb_build_object('proposal_id',p_proposal_id,'replacement_first',v_proposal.replacement_of_target_id is not null),p_now,p_now
  ) returning id into v_target_id;

  update public.ct_proposals set status='activated',activated_target_id=v_target_id,updated_at=p_now,version=version+1
  where id=p_proposal_id;

  if v_proposal.replacement_of_target_id is not null then
    insert into public.ct_target_replacement_links (
      tenant_id,account_id,proposal_id,replaced_target_id,replacement_target_id,state,ready_at
    ) values (
      v_tenant_id,p_account_id,p_proposal_id,v_proposal.replacement_of_target_id,v_target_id,'ready',p_now
    ) on conflict (proposal_id) do update
      set replacement_target_id=excluded.replacement_target_id,state='ready',ready_at=excluded.ready_at,updated_at=now();
  end if;

  insert into public.ct_proposal_events (
    tenant_id,account_id,batch_id,proposal_id,event_type,actor_type,actor_id,idempotency_key,payload_safe,occurred_at
  ) values (
    v_tenant_id,p_account_id,v_proposal.batch_id,p_proposal_id,'activated','service',p_actor_auth_user_id,
    p_idempotency_key,jsonb_build_object('targetId',v_target_id,'oldTargetArchived',false),p_now
  );

  return jsonb_build_object('proposalId',p_proposal_id,'targetId',v_target_id,'activated',true,'oldTargetArchived',false);
end
$$;

create or replace function public.ct_finalize_premium_batch_v1(
  p_batch_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_batch public.ct_proposal_batches%rowtype;
begin
  perform public.ct_assert_service_role_v1();
  select * into v_batch from public.ct_proposal_batches where id=p_batch_id for update;
  if not found then raise exception 'batch_not_found'; end if;
  if exists (select 1 from public.ct_proposals where batch_id=p_batch_id and status in ('pending','accepted','auto_accepted','activation_pending')) then
    raise exception 'batch_has_unfinished_proposals';
  end if;
  update public.ct_proposal_batches set status='completed',completed_at=p_now,claim_token=null,claimed_at=null,updated_at=p_now,version=version+1
  where id=p_batch_id and status<>'completed';
  return jsonb_build_object('batchId',p_batch_id,'status','completed');
end
$$;

create or replace function public.ct_freeze_or_cancel_premium_batch_v1(
  p_batch_id uuid,
  p_reason text,
  p_cancel boolean default false,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_batch public.ct_proposal_batches%rowtype; v_status text;
begin
  perform public.ct_assert_service_role_v1();
  select * into v_batch from public.ct_proposal_batches where id=p_batch_id for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status='completed' then raise exception 'completed_batch_immutable'; end if;
  v_status := case when p_cancel then 'canceled' else 'frozen' end;
  update public.ct_proposal_batches set status=v_status,frozen_reason=p_reason,claim_token=null,claimed_at=null,updated_at=p_now,version=version+1 where id=p_batch_id;
  update public.ct_proposals set status='invalidated',decision_actor_type='commercial_transition',decided_at=p_now,updated_at=p_now,version=version+1
  where batch_id=p_batch_id and status='pending';
  insert into public.ct_proposal_events (
    tenant_id,account_id,batch_id,event_type,actor_type,idempotency_key,payload_safe,occurred_at
  ) values (
    v_batch.tenant_id,v_batch.account_id,p_batch_id,
    case when p_cancel then 'batch_canceled' else 'batch_frozen' end,
    'commercial_transition','commercial:'||p_batch_id::text||':'||v_status,
    jsonb_build_object('reason',p_reason),p_now
  ) on conflict (tenant_id,account_id,idempotency_key) do nothing;
  return jsonb_build_object('batchId',p_batch_id,'status',v_status);
end
$$;

create or replace function public.ct_archive_target_v1_disabled(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ct_assert_service_role_v1();
  raise exception 'ct_automatic_archival_disabled';
end
$$;

do $$
declare v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.ct_assert_service_role_v1()'::regprocedure,
    'public.ct_resolve_owned_premium_account_v1(uuid,uuid)'::regprocedure,
    'public.ct_record_target_evaluation_event_v1(uuid,uuid,text,timestamptz,text,uuid,text,text,text,text,jsonb)'::regprocedure,
    'public.ct_recompute_target_lifecycle_v1(uuid,uuid,integer,text,text,text,text,timestamptz)'::regprocedure,
    'public.ct_create_premium_proposal_batch_v1(uuid,uuid,text,text,jsonb,jsonb,timestamptz)'::regprocedure,
    'public.ct_decide_premium_proposal_v1(uuid,uuid,uuid,text,text,timestamptz)'::regprocedure,
    'public.ct_decide_premium_proposals_bulk_v1(uuid,uuid[],uuid,text,text,timestamptz)'::regprocedure,
    'public.ct_claim_expired_premium_batch_v1(text,timestamptz)'::regprocedure,
    'public.ct_activate_premium_proposal_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure,
    'public.ct_finalize_premium_batch_v1(uuid,timestamptz)'::regprocedure,
    'public.ct_freeze_or_cancel_premium_batch_v1(uuid,text,boolean,timestamptz)'::regprocedure,
    'public.ct_archive_target_v1_disabled(uuid)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end
$$;
