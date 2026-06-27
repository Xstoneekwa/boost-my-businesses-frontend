-- Local migration only. Do not apply without explicit GO (TASK 8A).
-- Generic lifecycle email episodes for account_paused, account_canceled, needs_assistance.

create table if not exists public.client_email_lifecycle_episodes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  category text not null check (category in (
    'account_paused',
    'account_canceled',
    'needs_assistance'
  )),
  source_action_id uuid null,
  status text not null check (status in ('active', 'resolved', 'canceled')),
  started_at timestamptz not null,
  resolved_at timestamptz null,
  canceled_at timestamptz null,
  close_reason text null check (
    close_reason is null
    or close_reason in (
      'lifecycle_state_cleared',
      'account_reactivated',
      'superseded_by_new_episode'
    )
  ),
  episode_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.client_email_lifecycle_episodes is
  'Lifecycle email episodes for account_paused, account_canceled, and needs_assistance. Separate from needs_more_target_accounts sequences.';

create unique index if not exists client_email_lifecycle_episodes_episode_key_idx
  on public.client_email_lifecycle_episodes (episode_key);

create unique index if not exists client_email_lifecycle_episodes_active_account_category_idx
  on public.client_email_lifecycle_episodes (account_id, category)
  where status = 'active';

create index if not exists client_email_lifecycle_episodes_account_category_started_idx
  on public.client_email_lifecycle_episodes (account_id, category, started_at desc);

alter table public.client_email_lifecycle_episodes enable row level security;

comment on column public.client_email_lifecycle_episodes.source_action_id is
  'Optional dashboard action reference when a future category uses account_dashboard_actions.';
