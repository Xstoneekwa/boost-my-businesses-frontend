-- Target Lifecycle archive transition convergence, phase A (additive).
-- Current guard-off release: postgres owns the private kernel. Dedicated-owner
-- hardening and the direct-write guard are deferred to a separately approved phase.

create schema if not exists archive_internal;
revoke all on schema archive_internal from public, anon, authenticated, service_role;

alter table public.ct_target_lifecycle_assessments
  add column if not exists assessment_kind text not null default 'evaluation',
  add column if not exists previous_status text,
  add column if not exists transition_source text,
  add column if not exists actor_type text,
  add column if not exists actor_id uuid,
  add column if not exists evidence_reference text,
  add column if not exists archive_intent_id uuid,
  add column if not exists contract_version text;

alter table public.ct_target_lifecycle_assessments
  alter column unique_profiles_evaluated drop not null,
  alter column denominator_source drop not null,
  alter column denominator_version drop not null;

alter table public.ct_target_lifecycle_assessments
  drop constraint if exists ct_target_lifecycle_assessments_counts_check;

do $$
declare
  v_name text;
  v_oid oid;
  v_marker text;
  v_created boolean;
begin
  foreach v_name in array array[
    'ct_target_lifecycle_assessments_kind_check',
    'ct_target_lifecycle_assessments_typed_payload_check',
    'ct_target_lifecycle_assessments_audience_check'
  ] loop
    select c.oid into v_oid
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.ct_target_lifecycle_assessments'::regclass
      and c.conname = v_name;
    v_created := v_oid is null;
    if v_created then
      if v_name = 'ct_target_lifecycle_assessments_kind_check' then
        alter table public.ct_target_lifecycle_assessments
          add constraint ct_target_lifecycle_assessments_kind_check
          check (assessment_kind in ('evaluation','terminal_archive'));
      elsif v_name = 'ct_target_lifecycle_assessments_typed_payload_check' then
        alter table public.ct_target_lifecycle_assessments
          add constraint ct_target_lifecycle_assessments_typed_payload_check
          check (
      (assessment_kind = 'evaluation'
        and unique_profiles_evaluated is not null
        and unique_profiles_evaluated >= 0
        and denominator_source is not null
        and denominator_version is not null
        and previous_status is null
        and transition_source is null
        and actor_type is null
        and actor_id is null
        and evidence_reference is null
        and archive_intent_id is null
        and contract_version is null)
      or
      (assessment_kind = 'terminal_archive'
        and status = 'archived'
        and unique_profiles_evaluated is null
        and denominator_source is null
        and denominator_version is null
        and utilization_ratio is null
        and estimated_exploitable_audience is null
        and previous_status is not null
        and transition_source is not null
        and actor_type in ('admin','client','system')
        and archive_intent_id is not null
        and contract_version = 'archive_transition_v1')
          );
      else
        alter table public.ct_target_lifecycle_assessments
          add constraint ct_target_lifecycle_assessments_audience_check
          check (estimated_exploitable_audience is null or estimated_exploitable_audience > 0);
      end if;
      select c.oid into v_oid
      from pg_catalog.pg_constraint c
      where c.conrelid = 'public.ct_target_lifecycle_assessments'::regclass
        and c.conname = v_name;
      execute format(
        'comment on constraint %I on public.ct_target_lifecycle_assessments is %L',
        v_name,
        'archive_transition_phase_a_v1:' || md5(pg_catalog.pg_get_constraintdef(v_oid, true))
      );
    else
      v_marker := pg_catalog.obj_description(v_oid, 'pg_constraint');
      if v_marker is distinct from
         'archive_transition_phase_a_v1:' || md5(pg_catalog.pg_get_constraintdef(v_oid, true)) then
        raise exception 'archive_transition_constraint_semantic_drift:%', v_name
          using errcode = '55000';
      end if;
    end if;
  end loop;
end
$$;

do $$
declare
  v_index regclass := to_regclass('public.ct_target_lifecycle_terminal_intent_target_uq');
  v_marker text;
begin
  if v_index is null then
    create unique index ct_target_lifecycle_terminal_intent_target_uq
      on public.ct_target_lifecycle_assessments (tenant_id, account_id, archive_intent_id, target_id)
      where assessment_kind = 'terminal_archive';
    v_index := to_regclass('public.ct_target_lifecycle_terminal_intent_target_uq');
    execute format(
      'comment on index public.ct_target_lifecycle_terminal_intent_target_uq is %L',
      'archive_transition_phase_a_v1:' || md5(pg_catalog.pg_get_indexdef(v_index))
    );
  else
    v_marker := pg_catalog.obj_description(v_index, 'pg_class');
    if v_marker is distinct from
       'archive_transition_phase_a_v1:' || md5(pg_catalog.pg_get_indexdef(v_index)) then
      raise exception 'archive_transition_index_semantic_drift:ct_target_lifecycle_terminal_intent_target_uq'
        using errcode = '55000';
    end if;
  end if;
