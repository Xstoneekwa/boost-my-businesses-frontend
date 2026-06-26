-- Canonical migration version 20260626142312 (already applied on main production DB).
-- See supabase/MIGRATION_HISTORY.md for local filename reconciliation (TASK 5C).

create table if not exists public.client_account_notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  account_id uuid not null,
  category text not null check (category in (
    'needs_more_target_accounts',
    'needs_assistance',
    'account_paused',
    'account_canceled'
  )),
  status text not null default 'active' check (status in ('active', 'resolved')),
  notification_key text not null,
  source_action_id uuid null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz null,
  read_at timestamptz null
);

comment on table public.client_account_notifications is
  'Client-facing persistent notifications keyed per client/account/category.';

create unique index if not exists client_account_notifications_active_key_idx
  on public.client_account_notifications (notification_key)
  where status = 'active';

create index if not exists client_account_notifications_client_active_idx
  on public.client_account_notifications (client_id, created_at desc)
  where status = 'active';

create index if not exists client_account_notifications_client_resolved_idx
  on public.client_account_notifications (client_id, resolved_at desc)
  where status = 'resolved';

alter table public.client_account_notifications enable row level security;
