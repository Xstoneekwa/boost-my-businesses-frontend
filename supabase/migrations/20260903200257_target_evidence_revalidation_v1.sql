-- Target Lifecycle Gap Closure 2D: isolated upstream-evidence revalidation.
-- This migration does not enable a cron or any business decision authority.

create or replace function public.enqueue_ct_target_evidence_revalidation_job_v1(
  p_target_id uuid,
  p_account_id uuid,
  p_normalized_username text,
  p_window_key text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target public.ig_targets%rowtype;
  v_job public.ct_target_verification_jobs%rowtype;
  v_username text := lower(btrim(coalesce(p_normalized_username, '')));
  v_window_key text := left(btrim(coalesce(p_window_key, '')), 80);
begin
  perform public.ct_assert_service_role_v1();
  if p_target_id is null or p_account_id is null or v_username = '' or v_window_key = '' then
    raise exception 'invalid_evidence_revalidation_enqueue_input' using errcode = '22023';
  end if;

  select t.* into v_target
  from public.ig_targets t
  where t.id = p_target_id
    and t.account_id = p_account_id
    and lower(coalesce(t.normalized_username, '')) = v_username
    and lower(coalesce(t.status, '')) not in ('archived', 'deleted')
    and t.archived_at is null
    and t.deleted_at is null
  for update;

  if not found then return 'target_not_eligible'; end if;
  if v_target.periodic_revalidation_window_key is not null then
    return 'window_already_claimed';
  end if;

  select j.* into v_job
  from public.ct_target_verification_jobs j
  where j.target_id = p_target_id
  for update;

  if found and v_job.status in ('pending', 'processing', 'retry_scheduled') then
    return 'active_job_exists';
  end if;

  if found then
    update public.ct_target_verification_jobs j
    set account_id = p_account_id,
        batch_id = null,
        normalized_username = v_username,
        status = 'pending',
        attempt_count = 0,
        max_attempts = 3,
        next_attempt_at = null,
        locked_at = null,
        locked_by = null,
        last_error_code = null,
        last_error_message = null,
        provider_status = 'pending',
        metadata_safe = jsonb_build_object(
          'trigger_source', 'periodic_weekly',
          'periodic_window_key', v_window_key,
          'mode', 'evidence_only'
        ),
        updated_at = now()
    where j.id = v_job.id;
  else
    insert into public.ct_target_verification_jobs (
      target_id, account_id, batch_id, normalized_username, status,
      attempt_count, max_attempts, provider_status, metadata_safe
    ) values (
      p_target_id, p_account_id, null, v_username, 'pending',
      0, 3, 'pending', jsonb_build_object(
        'trigger_source', 'periodic_weekly',
        'periodic_window_key', v_window_key,
        'mode', 'evidence_only'
      )
    );
  end if;

  update public.ig_targets t
  set periodic_revalidation_window_key = v_window_key
  where t.id = p_target_id and t.account_id = p_account_id;
  return 'enqueued';
end;
$function$;

create or replace function public.claim_ct_target_evidence_revalidation_jobs_v1(
  p_batch_limit integer default 5,
  p_worker_id text default 'ct_evidence_revalidation_cron'
)
returns setof public.ct_target_verification_jobs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_batch_limit, 5), 1), 10);
  v_worker_id text := left(regexp_replace(
    coalesce(p_worker_id, 'ct_evidence_revalidation_cron'),
    '[^a-zA-Z0-9_.:-]', '_', 'g'
  ), 120);