end
$$;

create table if not exists archive_internal.archive_transition_requests (
  archive_intent_id uuid primary key,
  tenant_id uuid not null,
  account_id uuid not null,
  target_ids uuid[] not null,
  canonical_fingerprint text not null check (canonical_fingerprint ~ '^[a-f0-9]{64}$'),
  transition_source text not null,
  archive_reason text not null,
  actor_type text not null check (actor_type in ('admin','client','system')),
  actor_id uuid,
  evidence_reference text,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint archive_transition_requests_scope_fkey
    foreign key (tenant_id, account_id)
    references public.client_instagram_accounts(client_id, account_id) on delete restrict,
  constraint archive_transition_requests_result_check
    check (result is null or jsonb_typeof(result) = 'object')
);

revoke all on table archive_internal.archive_transition_requests from public, anon, authenticated, service_role;

create or replace function archive_internal.archive_target_transition_kernel_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := nullif(p_request->>'tenant_id','')::uuid;
  v_account uuid := nullif(p_request->>'account_id','')::uuid;
  v_intent uuid := nullif(p_request->>'archive_intent_id','')::uuid;
  v_source text := btrim(coalesce(p_request->>'source',''));
  v_reason text := btrim(coalesce(p_request->>'reason',''));
  v_actor_type text := btrim(coalesce(p_request->>'actor_type',''));
  v_actor_id uuid := nullif(p_request->>'actor_id','')::uuid;
  v_evidence text := nullif(btrim(coalesce(p_request->>'evidence_reference','')),'');
  v_targets uuid[];
  v_fingerprint text;
  v_existing archive_internal.archive_transition_requests%rowtype;
  v_target public.ig_targets%rowtype;
  v_previous_status text;
  v_assessment uuid;
  v_now timestamptz := clock_timestamp();
  v_items jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if current_user <> 'postgres' then
    raise exception 'archive_transition_kernel_owner_invalid' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_request,'{}'::jsonb)) <> 'object'
     or v_tenant is null or v_account is null or v_intent is null
     or coalesce(p_request->>'contract','') <> 'archive_transition_v1'
     or v_source not in ('admin_dashboard','client_dashboard','private_streak','verification_not_found','verification_ineligible','low_fbr','onboarding_rollback')
     or v_actor_type not in ('admin','client','system')
     or char_length(v_reason) not between 1 and 120
     or jsonb_typeof(p_request->'target_ids') <> 'array' then
    raise exception 'archive_transition_request_invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_request->'target_patch','{}'::jsonb)) <> 'object'
     or exists (
       select 1 from jsonb_object_keys(coalesce(p_request->'target_patch','{}'::jsonb)) k
       where k not in ('verification_status','verification_reason','quality_status','canonical_username',
         'avatar_url','followers_count','is_verified','is_private','provider_checked_at','rejected_reason','metadata_safe')
     )
     or (coalesce(p_request->'target_patch','{}'::jsonb) <> '{}'::jsonb
       and v_source not in ('verification_not_found','verification_ineligible')) then
    raise exception 'archive_transition_target_patch_invalid' using errcode = '22023';
  end if;

  select array_agg(x order by x) into v_targets
  from (select distinct jsonb_array_elements_text(p_request->'target_ids')::uuid x) q;
  if coalesce(cardinality(v_targets),0) < 1 or cardinality(v_targets) > 500 then
    raise exception 'archive_transition_target_set_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.client_instagram_accounts c
    where c.client_id = v_tenant and c.account_id = v_account
      and (v_source = 'onboarding_rollback' or c.active)
  ) then
    raise exception 'archive_transition_scope_rejected' using errcode = '42501';
  end if;

  v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'contract','archive_transition_v1','tenant_id',v_tenant,'account_id',v_account,
    'archive_intent_id',v_intent,'target_ids',v_targets,'reason',v_reason,
    'source',v_source,'actor_type',v_actor_type,'actor_id',v_actor_id,
    'evidence_reference',v_evidence,'target_patch',coalesce(p_request->'target_patch','{}'::jsonb)
  )::text,'utf8'),'sha256'),'hex');

  insert into archive_internal.archive_transition_requests(
    archive_intent_id,tenant_id,account_id,target_ids,canonical_fingerprint,
    transition_source,archive_reason,actor_type,actor_id,evidence_reference
  ) values (v_intent,v_tenant,v_account,v_targets,v_fingerprint,v_source,v_reason,v_actor_type,v_actor_id,v_evidence)
  on conflict (archive_intent_id) do nothing;

  select * into v_existing from archive_internal.archive_transition_requests
  where archive_intent_id = v_intent for update;
  if v_existing.canonical_fingerprint is distinct from v_fingerprint then
    raise exception 'archive_transition_replay_conflict' using errcode = '23505';
  end if;
  if v_existing.result is not null then return v_existing.result || jsonb_build_object('replayed',true); end if;

  if (select count(*) from (select t.id from public.ig_targets t
      where t.account_id=v_account and t.id=any(v_targets) order by t.id for update) locked) <> cardinality(v_targets) then
    raise exception 'archive_transition_target_scope_rejected' using errcode = '42501';
  end if;

  foreach v_assessment in array v_targets loop
    select * into strict v_target from public.ig_targets t where t.account_id=v_account and t.id=v_assessment;
    if v_target.deleted_at is not null or lower(coalesce(v_target.status,'')) = 'deleted' then
      raise exception 'archive_transition_deleted_target' using errcode = '23514';
    end if;

    if v_target.archived_at is not null or lower(coalesce(v_target.status,'')) = 'archived' then
      select c.assessment_id into v_assessment from public.ct_target_lifecycle_current c
      join public.ct_target_lifecycle_assessments a on a.id=c.assessment_id
      where c.tenant_id=v_tenant and c.account_id=v_account and c.target_id=v_target.id
        and a.assessment_kind='terminal_archive';
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'target_id',v_target.id,'outcome','already_archived','winning_assessment_id',v_assessment,
        'archived_at',v_target.archived_at));
      continue;
    end if;

    if v_source = 'verification_not_found' and not exists (
      select 1 from public.ct_target_availability_current a
      where a.tenant_id=v_tenant and a.account_id=v_account and a.target_id=v_target.id
        and a.availability_status='unavailable_confirmed' and a.confidence='high'
        and a.confirmed_at is not null and a.valid_until >= v_now
        and coalesce(a.identity_status,'') not in ('identity_conflict','identity_ambiguous')
    ) then
      raise exception 'archive_transition_not_found_proof_stale' using errcode = '23514';
    end if;

    select coalesce(c.status,a.status,'none') into v_previous_status
    from public.ct_target_lifecycle_current c
    join public.ct_target_lifecycle_assessments a on a.id=c.assessment_id
    where c.tenant_id=v_tenant and c.account_id=v_account and c.target_id=v_target.id;
    v_previous_status := coalesce(v_previous_status,'none');

    update public.ig_targets set
      status='archived', archived_at=v_now, archive_reason=v_reason, updated_at=v_now,
      periodic_revalidation_next_due_at=null, periodic_revalidation_window_key=null,
      auto_archived_at=case when v_source in ('verification_not_found','verification_ineligible','low_fbr') then v_now else auto_archived_at end,
      last_error=case when v_source='private_streak' then 'consecutive_private_opened_profiles' else last_error end,
      readd_blocked_until=case when v_source='low_fbr' then null else readd_blocked_until end,
      readd_blocked_permanently=case when v_source='low_fbr' then true else readd_blocked_permanently end,
      readd_block_reason=case when v_source='low_fbr' then v_reason else readd_block_reason end,
      readd_blocked_at=case when v_source='low_fbr' then v_now else readd_blocked_at end,
      verification_status=case when p_request->'target_patch' ? 'verification_status' then p_request->'target_patch'->>'verification_status' else verification_status end,
      verification_reason=case when p_request->'target_patch' ? 'verification_reason' then p_request->'target_patch'->>'verification_reason' else verification_reason end,
      quality_status=case when p_request->'target_patch' ? 'quality_status' then p_request->'target_patch'->>'quality_status' else quality_status end,
      canonical_username=case when p_request->'target_patch' ? 'canonical_username' then nullif(p_request->'target_patch'->>'canonical_username','') else canonical_username end,
      avatar_url=case when p_request->'target_patch' ? 'avatar_url' then nullif(p_request->'target_patch'->>'avatar_url','') else avatar_url end,
      followers_count=case when p_request->'target_patch' ? 'followers_count' then nullif(p_request->'target_patch'->>'followers_count','')::integer else followers_count end,
      is_verified=case when p_request->'target_patch' ? 'is_verified' then (p_request->'target_patch'->>'is_verified')::boolean else is_verified end,
      is_private=case when p_request->'target_patch' ? 'is_private' then (p_request->'target_patch'->>'is_private')::boolean else is_private end,
      provider_checked_at=case when p_request->'target_patch' ? 'provider_checked_at' then nullif(p_request->'target_patch'->>'provider_checked_at','')::timestamptz else provider_checked_at end,
      rejected_reason=case when p_request->'target_patch' ? 'rejected_reason' then nullif(p_request->'target_patch'->>'rejected_reason','') else rejected_reason end,
      metadata_safe=case when p_request->'target_patch' ? 'metadata_safe' then p_request->'target_patch'->'metadata_safe' else metadata_safe end
    where id=v_target.id and account_id=v_account;

    insert into public.ct_target_lifecycle_assessments(
      tenant_id,account_id,target_id,assessment_key,status,utilization_ratio,
      unique_profiles_evaluated,estimated_exploitable_audience,denominator_source,denominator_version,
      confidence,reason_codes,replacement_state,assessed_at,archived_at,archive_reason,
      explanation_safe,enforcement_allowed,business_action_allowed,mutation_executed,
      assessment_kind,previous_status,transition_source,actor_type,actor_id,
      evidence_reference,archive_intent_id,contract_version
    ) values (
      v_tenant,v_account,v_target.id,'archive:'||v_intent::text||':'||v_target.id::text,'archived',null,
      null,null,null,null,'unknown',array[v_reason],'none',v_now,v_now,v_reason,
      jsonb_build_object('schema','archive_transition_v1','occurred_at',v_now,'recorded_at',clock_timestamp()),
      false,false,false,'terminal_archive',v_previous_status,v_source,v_actor_type,v_actor_id,
      v_evidence,v_intent,'archive_transition_v1'
    ) returning id into v_assessment;

    insert into public.ct_target_lifecycle_current(tenant_id,account_id,target_id,assessment_id,status,updated_at)
    values(v_tenant,v_account,v_target.id,v_assessment,'archived',v_now)
    on conflict(tenant_id,account_id,target_id) do update set
      assessment_id=excluded.assessment_id,status='archived',updated_at=excluded.updated_at;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'target_id',v_target.id,'outcome','archived','assessment_id',v_assessment,'archived_at',v_now));
  end loop;

  v_result := jsonb_build_object('contract','archive_transition_v1','archive_intent_id',v_intent,
    'account_id',v_account,'target_ids',v_targets,'items',v_items,'archived',
    (select count(*) from jsonb_array_elements(v_items) i where i->>'outcome'='archived'),'replayed',false);
  update archive_internal.archive_transition_requests set result=v_result,completed_at=clock_timestamp()
  where archive_intent_id=v_intent;
  return v_result;
