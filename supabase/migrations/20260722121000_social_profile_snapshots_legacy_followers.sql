-- SOCIAL_PROFILE_SNAPSHOTS_V1
-- Complementary candidate only. Idempotently preserves reliable legacy follower observations.

alter table public.ig_account_social_profile_snapshots
  drop constraint if exists ig_account_social_profile_snapshots_source_provider_check;
alter table public.ig_account_social_profile_snapshots
  add constraint ig_account_social_profile_snapshots_source_provider_check
  check (source_provider in ('searchapi', 'http', 'device_profile_read', 'legacy_follower_snapshot'));

alter table public.ig_account_social_profile_snapshots
  drop constraint if exists ig_account_social_profile_snapshots_source_trigger_check;
alter table public.ig_account_social_profile_snapshots
  add constraint ig_account_social_profile_snapshots_source_trigger_check
  check (source_trigger in ('onboarding_lookup', 'explicit_reanalysis', 'session_end', 'daily_fallback', 'admin_manual_refresh', 'legacy_import'));

with legacy_rows as (
  select
    legacy.id as legacy_id,
    legacy.account_id,
    lower(trim(leading '@' from account.username)) as username_normalized,
    legacy.followers_count,
    legacy.captured_at as observed_at,
    coalesce(assigned.timezone, 'Africa/Johannesburg') as account_timezone,
    case when assigned.timezone is null then 'platform_default' else 'device_assignment' end as timezone_source
  from public.ig_account_follower_snapshots legacy
  join public.ig_accounts account on account.id = legacy.account_id
  left join lateral (
    select device.timezone
    from public.account_assignments assignment
    join public.phone_devices device on device.id = assignment.device_id
    join pg_catalog.pg_timezone_names valid_timezone on valid_timezone.name = device.timezone
    where assignment.account_id = legacy.account_id
      and assignment.status in ('pending', 'reserved', 'active')
      and device.timezone <> 'UTC'
    order by assignment.created_at desc
    limit 1
  ) assigned on true
  where legacy.followers_count >= 0
    and legacy.captured_at is not null
    and lower(trim(leading '@' from account.username)) ~ '^[a-z0-9._]{1,30}$'
)
insert into public.ig_account_social_profile_snapshots (
  account_id,
  username_normalized,
  followers_count,
  following_count,
  posts_count,
  observed_at,
  snapshot_local_date,
  account_timezone,
  timezone_source,
  source_provider,
  source_trigger,
  source_event_id,
  lookup_status,
  freshness_status,
  idempotency_key,
  created_at
)
select
  legacy.account_id,
  legacy.username_normalized,
  legacy.followers_count,
  null,
  null,
  legacy.observed_at,
  (legacy.observed_at at time zone legacy.account_timezone)::date,
  legacy.account_timezone,
  legacy.timezone_source,
  'legacy_follower_snapshot',
  'legacy_import',
  legacy.legacy_id::text,
  'found',
  'partial',
  'legacy-follower-snapshot:v1:' || legacy.legacy_id::text,
  now()
from legacy_rows legacy
on conflict (account_id, idempotency_key) do nothing;

comment on constraint ig_account_social_profile_snapshots_source_provider_check
  on public.ig_account_social_profile_snapshots is
  'Bounded provider provenance including the reliable legacy follower snapshot import.';