begin
  perform public.ct_assert_service_role_v1();
  return query
  with next_jobs as (
    select j.id
    from public.ct_target_verification_jobs j
    join public.ig_targets t
      on t.id = j.target_id
     and t.account_id = j.account_id
     and lower(coalesce(t.normalized_username, '')) = lower(j.normalized_username)
    where (
        (
          coalesce(j.metadata_safe->>'trigger_source', '') = 'periodic_weekly'
          and coalesce(j.metadata_safe->>'mode', '') = 'evidence_only'
        )
        or (
          j.status = 'pending'
          and j.attempt_count = 0
          and j.locked_at is null
          and j.created_at < now() - interval '7 days'
          and coalesce(j.metadata_safe->>'mode', '') = ''
          and lower(coalesce(t.status, '')) = 'valid'
          and lower(coalesce(t.quality_status, '')) = 'eligible'
          and lower(coalesce(t.verification_status, '')) = 'found'
        )
      )
      and (
        j.status in ('pending', 'retry_scheduled')
        or (j.status = 'processing' and j.locked_at < now() - interval '15 minutes')
      )
      and coalesce(j.next_attempt_at, now()) <= now()
      and (j.locked_at is null or j.locked_at < now() - interval '15 minutes')
      and lower(coalesce(t.status, '')) not in ('archived', 'deleted')
      and t.archived_at is null
      and t.deleted_at is null
    order by coalesce(j.next_attempt_at, j.created_at), j.created_at
    limit v_limit
    for update of j skip locked
  ), claimed as (
    update public.ct_target_verification_jobs j
    set status = 'processing',
        attempt_count = j.attempt_count + 1,
        locked_at = now(),
        locked_by = v_worker_id,
        metadata_safe = coalesce(j.metadata_safe, '{}'::jsonb) || jsonb_build_object(
          'mode', 'evidence_only',
          'trigger_source', coalesce(nullif(j.metadata_safe->>'trigger_source', ''), 'legacy_valid_pending')
        ),
        updated_at = now()
    from next_jobs
    where j.id = next_jobs.id
    returning j.*
  )
  select * from claimed;
end;
$function$;

-- Preserve the existing business processor while making the mode boundary
-- bidirectional: it can never claim evidence-only work.
create or replace function public.claim_ct_target_verification_jobs(
  batch_limit integer default 5,
  worker_id text default 'dashboard_verify_batch'
)
returns setof public.ct_target_verification_jobs
language plpgsql
set search_path = ''
as $function$
declare
  v_limit integer := least(greatest(coalesce(batch_limit, 5), 1), 10);
  v_worker_id text := left(regexp_replace(
    coalesce(worker_id, 'dashboard_verify_batch'),
    '[^a-zA-Z0-9_.:-]', '_', 'g'
  ), 120);
begin
  return query
  with next_jobs as (
    select j.id
    from public.ct_target_verification_jobs j
    join public.ig_targets t
      on t.id = j.target_id
     and t.account_id = j.account_id
     and lower(coalesce(t.normalized_username, '')) = lower(j.normalized_username)
    where coalesce(j.metadata_safe->>'mode', '') <> 'evidence_only'
      and (
        j.status in ('pending', 'retry_scheduled')
        or (j.status = 'processing' and j.locked_at < now() - interval '15 minutes')
      )
      and coalesce(j.next_attempt_at, now()) <= now()
      and (j.locked_at is null or j.locked_at < now() - interval '15 minutes')
      and lower(coalesce(t.status, '')) not in ('archived', 'deleted')
      and t.archived_at is null
      and t.deleted_at is null
    order by coalesce(j.next_attempt_at, j.created_at), j.created_at
    limit v_limit
    for update of j skip locked
  ), claimed as (
    update public.ct_target_verification_jobs j
    set status = 'processing',
        attempt_count = j.attempt_count + 1,
        locked_at = now(),
        locked_by = v_worker_id,
        updated_at = now()
    from next_jobs
    where j.id = next_jobs.id
    returning j.*
  )
  select * from claimed;
end;
$function$;

