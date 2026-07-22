-- SOCIAL_PROFILE_SNAPSHOTS_V1
-- Candidate only. Append-only public profile observations and a server-only queue.

create table if not exists public.ig_account_social_profile_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  username_normalized text not null check (
    username_normalized = lower(trim(username_normalized))
    and username_normalized ~ '^[a-z0-9._]{1,30}$'
  ),
  followers_count integer check (followers_count is null or followers_count >= 0),
  following_count integer check (following_count is null or following_count >= 0),
  posts_count integer check (posts_count is null or posts_count >= 0),
  observed_at timestamptz not null,
  snapshot_local_date date not null,
  account_timezone text not null,
  timezone_source text not null check (timezone_source in ('device_assignment', 'schedule', 'platform_default')),
  source_provider text not null check (source_provider in ('searchapi', 'http', 'device_profile_read')),
  source_trigger text not null check (source_trigger in ('onboarding_lookup', 'explicit_reanalysis', 'session_end', 'daily_fallback', 'admin_manual_refresh')),
  source_event_id text,
  source_run_id uuid,
  source_business_session_id uuid,
  lookup_status text not null check (lookup_status = 'found'),
  freshness_status text not null check (freshness_status in ('fresh', 'stale', 'partial')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint ig_account_social_profile_snapshots_has_metric check (
    followers_count is not null or following_count is not null or posts_count is not null
  ),
  constraint ig_account_social_profile_snapshots_unique_key unique (account_id, idempotency_key)
);

create index if not exists ig_account_social_profile_snapshots_account_observed_idx
  on public.ig_account_social_profile_snapshots (account_id, observed_at desc);
create index if not exists ig_account_social_profile_snapshots_account_local_day_idx
  on public.ig_account_social_profile_snapshots (account_id, snapshot_local_date desc, observed_at desc);
create unique index if not exists ig_account_social_profile_snapshots_daily_success_idx
  on public.ig_account_social_profile_snapshots (account_id, snapshot_local_date, source_trigger)
  where source_trigger = 'daily_fallback' and lookup_status = 'found';

comment on table public.ig_account_social_profile_snapshots is
  'Append-only absolute Instagram public profile observations; never derived from follow or unfollow actions.';

create or replace function public.reject_social_profile_snapshot_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'social_profile_snapshots_are_append_only';
end;
$$;

drop trigger if exists reject_social_profile_snapshot_update_delete on public.ig_account_social_profile_snapshots;
create trigger reject_social_profile_snapshot_update_delete
before update or delete on public.ig_account_social_profile_snapshots
for each row execute function public.reject_social_profile_snapshot_mutation();

create table if not exists public.ig_social_profile_snapshot_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  username_normalized text not null check (
    username_normalized = lower(trim(username_normalized))
    and username_normalized ~ '^[a-z0-9._]{1,30}$'
  ),
  snapshot_local_date date not null,
  account_timezone text not null,
  timezone_source text not null check (timezone_source in ('device_assignment', 'schedule', 'platform_default')),
  source_trigger text not null check (source_trigger in ('session_end', 'daily_fallback', 'admin_manual_refresh')),
  source_event_id text,
  source_run_id uuid,
  source_business_session_id uuid,
  idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed', 'discarded')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ig_social_profile_snapshot_jobs_unique_key unique (account_id, idempotency_key)
);

create index if not exists ig_social_profile_snapshot_jobs_claim_idx
  on public.ig_social_profile_snapshot_jobs (status, available_at, created_at);

create or replace function public.claim_ig_social_profile_snapshot_jobs(
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
  return query
  with candidates as (
    select j.id
      from public.ig_social_profile_snapshot_jobs j
     where j.available_at <= now()
       and (j.status = 'queued' or (j.status = 'processing' and j.lease_expires_at < now()))
       and j.attempts < 3
     order by j.available_at, j.created_at
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 10), 25))
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

alter table public.ig_account_social_profile_snapshots enable row level security;
alter table public.ig_social_profile_snapshot_jobs enable row level security;

revoke all on table public.ig_account_social_profile_snapshots from public, anon, authenticated;
revoke all on table public.ig_social_profile_snapshot_jobs from public, anon, authenticated;
revoke all on function public.claim_ig_social_profile_snapshot_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.reject_social_profile_snapshot_mutation() from public, anon, authenticated;
grant select, insert on table public.ig_account_social_profile_snapshots to service_role;
grant select, insert, update on table public.ig_social_profile_snapshot_jobs to service_role;
grant execute on function public.claim_ig_social_profile_snapshot_jobs(text, integer, integer) to service_role;
