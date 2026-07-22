-- SOCIAL_PROFILE_SNAPSHOT_ENQUEUE_COST_GUARD_V1
-- One active job per public identity and one canonical, server-only enqueue gate.

create unique index if not exists ig_social_profile_snapshot_jobs_one_active_identity_idx
  on public.ig_social_profile_snapshot_jobs (account_id, username_normalized)
  where status in ('queued', 'processing');

create or replace function public.enqueue_ig_social_profile_snapshot_job_guarded(
  p_account_id uuid,
  p_username_normalized text,
  p_snapshot_local_date date,
  p_account_timezone text,
  p_timezone_source text,
  p_source_trigger text,
  p_idempotency_key text,
  p_source_event_id text default null,
  p_source_run_id uuid default null,
  p_source_business_session_id uuid default null,
  p_explicit_admin_refresh boolean default false,
  p_dry_run boolean default false,
  p_now timestamptz default now()
)
returns table (
  classification text,
  reason text,
  job_id uuid,
  job_status text,
  created boolean,
  provider_calls_new_job_max integer,
  existing_retry_provider_calls_max integer,
  retry_due boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := lower(trim(leading '@' from trim(coalesce(p_username_normalized, ''))));
  v_current_username text;
  v_lifecycle text;
  v_latest_success_at timestamptz;
  v_active public.ig_social_profile_snapshot_jobs%rowtype;
  v_terminal public.ig_social_profile_snapshot_jobs%rowtype;
  v_inserted public.ig_social_profile_snapshot_jobs%rowtype;
begin
  if p_now is null then
    raise exception 'social_profile_snapshot_guard_now_required';
  end if;
  if v_username !~ '^[a-z0-9._]{1,30}$' then
    return query select 'terminal_suppressed', 'invalid_username', null::uuid, null::text, false, 0, 0, false;
    return;
  end if;
  if p_snapshot_local_date is null
     or nullif(trim(p_account_timezone), '') is null
     or p_timezone_source not in ('device_assignment', 'schedule', 'platform_default')
     or p_source_trigger not in ('session_end', 'daily_fallback', 'admin_manual_refresh', 'baseline_one_shot')
     or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'social_profile_snapshot_guard_invalid_request';
  end if;

  select lower(trim(leading '@' from trim(account.username))),
         lower(coalesce(nullif(account.admin_lifecycle_status, ''), account.status, ''))
    into v_current_username, v_lifecycle
    from public.ig_accounts account
   where account.id = p_account_id;
  if not found then
    return query select 'terminal_suppressed', 'account_not_found', null::uuid, null::text, false, 0, 0, false;
    return;
  end if;
  if v_lifecycle <> 'active' then
    return query select 'terminal_suppressed', 'lifecycle_not_active', null::uuid, null::text, false, 0, 0, false;
    return;
  end if;
  if v_current_username <> v_username then
    return query select 'terminal_suppressed', 'current_username_mismatch', null::uuid, null::text, false, 0, 0, false;
    return;
  end if;

  if not p_dry_run then
    perform pg_advisory_xact_lock(hashtextextended(p_account_id::text || ':' || v_username, 0));
  end if;

  select snapshot.observed_at
    into v_latest_success_at
    from public.ig_account_social_profile_snapshots snapshot
   where snapshot.account_id = p_account_id
     and snapshot.username_normalized = v_username
     and snapshot.lookup_status = 'found'
     and snapshot.source_trigger <> 'legacy_import'
   order by snapshot.observed_at desc
   limit 1;

  if not p_explicit_admin_refresh
     and v_latest_success_at is not null
     and v_latest_success_at >= p_now - interval '36 hours' then
    return query select 'skipped_fresh', 'modern_snapshot_within_36h', null::uuid, null::text, false, 0, 0, false;
    return;
  end if;

  select job.*
    into v_active
    from public.ig_social_profile_snapshot_jobs job
   where job.account_id = p_account_id
     and job.username_normalized = v_username
     and job.status in ('queued', 'processing')
   order by case when job.status = 'processing' then 0 else 1 end, job.created_at desc
   limit 1;
  if found then
    if v_active.attempts >= 3 then
      return query select 'terminal_suppressed', 'retry_exhausted_existing_job', v_active.id, v_active.status,
        false, 0, 0, false;
    elsif v_active.status = 'queued' and v_active.attempts > 0 and v_active.available_at > p_now then
      return query select 'retryable_backoff', 'existing_retry_backoff', v_active.id, v_active.status,
        false, 0, 0, false;
    else
      return query select 'existing_job_pending',
        case when v_active.status = 'processing' then 'existing_job_processing' else 'existing_job_due' end,
        v_active.id, v_active.status, false, 0,
        case when v_active.status = 'queued' and v_active.available_at <= p_now and v_active.attempts < 3 then 1 else 0 end,
        v_active.status = 'queued' and v_active.available_at <= p_now and v_active.attempts < 3;
    end if;
    return;
  end if;

  if p_explicit_admin_refresh and exists (
    select 1
      from public.ig_social_profile_snapshot_jobs job
     where job.account_id = p_account_id
       and job.username_normalized = v_username
       and job.source_trigger = 'admin_manual_refresh'
       and job.created_at >= p_now - interval '6 hours'
  ) then
    return query select 'terminal_suppressed', 'admin_refresh_cooldown', null::uuid, null::text, false, 0, 0, false;
    return;
  end if;

  if not p_explicit_admin_refresh then
    select job.*
      into v_terminal
      from public.ig_social_profile_snapshot_jobs job
     where job.account_id = p_account_id
       and job.username_normalized = v_username
       and job.status = 'failed'
       and (
         job.last_error_code in ('not_found', 'invalid_username', 'profile_unavailable')
         or job.last_error_code like 'retry_exhausted:%'
       )
     order by job.updated_at desc, job.created_at desc
     limit 1;
    if found and (v_latest_success_at is null or v_terminal.updated_at > v_latest_success_at) then
      return query select 'terminal_suppressed', 'latest_terminal_failure_for_current_username',
        v_terminal.id, v_terminal.status, false, 0, 0, false;
      return;
    end if;
  end if;

  if p_dry_run then
    return query select 'enqueue_allowed',
      case when p_explicit_admin_refresh then 'explicit_admin_refresh' else 'automatic_collection_due' end,
      null::uuid, null::text, false, 1, 0, false;
    return;
  end if;

  begin
    insert into public.ig_social_profile_snapshot_jobs (
      account_id, username_normalized, snapshot_local_date, account_timezone, timezone_source,
      source_trigger, source_event_id, source_run_id, source_business_session_id,
      idempotency_key, status
    ) values (
      p_account_id, v_username, p_snapshot_local_date, trim(p_account_timezone), p_timezone_source,
      p_source_trigger, nullif(trim(p_source_event_id), ''), p_source_run_id, p_source_business_session_id,
      trim(p_idempotency_key), 'queued'
    )
    on conflict (account_id, idempotency_key) do nothing
    returning * into v_inserted;
  exception when unique_violation then
    v_inserted.id := null;
  end;

  if v_inserted.id is not null then
    return query select 'enqueued', 'automatic_collection_due', v_inserted.id, v_inserted.status, true, 1, 0, false;
    return;
  end if;

  select job.*
    into v_active
    from public.ig_social_profile_snapshot_jobs job
   where job.account_id = p_account_id
     and job.username_normalized = v_username
     and job.status in ('queued', 'processing')
   order by job.created_at desc
   limit 1;
  return query select 'existing_job_pending', 'concurrent_or_idempotent_enqueue',
    v_active.id, v_active.status, false, 0,
    case when v_active.status = 'queued' and v_active.available_at <= p_now and v_active.attempts < 3 then 1 else 0 end,
    v_active.status = 'queued' and v_active.available_at <= p_now and v_active.attempts < 3;
end;
$$;

revoke all on function public.enqueue_ig_social_profile_snapshot_job_guarded(
  uuid, text, date, text, text, text, text, text, uuid, uuid, boolean, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.enqueue_ig_social_profile_snapshot_job_guarded(
  uuid, text, date, text, text, text, text, text, uuid, uuid, boolean, boolean, timestamptz
) to service_role;

comment on function public.enqueue_ig_social_profile_snapshot_job_guarded(
  uuid, text, date, text, text, text, text, text, uuid, uuid, boolean, boolean, timestamptz
) is 'Atomically classifies and optionally enqueues one social profile snapshot job without provider access.';
