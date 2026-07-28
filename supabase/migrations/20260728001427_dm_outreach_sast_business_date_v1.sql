-- Canonical daily boundary for DM and Outreach is midnight in Africa/Johannesburg.
-- Applied migration registry version: 20260728001427.
-- Timestamps remain timestamptz/UTC; only the derived counter_date changes.

alter table public.ig_account_dm_counters
  alter column counter_date
  set default (timezone('Africa/Johannesburg', now()))::date;

create or replace function public.ensure_dm_counter_row(
  p_account_id uuid,
  p_counter_date date default (timezone('Africa/Johannesburg', now()))::date
)
returns public.ig_account_dm_counters
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.ig_account_dm_counters;
begin
  insert into public.ig_account_dm_counters (account_id, counter_date)
  values (p_account_id, p_counter_date)
  on conflict (account_id, counter_date) do nothing;

  select *
  into v_row
  from public.ig_account_dm_counters
  where account_id = p_account_id
    and counter_date = p_counter_date;

  return v_row;
end;
$function$;

create or replace function public.complete_dm_job(
  p_job_id uuid,
  p_final_status public.dm_job_status,
  p_skip_reason text default null,
  p_last_error text default null,
  p_increment_attempt boolean default false,
  p_retry_delay_seconds integer default null,
  p_metadata_patch jsonb default '{}'::jsonb
)
returns public.ig_dm_jobs
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job public.ig_dm_jobs;
  v_previous_job public.ig_dm_jobs;
  v_counter public.ig_account_dm_counters;
  v_counter_date date;
  v_should_increment boolean;
begin
  if p_final_status not in ('sent', 'skipped', 'failed', 'cancelled') then
    raise exception 'final_status must be sent, skipped, failed, or cancelled';
  end if;

  select *
  into v_previous_job
  from public.ig_dm_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'job not found: %', p_job_id;
  end if;

  update public.ig_dm_jobs
  set
    skip_reason = case when p_final_status = 'skipped' then p_skip_reason else skip_reason end,
    last_error = case when p_final_status in ('failed', 'skipped') then p_last_error else last_error end,
    attempts = case when p_increment_attempt then attempts + 1 else attempts end,
    next_retry_at = case
      when p_final_status = 'failed'
        and p_retry_delay_seconds is not null
        and attempts + case when p_increment_attempt then 1 else 0 end < max_attempts
        then now() + make_interval(secs => greatest(p_retry_delay_seconds, 0))
      else null
    end,
    status = case
      when p_final_status = 'failed'
        and p_retry_delay_seconds is not null
        and attempts + case when p_increment_attempt then 1 else 0 end < max_attempts
        then 'pending'::public.dm_job_status
      else p_final_status
    end,
    reserved_at = case
      when p_final_status = 'failed'
        and p_retry_delay_seconds is not null
        and attempts + case when p_increment_attempt then 1 else 0 end < max_attempts
        then null
      else reserved_at
    end,
    reserved_by = case
      when p_final_status = 'failed'
        and p_retry_delay_seconds is not null
        and attempts + case when p_increment_attempt then 1 else 0 end < max_attempts
        then null
      else reserved_by
    end,
    sent_at = case
      when p_final_status = 'sent' and status is distinct from 'sent'::public.dm_job_status then now()
      when p_final_status = 'sent' then coalesce(sent_at, now())
      else sent_at
    end,
    finished_at = case
      when p_final_status in ('sent', 'skipped', 'cancelled')
        then case
          when status is distinct from p_final_status then now()
          else coalesce(finished_at, now())
        end
      when p_final_status = 'failed'
        and (
          p_retry_delay_seconds is null
          or attempts + case when p_increment_attempt then 1 else 0 end >= max_attempts
        )
        then case
          when status is distinct from 'failed'::public.dm_job_status then now()
          else coalesce(finished_at, now())
        end
      else finished_at
    end,
    metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata_patch, '{}'::jsonb),
    updated_at = now()
  where id = p_job_id
  returning * into v_job;

  if v_job.dm_type = 'welcome' then
    update public.ig_account_followers f
    set
      welcome_dm_status = case v_job.status
        when 'sent' then 'sent'::public.welcome_dm_status
        when 'skipped' then 'skipped'::public.welcome_dm_status
        when 'failed' then 'failed'::public.welcome_dm_status
        when 'pending' then f.welcome_dm_status
        else f.welcome_dm_status
      end,
      welcomed_at = case when v_job.status = 'sent' then coalesce(f.welcomed_at, now()) else f.welcomed_at end,
      skip_reason = case when v_job.status = 'skipped' then v_job.skip_reason else f.skip_reason end,
      last_error = case when v_job.status = 'failed' then v_job.last_error else f.last_error end,
      dm_thread_checked_at = coalesce(f.dm_thread_checked_at, now()),
      updated_at = now()
    where f.account_id = v_job.account_id
      and f.follower_username_normalized = v_job.recipient_username_normalized;
  end if;

  v_should_increment := v_job.status in ('sent', 'skipped', 'failed')
    and v_job.finished_at is not null
    and (
      v_previous_job.status is distinct from v_job.status
      or v_previous_job.finished_at is null
    );

  if v_should_increment then
    v_counter_date := (
      timezone(
        'Africa/Johannesburg',
        case when v_job.status = 'sent' then v_job.sent_at else v_job.finished_at end
      )
    )::date;
    v_counter := public.ensure_dm_counter_row(v_job.account_id, v_counter_date);

    update public.ig_account_dm_counters
    set
      welcome_sent_count = welcome_sent_count
        + case when v_job.dm_type = 'welcome' and v_job.status = 'sent' then 1 else 0 end,
      outreach_sent_count = outreach_sent_count
        + case when v_job.dm_type = 'outreach' and v_job.status = 'sent' then 1 else 0 end,
      total_dm_sent_count = total_dm_sent_count
        + case when v_job.status = 'sent' then 1 else 0 end,
      welcome_skipped_count = welcome_skipped_count
        + case when v_job.dm_type = 'welcome' and v_job.status = 'skipped' then 1 else 0 end,
      outreach_skipped_count = outreach_skipped_count
        + case when v_job.dm_type = 'outreach' and v_job.status = 'skipped' then 1 else 0 end,
      failed_count = failed_count
        + case when v_job.status = 'failed' then 1 else 0 end,
      updated_at = now()
    where id = v_counter.id;
  end if;

  return v_job;