create or replace function public.terminalize_invalid_ct_target_evidence_jobs_v1(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer := 0;
begin
  perform public.ct_assert_service_role_v1();
  with invalid_jobs as (
    select j.id
    from public.ct_target_verification_jobs j
    where j.status = 'pending'
      and j.attempt_count = 0
      and j.locked_at is null
      and j.created_at < now() - interval '7 days'
      and coalesce(j.metadata_safe->>'mode', '') = ''
      and not exists (
        select 1
        from public.ig_targets t
        where t.id = j.target_id
          and t.account_id = j.account_id
          and lower(coalesce(t.normalized_username, '')) = lower(j.normalized_username)
          and lower(coalesce(t.status, '')) not in ('archived', 'deleted')
          and t.archived_at is null
          and t.deleted_at is null
      )
    order by j.created_at
    limit least(greatest(coalesce(p_limit, 100), 1), 100)
    for update of j skip locked
  )
  update public.ct_target_verification_jobs j
  set status = 'skipped',
      next_attempt_at = null,
      locked_at = null,
      locked_by = null,
      last_error_code = 'invalid_target_lineage',
      last_error_message = 'Target/account/username lineage is no longer active.',
      metadata_safe = coalesce(j.metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'mode', 'evidence_only',
        'trigger_source', 'legacy_lineage_hygiene',
        'terminalization_reason', 'invalid_target_lineage'
      ),
      updated_at = now()
  from invalid_jobs
  where j.id = invalid_jobs.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.persist_ct_target_evidence_refresh_v1(
  p_target_id uuid,
  p_account_id uuid,
  p_expected_normalized_username text,
  p_outcome text,
  p_provider_checked_at timestamptz default null,
  p_followers_count integer default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target public.ig_targets%rowtype;
  v_username text := lower(btrim(coalesce(p_expected_normalized_username, '')));
  v_outcome text := lower(btrim(coalesce(p_outcome, '')));
begin
  perform public.ct_assert_service_role_v1();
  if v_outcome not in ('found', 'not_found', 'identity_mismatch', 'no_fresh_evidence') then
    raise exception 'invalid_evidence_refresh_outcome' using errcode = '22023';
  end if;

  select t.* into v_target
  from public.ig_targets t
  where t.id = p_target_id and t.account_id = p_account_id
  for update;
  if not found then return 'target_not_found'; end if;
  if lower(coalesce(v_target.normalized_username, '')) <> v_username
     or lower(coalesce(v_target.status, '')) in ('archived', 'deleted')
     or v_target.archived_at is not null
     or v_target.deleted_at is not null then
    return 'identity_mismatch';
  end if;

  if v_outcome = 'found' then
    if p_provider_checked_at is null
       or p_provider_checked_at > now() + interval '5 minutes'
       or p_followers_count is null
       or p_followers_count < 0 then
      raise exception 'invalid_follower_evidence' using errcode = '22023';
    end if;
    if v_target.provider_checked_at is not null
       and v_target.provider_checked_at >= p_provider_checked_at then
      update public.ig_targets
      set periodic_revalidation_window_key = null,
          periodic_revalidation_last_terminal_at = v_target.provider_checked_at,
          periodic_revalidation_next_due_at = v_target.provider_checked_at + interval '7 days'
      where id = p_target_id and account_id = p_account_id;
      return 'already_fresher';
    end if;
    update public.ig_targets
    set followers_count = p_followers_count,
        provider_checked_at = p_provider_checked_at,
        periodic_revalidation_window_key = null,
        periodic_revalidation_last_terminal_at = p_provider_checked_at,
        periodic_revalidation_next_due_at = p_provider_checked_at + interval '7 days',
        updated_at = now()
    where id = p_target_id and account_id = p_account_id;
    return 'updated';
  end if;

  update public.ig_targets
  set periodic_revalidation_window_key = null,
      periodic_revalidation_last_terminal_at = now(),
      periodic_revalidation_next_due_at = now() + interval '30 minutes'
  where id = p_target_id and account_id = p_account_id;
  return v_outcome;
end;
$function$;

revoke all on function public.enqueue_ct_target_evidence_revalidation_job_v1(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_ct_target_evidence_revalidation_jobs_v1(integer, text) from public, anon, authenticated;
revoke all on function public.terminalize_invalid_ct_target_evidence_jobs_v1(integer) from public, anon, authenticated;
revoke all on function public.persist_ct_target_evidence_refresh_v1(uuid, uuid, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.enqueue_ct_target_evidence_revalidation_job_v1(uuid, uuid, text, text) to service_role;
grant execute on function public.claim_ct_target_evidence_revalidation_jobs_v1(integer, text) to service_role;
grant execute on function public.terminalize_invalid_ct_target_evidence_jobs_v1(integer) to service_role;
grant execute on function public.persist_ct_target_evidence_refresh_v1(uuid, uuid, text, text, timestamptz, integer) to service_role;

comment on function public.enqueue_ct_target_evidence_revalidation_job_v1(uuid, uuid, text, text) is
  'Atomically recycles a terminal target verification work slot for evidence-only periodic refresh.';
comment on function public.claim_ct_target_evidence_revalidation_jobs_v1(integer, text) is
  'Claims only periodic evidence-only jobs; legacy/business jobs are excluded.';
comment on function public.claim_ct_target_verification_jobs(integer, text) is
  'Claims business verification jobs only; evidence-only jobs are excluded by contract.';
comment on function public.terminalize_invalid_ct_target_evidence_jobs_v1(integer) is
  'Fail-closed terminalization and durable safe audit for stale jobs with invalid target lineage.';
comment on function public.persist_ct_target_evidence_refresh_v1(uuid, uuid, text, text, timestamptz, integer) is
  'Persists follower evidence without status, quality, archive, pool, or business mutations.';