end
$$;

alter function archive_internal.archive_target_transition_kernel_v1(jsonb) owner to postgres;
revoke all on function archive_internal.archive_target_transition_kernel_v1(jsonb) from public, anon, authenticated, service_role;

create or replace function public.archive_targets_transition_batch_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.ct_assert_service_role_v1();
  if exists(select 1 from jsonb_object_keys(coalesce(p_request,'{}'::jsonb)) k
    where k not in ('contract','tenant_id','account_id','archive_intent_id','target_ids','reason','source','actor_type','actor_id','evidence_reference','target_patch')) then
    raise exception 'archive_transition_unknown_field' using errcode='22023';
  end if;
  return archive_internal.archive_target_transition_kernel_v1(p_request);
end $$;

create or replace function public.archive_target_transition_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_request ? 'target_ids' or not (p_request ? 'target_id') then
    raise exception 'archive_transition_unit_target_invalid' using errcode='22023';
  end if;
  return public.archive_targets_transition_batch_v1((p_request-'target_id') ||
    jsonb_build_object('target_ids',jsonb_build_array(p_request->'target_id')));
end $$;

revoke all on function public.archive_targets_transition_batch_v1(jsonb) from public, anon, authenticated;
revoke all on function public.archive_target_transition_v1(jsonb) from public, anon, authenticated;
grant execute on function public.archive_targets_transition_batch_v1(jsonb) to service_role;
grant execute on function public.archive_target_transition_v1(jsonb) to service_role;

