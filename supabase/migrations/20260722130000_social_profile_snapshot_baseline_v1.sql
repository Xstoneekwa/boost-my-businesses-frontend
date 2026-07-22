-- SOCIAL_PROFILE_SNAPSHOT_BASELINE_V1
-- Candidate only. Adds a separately gated, batch-scoped one-shot baseline claim path.

alter table public.ig_account_social_profile_snapshots
  drop constraint if exists ig_account_social_profile_snapshots_source_trigger_check;
alter table public.ig_account_social_profile_snapshots
  add constraint ig_account_social_profile_snapshots_source_trigger_check
  check (source_trigger in (
    'onboarding_lookup', 'explicit_reanalysis', 'session_end', 'daily_fallback',
    'admin_manual_refresh', 'legacy_import', 'baseline_one_shot'
  ));

alter table public.ig_social_profile_snapshot_jobs
  drop constraint if exists ig_social_profile_snapshot_jobs_source_trigger_check;
alter table public.ig_social_profile_snapshot_jobs
  add constraint ig_social_profile_snapshot_jobs_source_trigger_check
  check (source_trigger in ('session_end', 'daily_fallback', 'admin_manual_refresh', 'baseline_one_shot'));

create unique index if not exists ig_social_profile_snapshot_jobs_baseline_day_idx
  on public.ig_social_profile_snapshot_jobs (account_id, snapshot_local_date, source_trigger)
  where source_trigger = 'baseline_one_shot';

create index if not exists ig_social_profile_snapshot_jobs_baseline_batch_claim_idx
  on public.ig_social_profile_snapshot_jobs (source_event_id, status, available_at, created_at)
  where source_trigger = 'baseline_one_shot';

create or replace function public.claim_ig_social_profile_baseline_jobs(
  p_source_event_id text,
  p_lease_owner text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns setof public.ig_social_profile_snapshot_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_source_event_id), '') is null then
    return;
  end if;

  return query
  with candidates as (
    select j.id
      from public.ig_social_profile_snapshot_jobs j
      join public.ig_accounts account on account.id = j.account_id
     where j.source_trigger = 'baseline_one_shot'
       and j.source_event_id = p_source_event_id
       and j.available_at <= now()
       and (j.status = 'queued' or (j.status = 'processing' and j.lease_expires_at < now()))
       and j.attempts < 3
       and lower(coalesce(nullif(account.admin_lifecycle_status, ''), account.status, '')) = 'active'
       and lower(trim(leading '@' from account.username)) = j.username_normalized
       and lower(trim(leading '@' from account.username)) ~ '^[a-z0-9._]{1,30}$'
       and (
         select count(*)
           from public.account_assignments assignment
          where assignment.account_id = j.account_id
            and assignment.status in ('pending', 'reserved', 'active')
       ) <= 1
       and not exists (
         select 1
           from public.ig_account_social_profile_snapshots snapshot
          where snapshot.account_id = j.account_id
            and snapshot.source_trigger <> 'legacy_import'
            and snapshot.observed_at >= now() - interval '36 hours'
       )
     order by j.available_at, j.created_at
     for update of j skip locked
     limit greatest(1, least(coalesce(p_limit, 10), 10))
  )
  update public.ig_social_profile_snapshot_jobs j
     set status = 'processing',
         attempts = j.attempts + 1,
         lease_owner = left(trim(p_lease_owner), 160),
         lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 300))),
         updated_at = now()
    from candidates c
   where j.id = c.id
  returning j.*;
end;
$$;

revoke all on function public.claim_ig_social_profile_baseline_jobs(text, text, integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_ig_social_profile_baseline_jobs(text, text, integer, integer)
to service_role;

comment on function public.claim_ig_social_profile_baseline_jobs(text, text, integer, integer) is
  'Claims at most ten eligible jobs from one hashed baseline batch; never claims recurring or historical queue work.';
