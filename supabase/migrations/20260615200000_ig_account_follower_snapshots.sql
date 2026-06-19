-- Follower count observations for Instagram accounts (append-only history).
-- Local migration only — do not apply to remote without explicit GO.

create table if not exists public.ig_account_follower_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ig_accounts(id) on delete cascade,
  followers_count integer not null check (followers_count >= 0),
  captured_at timestamptz not null,
  source text not null,
  observation_kind text not null,
  created_at timestamptz not null default now(),
  constraint ig_account_follower_snapshots_source_check check (
    source in ('device_profile_read', 'public_profile_lookup', 'admin_manual_verified')
  ),
  constraint ig_account_follower_snapshots_observation_kind_check check (
    observation_kind in ('baseline', 'daily', 'intraday')
  )
);

create index if not exists ig_account_follower_snapshots_account_captured_idx
  on public.ig_account_follower_snapshots (account_id, captured_at desc);

comment on table public.ig_account_follower_snapshots is
  'Append-only follower count observations. Never derived from bot actions.';

comment on column public.ig_account_follower_snapshots.source is
  'Observation source: device_profile_read, public_profile_lookup, or admin_manual_verified.';

comment on column public.ig_account_follower_snapshots.observation_kind is
  'Collection cadence: baseline, daily, or intraday.';

alter table public.ig_account_follower_snapshots enable row level security;

-- Service role / backend collectors insert and read. Client-facing routes must
-- enforce tenant ownership via client_instagram_accounts before exposing rows.
-- No permissive anon/authenticated policies until client API wiring is reviewed.