-- One-shot, fail-closed reconciliation for the three archives identified by the
-- design forensic. This records their historical terminal transition without
-- changing ig_targets or Availability. It is intentionally not a general
-- backfill primitive: both the target allowlist and the expected live state are
-- enforced inside the transaction.
create or replace function public.reconcile_archived_target_lifecycle_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := nullif(p_request->>'tenant_id','')::uuid;
  v_account uuid := nullif(p_request->>'account_id','')::uuid;
  v_target_id uuid := nullif(p_request->>'target_id','')::uuid;
  v_intent uuid := nullif(p_request->>'archive_intent_id','')::uuid;
  v_evidence text := nullif(btrim(coalesce(p_request->>'evidence_reference','')),'');
  v_fingerprint text;
  v_existing archive_internal.archive_transition_requests%rowtype;
  v_target public.ig_targets%rowtype;
  v_current public.ct_target_lifecycle_current%rowtype;
  v_assessment uuid;
  v_result jsonb;
begin
  perform public.ct_assert_service_role_v1();
  if jsonb_typeof(coalesce(p_request,'{}'::jsonb)) <> 'object'
     or exists(select 1 from jsonb_object_keys(coalesce(p_request,'{}'::jsonb)) k
       where k not in ('contract','tenant_id','account_id','target_id','archive_intent_id','evidence_reference'))
     or coalesce(p_request->>'contract','') <> 'archive_transition_reconciliation_v1'
     or v_tenant is null or v_account is null or v_target_id is null or v_intent is null
     or v_target_id not in (
       '542b758f-004e-4e88-a381-dd441b60ad5e'::uuid,
       '1ec040d0-6420-4d50-bd5d-7cc3834c13d3'::uuid,
       'd108e3aa-4765-45ff-be4b-5152ca5f00a8'::uuid
     ) then
    raise exception 'archive_reconciliation_request_rejected' using errcode='22023';
  end if;

  if not exists(select 1 from public.client_instagram_accounts c
    where c.client_id=v_tenant and c.account_id=v_account) then
    raise exception 'archive_reconciliation_scope_rejected' using errcode='42501';
  end if;

  select * into strict v_target from public.ig_targets t
  where t.id=v_target_id and t.account_id=v_account for update;
  if lower(coalesce(v_target.status,'')) <> 'archived'
     or v_target.archived_at is null
     or v_target.archive_reason is distinct from 'dashboard_archive'
     or v_target.deleted_at is not null then
    raise exception 'archive_reconciliation_target_drift' using errcode='23514';
  end if;

  select * into v_current from public.ct_target_lifecycle_current c
  where c.tenant_id=v_tenant and c.account_id=v_account and c.target_id=v_target_id for update;
  if found and v_current.status = 'archived' then
    select a.id into v_assessment from public.ct_target_lifecycle_assessments a
    where a.id=v_current.assessment_id and a.assessment_kind='terminal_archive';
    if v_assessment is null then
      raise exception 'archive_reconciliation_current_drift' using errcode='23514';
    end if;
  elsif not found or v_current.status is distinct from 'insufficient_data' then
    raise exception 'archive_reconciliation_current_drift' using errcode='23514';
  end if;

  v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'contract','archive_transition_reconciliation_v1','tenant_id',v_tenant,'account_id',v_account,
    'target_id',v_target_id,'archive_intent_id',v_intent,'evidence_reference',v_evidence
  )::text,'utf8'),'sha256'),'hex');
  insert into archive_internal.archive_transition_requests(
    archive_intent_id,tenant_id,account_id,target_ids,canonical_fingerprint,
    transition_source,archive_reason,actor_type,actor_id,evidence_reference
  ) values (v_intent,v_tenant,v_account,array[v_target_id],v_fingerprint,
    'reconciliation','dashboard_archive','system',null,v_evidence)
  on conflict (archive_intent_id) do nothing;
  select * into v_existing from archive_internal.archive_transition_requests
  where archive_intent_id=v_intent for update;
  if v_existing.canonical_fingerprint is distinct from v_fingerprint then
    raise exception 'archive_transition_replay_conflict' using errcode='23505';
  end if;
  if v_existing.result is not null then
    return v_existing.result || jsonb_build_object('replayed',true);
  end if;

  if v_assessment is null then
    insert into public.ct_target_lifecycle_assessments(
      tenant_id,account_id,target_id,assessment_key,status,utilization_ratio,
      unique_profiles_evaluated,estimated_exploitable_audience,denominator_source,denominator_version,
      confidence,reason_codes,replacement_state,assessed_at,archived_at,archive_reason,
      explanation_safe,enforcement_allowed,business_action_allowed,mutation_executed,
      assessment_kind,previous_status,transition_source,actor_type,actor_id,
      evidence_reference,archive_intent_id,contract_version
    ) values (
      v_tenant,v_account,v_target_id,'archive-reconciliation:'||v_intent::text,'archived',null,
      null,null,null,null,'unknown',array['dashboard_archive'],'none',v_target.archived_at,
      v_target.archived_at,'dashboard_archive',jsonb_build_object(
        'schema','archive_transition_v1','mutation_kind','BACKFILL_RECONCILIATION',
        'occurred_at',v_target.archived_at,'recorded_at',clock_timestamp()),
      false,false,false,'terminal_archive','insufficient_data','reconciliation','system',null,
      v_evidence,v_intent,'archive_transition_v1'
    ) returning id into v_assessment;

    update public.ct_target_lifecycle_current set
      assessment_id=v_assessment,status='archived',updated_at=clock_timestamp()
    where tenant_id=v_tenant and account_id=v_account and target_id=v_target_id;
  end if;

  v_result := jsonb_build_object(
    'contract','archive_transition_reconciliation_v1','archive_intent_id',v_intent,
    'target_id',v_target_id,'assessment_id',v_assessment,
    'outcome','reconciled','mutation_kind','BACKFILL_RECONCILIATION','replayed',false);
  update archive_internal.archive_transition_requests
  set result=v_result,completed_at=clock_timestamp() where archive_intent_id=v_intent;
  return v_result;
