-- Local migration only. Do not apply without explicit GO (TASK 7A).
-- Canonical business state for needs_more_target_accounts email sequences.

create table if not exists public.client_email_needs_more_targets_sequences (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  client_id uuid not null,
  source_action_id uuid null,
  status text not null check (status in ('active', 'resolved', 'canceled')),
  eligible_target_count_at_start integer not null check (eligible_target_count_at_start >= 0),
  threshold_at_start integer not null default 5 check (threshold_at_start = 5),
  started_at timestamptz not null,
  resolved_at timestamptz null,
  canceled_at timestamptz null,
  close_reason text null check (
    close_reason is null
    or close_reason in (
      'eligible_targets_above_threshold',
      'needs_more_signal_resolved',
      'account_canceled'
    )
  ),
  next_reminder_index smallint not null default 0
    check (next_reminder_index >= 0 and next_reminder_index <= 6),
  last_completed_reminder_index smallint null
    check (
      last_completed_reminder_index is null
      or (last_completed_reminder_index >= 0 and last_completed_reminder_index <= 5)
    ),
  episode_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.client_email_needs_more_targets_sequences is
  'Lifecycle email sequence episodes for needs_more_target_accounts. Intents remain send attempts; this table owns sequence state.';

create unique index if not exists client_email_needs_more_targets_sequences_episode_key_idx
  on public.client_email_needs_more_targets_sequences (episode_key);

create unique index if not exists client_email_needs_more_targets_sequences_active_account_idx
  on public.client_email_needs_more_targets_sequences (account_id)
  where status = 'active';

create index if not exists client_email_needs_more_targets_sequences_account_started_idx
  on public.client_email_needs_more_targets_sequences (account_id, started_at desc);

alter table public.client_email_needs_more_targets_sequences enable row level security;

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_trigger_check;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_trigger_check
  check (trigger in (
    'manual',
    'automatic',
    'reminder',
    'manual_test',
    'automatic_initial',
    'automatic_reminder'
  ));

alter table public.client_email_send_intents
  add column if not exists sequence_id uuid null;

comment on column public.client_email_send_intents.sequence_id is
  'Optional FK to client_email_needs_more_targets_sequences when lifecycle automation is enabled.';

create index if not exists client_email_send_intents_sequence_id_idx
  on public.client_email_send_intents (sequence_id)
  where sequence_id is not null;