end;
$function$;

-- Rebuild the six existing aggregate rows only from persisted job evidence.
-- sent_at is authoritative for successful DM/Outreach; finished_at is used for
-- the current skipped/failed terminal outcome. No synthetic history is created.
create temporary table dm_counter_sast_rebuild on commit drop as
with outcome_events as (
  select
    account_id,
    dm_type,
    'sent'::text as outcome,
    sent_at as outcome_at
  from public.ig_dm_jobs
  where sent_at is not null

  union all

  select
    account_id,
    dm_type,
    status::text as outcome,
    finished_at as outcome_at
  from public.ig_dm_jobs
  where status in ('skipped', 'failed')
    and finished_at is not null
), aggregated as (
  select
    account_id,
    (timezone('Africa/Johannesburg', outcome_at))::date as counter_date,
    count(*) filter (where dm_type = 'welcome' and outcome = 'sent')::integer as welcome_sent_count,
    count(*) filter (where dm_type = 'outreach' and outcome = 'sent')::integer as outreach_sent_count,
    count(*) filter (where outcome = 'sent')::integer as total_dm_sent_count,
    count(*) filter (where dm_type = 'welcome' and outcome = 'skipped')::integer as welcome_skipped_count,
    count(*) filter (where dm_type = 'outreach' and outcome = 'skipped')::integer as outreach_skipped_count,
    count(*) filter (where outcome = 'failed')::integer as failed_count
  from outcome_events
  group by account_id, (timezone('Africa/Johannesburg', outcome_at))::date
)
select * from aggregated;

delete from public.ig_account_dm_counters;

insert into public.ig_account_dm_counters (
  account_id,
  counter_date,
  welcome_sent_count,
  outreach_sent_count,
  total_dm_sent_count,
  welcome_skipped_count,
  outreach_skipped_count,
  failed_count
)
select
  account_id,
  counter_date,
  welcome_sent_count,
  outreach_sent_count,
  total_dm_sent_count,
  welcome_skipped_count,
  outreach_skipped_count,
  failed_count
from dm_counter_sast_rebuild;

do $assertions$
declare
  v_counter_sent bigint;
  v_job_sent bigint;
begin
  select coalesce(sum(total_dm_sent_count), 0)
  into v_counter_sent
  from public.ig_account_dm_counters;

  select count(*)
  into v_job_sent
  from public.ig_dm_jobs
  where sent_at is not null;

  if v_counter_sent <> v_job_sent then
    raise exception 'DM counter SAST backfill mismatch: counters %, jobs %', v_counter_sent, v_job_sent;
  end if;
end;
$assertions$;

-- SECURITY DEFINER functions are internal service APIs, not public RPCs.
revoke execute on function public.ensure_dm_counter_row(uuid, date) from public, anon, authenticated;
revoke execute on function public.complete_dm_job(uuid, public.dm_job_status, text, text, boolean, integer, jsonb) from public, anon, authenticated;
grant execute on function public.ensure_dm_counter_row(uuid, date) to service_role;
grant execute on function public.complete_dm_job(uuid, public.dm_job_status, text, text, boolean, integer, jsonb) to service_role;