exception when no_data_found then
  raise exception 'archive_reconciliation_target_scope_rejected' using errcode='42501';
end
$$;

revoke all on function public.reconcile_archived_target_lifecycle_v1(jsonb) from public, anon, authenticated;
grant execute on function public.reconcile_archived_target_lifecycle_v1(jsonb) to service_role;

-- Wrap both projectors so target state is serialized before Lifecycle Current.
do $$
declare
  v_unlocked regprocedure := to_regprocedure('public.persist_target_lifecycle_shadow_unlocked_v1(jsonb,text)');
  v_marker text;
begin
  if v_unlocked is null then
    if to_regprocedure('public.persist_target_lifecycle_shadow_v1(jsonb,text)') is null then
      raise exception 'persist_target_lifecycle_shadow_v1_missing' using errcode='42883';
    end if;
    alter function public.persist_target_lifecycle_shadow_v1(jsonb,text)
      rename to persist_target_lifecycle_shadow_unlocked_v1;
    v_unlocked := to_regprocedure('public.persist_target_lifecycle_shadow_unlocked_v1(jsonb,text)');
    execute format(
      'comment on function public.persist_target_lifecycle_shadow_unlocked_v1(jsonb,text) is %L',
      'archive_transition_unlocked_v1:' || md5(pg_catalog.pg_get_functiondef(v_unlocked))
    );
  else
    v_marker := pg_catalog.obj_description(v_unlocked, 'pg_proc');
    if v_marker is distinct from
       'archive_transition_unlocked_v1:' || md5(pg_catalog.pg_get_functiondef(v_unlocked)) then
      raise exception 'persist_target_lifecycle_shadow_unlocked_v1_semantic_drift' using errcode='55000';
    end if;
  end if;
end
$$;
revoke all on function public.persist_target_lifecycle_shadow_unlocked_v1(jsonb,text) from public, anon, authenticated, service_role;

create or replace function public.persist_target_lifecycle_shadow_v1(p_bundle jsonb,p_processor_release text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_target public.ig_targets%rowtype;
begin
  select * into v_target from public.ig_targets
  where id=nullif(p_bundle->>'target_id','')::uuid and account_id=nullif(p_bundle->>'account_id','')::uuid for update;
  if not found then return jsonb_build_object('outcome','cross_tenant_rejected','business_actions',0); end if;
  if v_target.archived_at is not null or lower(coalesce(v_target.status,''))='archived' then
    return jsonb_build_object('outcome','out_of_order_skipped','reason','target_archived','business_actions',0);
  end if;
  return public.persist_target_lifecycle_shadow_unlocked_v1(p_bundle,p_processor_release);
end $$;
revoke all on function public.persist_target_lifecycle_shadow_v1(jsonb,text) from public,anon,authenticated;
grant execute on function public.persist_target_lifecycle_shadow_v1(jsonb,text) to service_role;

do $$
declare
  v_unlocked regprocedure := to_regprocedure('public.ct_recompute_target_lifecycle_unlocked_v1(uuid,uuid,integer,text,text,text,text,timestamptz)');
  v_marker text;
begin
  if v_unlocked is null then
    if to_regprocedure('public.ct_recompute_target_lifecycle_v1(uuid,uuid,integer,text,text,text,text,timestamptz)') is null then
      raise exception 'ct_recompute_target_lifecycle_v1_missing' using errcode='42883';
    end if;
    alter function public.ct_recompute_target_lifecycle_v1(uuid,uuid,integer,text,text,text,text,timestamptz)
      rename to ct_recompute_target_lifecycle_unlocked_v1;
    v_unlocked := to_regprocedure('public.ct_recompute_target_lifecycle_unlocked_v1(uuid,uuid,integer,text,text,text,text,timestamptz)');
    execute format(
      'comment on function public.ct_recompute_target_lifecycle_unlocked_v1(uuid,uuid,integer,text,text,text,text,timestamptz) is %L',
      'archive_transition_unlocked_v1:' || md5(pg_catalog.pg_get_functiondef(v_unlocked))
    );
  else
    v_marker := pg_catalog.obj_description(v_unlocked, 'pg_proc');
    if v_marker is distinct from
       'archive_transition_unlocked_v1:' || md5(pg_catalog.pg_get_functiondef(v_unlocked)) then
      raise exception 'ct_recompute_target_lifecycle_unlocked_v1_semantic_drift' using errcode='55000';
    end if;
  end if;
end
$$;
revoke all on function public.ct_recompute_target_lifecycle_unlocked_v1(uuid,uuid,integer,text,text,text,text,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.ct_recompute_target_lifecycle_v1(
  p_account_id uuid,p_target_id uuid,p_estimated_exploitable_audience integer,p_denominator_source text,
  p_denominator_version text,p_confidence text,p_assessment_key text,p_assessed_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_target public.ig_targets%rowtype; v_result jsonb;
begin
  select * into v_target from public.ig_targets where id=p_target_id and account_id=p_account_id for update;
  if not found then raise exception 'target_account_mismatch' using errcode='23514'; end if;
  if v_target.archived_at is not null or lower(coalesce(v_target.status,''))='archived' then
    select jsonb_build_object('assessmentId',a.id,'status','archived','uniqueProfilesEvaluated',null,
      'utilizationRatio',null,'replacementState','none','outcome','target_archived') into v_result
    from public.ct_target_lifecycle_current c join public.ct_target_lifecycle_assessments a on a.id=c.assessment_id
    where c.account_id=p_account_id and c.target_id=p_target_id and a.assessment_kind='terminal_archive';
    return coalesce(v_result,jsonb_build_object('assessmentId',null,'status','archived','outcome','target_archived'));
  end if;
  return public.ct_recompute_target_lifecycle_unlocked_v1(p_account_id,p_target_id,p_estimated_exploitable_audience,
    p_denominator_source,p_denominator_version,p_confidence,p_assessment_key,p_assessed_at);
end $$;
revoke all on function public.ct_recompute_target_lifecycle_v1(uuid,uuid,integer,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.ct_recompute_target_lifecycle_v1(uuid,uuid,integer,text,text,text,text,timestamptz) to service_role;

-- Preserve the onboarding rollback transaction while routing its target terminalization
-- through the same DB-local kernel. The dry-run preflight is evaluated first; the
-- enclosing exception block rolls the kernel work back if the legacy transaction fails.
do $$
declare
  v_unlocked regprocedure := to_regprocedure('public.rollback_test_instagram_onboarding_unlocked_v1(uuid,uuid,uuid,text,uuid,text,text,text,text,boolean)');
  v_marker text;
begin
  if v_unlocked is null then
    if to_regprocedure('public.rollback_test_instagram_onboarding_v1(uuid,uuid,uuid,text,uuid,text,text,text,text,boolean)') is null then
      raise exception 'rollback_test_instagram_onboarding_v1_missing' using errcode='42883';
    end if;
    alter function public.rollback_test_instagram_onboarding_v1(
      uuid,uuid,uuid,text,uuid,text,text,text,text,boolean
    ) rename to rollback_test_instagram_onboarding_unlocked_v1;
    v_unlocked := to_regprocedure('public.rollback_test_instagram_onboarding_unlocked_v1(uuid,uuid,uuid,text,uuid,text,text,text,text,boolean)');
    execute format(
      'comment on function public.rollback_test_instagram_onboarding_unlocked_v1(uuid,uuid,uuid,text,uuid,text,text,text,text,boolean) is %L',
      'archive_transition_unlocked_v1:' || md5(pg_catalog.pg_get_functiondef(v_unlocked))
    );
  else
    v_marker := pg_catalog.obj_description(v_unlocked, 'pg_proc');
    if v_marker is distinct from
       'archive_transition_unlocked_v1:' || md5(pg_catalog.pg_get_functiondef(v_unlocked)) then
      raise exception 'rollback_test_instagram_onboarding_unlocked_v1_semantic_drift' using errcode='55000';
    end if;
  end if;
end
$$;
revoke all on function public.rollback_test_instagram_onboarding_unlocked_v1(
  uuid,uuid,uuid,text,uuid,text,text,text,text,boolean
) from public,anon,authenticated,service_role;

create or replace function public.rollback_test_instagram_onboarding_v1(
  p_account_id uuid,
  p_tenant_id uuid,
  p_entitlement_id uuid,
  p_expected_username text,
  p_expected_checkout_id uuid,
  p_expected_package text,
  p_reason text,
  p_request_id text,
  p_idempotency_key text,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preflight jsonb;
  v_result jsonb;
  v_target_ids uuid[];
  v_hash text;
  v_intent uuid;
begin
  v_preflight := public.rollback_test_instagram_onboarding_unlocked_v1(
    p_account_id,p_tenant_id,p_entitlement_id,p_expected_username,p_expected_checkout_id,
    p_expected_package,p_reason,p_request_id,p_idempotency_key,true
  );
  if p_dry_run or not coalesce((v_preflight->>'ok')::boolean,false) then
    return v_preflight;
  end if;

  begin
    perform pg_advisory_xact_lock(hashtextextended(
      'rollback_test_instagram_onboarding_v1:' || p_account_id::text, 0));
    perform pg_advisory_xact_lock(hashtextextended(
      'rollback_test_instagram_onboarding_v1:' ||
      encode(extensions.digest(convert_to(btrim(p_idempotency_key),'utf8'),'sha256'),'hex'), 0));

    select array_agg(t.id order by t.id) into v_target_ids
    from public.ig_targets t
    where t.account_id=p_account_id and t.archived_at is null and t.deleted_at is null;

    if coalesce(cardinality(v_target_ids),0) > 0 then
      v_hash := encode(extensions.digest(convert_to(
        concat_ws('|','onboarding_rollback_v1',p_tenant_id::text,p_account_id::text,
          p_request_id,btrim(p_idempotency_key)),'utf8'),'sha256'),'hex');
      v_intent := (
        substr(v_hash,1,8)||'-'||substr(v_hash,9,4)||'-5'||substr(v_hash,14,3)||'-'||
        substr('89ab',1+(get_byte(decode(substr(v_hash,17,2),'hex'),0) % 4),1)||
        substr(v_hash,18,3)||'-'||substr(v_hash,21,12)
      )::uuid;
      perform archive_internal.archive_target_transition_kernel_v1(jsonb_build_object(
        'contract','archive_transition_v1','tenant_id',p_tenant_id,'account_id',p_account_id,
        'archive_intent_id',v_intent,'target_ids',to_jsonb(v_target_ids),
        'reason','test_onboarding_rollback','source','onboarding_rollback','actor_type','system',
        'actor_id',auth.uid(),'evidence_reference','onboarding_rollback:'||p_request_id
      ));
    end if;

    v_result := public.rollback_test_instagram_onboarding_unlocked_v1(
      p_account_id,p_tenant_id,p_entitlement_id,p_expected_username,p_expected_checkout_id,
      p_expected_package,p_reason,p_request_id,p_idempotency_key,false
    );
    if not coalesce((v_result->>'ok')::boolean,false) then
      raise exception 'onboarding_rollback_legacy_transaction_failed';
    end if;
    return v_result;
  exception when others then
    return jsonb_build_object(
      'ok',false,'reason','transaction_failed','error_code',sqlstate,
      'error_safe',left(sqlerrm,160),'dry_run',false,'account_id',p_account_id
    );
  end;
end $$;
revoke all on function public.rollback_test_instagram_onboarding_v1(
  uuid,uuid,uuid,text,uuid,text,text,text,text,boolean
) from public,anon,authenticated;
grant execute on function public.rollback_test_instagram_onboarding_v1(
  uuid,uuid,uuid,text,uuid,text,text,text,text,boolean
) to service_role;

comment on schema archive_internal is 'Internal archive transition kernel and immutable request receipts; not exposed through PostgREST.';
