-- Canonical migration version 20260626142335 (already applied on main production DB).
-- See supabase/MIGRATION_HISTORY.md for local filename reconciliation (TASK 5C).

create table if not exists public.client_email_templates (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in (
    'account_paused',
    'account_canceled',
    'needs_assistance',
    'needs_more_target_accounts'
  )),
  version integer not null check (version > 0),
  status text not null default 'active' check (status in ('active', 'retired')),
  subject text not null,
  body_text text not null,
  body_html text not null,
  allowed_variables jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  created_by text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by text not null,
  unique (category, version)
);

comment on table public.client_email_templates is
  'Versioned transactional email templates edited from BotApp. One active version per category.';

create unique index if not exists client_email_templates_active_category_idx
  on public.client_email_templates (category)
  where status = 'active';

create index if not exists client_email_templates_category_version_idx
  on public.client_email_templates (category, version desc);

alter table public.client_email_templates enable row level security;

create table if not exists public.client_email_send_intents (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in (
    'account_paused',
    'account_canceled',
    'needs_assistance',
    'needs_more_target_accounts'
  )),
  client_id uuid not null,
  account_id uuid not null,
  recipient_email text not null,
  from_email text not null default 'growth@boostmybusinesses.com'
    check (from_email = 'growth@boostmybusinesses.com'),
  trigger text not null check (trigger in ('manual', 'automatic', 'reminder')),
  reminder_index smallint null check (reminder_index is null or (reminder_index >= 0 and reminder_index <= 5)),
  template_id uuid null references public.client_email_templates (id),
  template_version integer null,
  snapshot_subject text not null,
  snapshot_body_text text not null,
  snapshot_body_html text not null,
  source_notification_id uuid null,
  source_action_id uuid null,
  idempotency_key text not null,
  status text not null default 'pending' check (status in (
    'pending',
    'scheduled',
    'sent',
    'canceled',
    'failed'
  )),
  created_at timestamptz not null default timezone('utc', now()),
  scheduled_for timestamptz null,
  sent_at timestamptz null,
  resolved_at timestamptz null
);

comment on table public.client_email_send_intents is
  'Canonical email outbox. No provider sends are wired in TASK 5A.';

create unique index if not exists client_email_send_intents_idempotency_key_idx
  on public.client_email_send_intents (idempotency_key);

create index if not exists client_email_send_intents_created_at_idx
  on public.client_email_send_intents (created_at desc);

create index if not exists client_email_send_intents_client_created_idx
  on public.client_email_send_intents (client_id, created_at desc);

create index if not exists client_email_send_intents_account_created_idx
  on public.client_email_send_intents (account_id, created_at desc);

create index if not exists client_email_send_intents_category_created_idx
  on public.client_email_send_intents (category, created_at desc);

create index if not exists client_email_send_intents_trigger_created_idx
  on public.client_email_send_intents (trigger, created_at desc);

create index if not exists client_email_send_intents_status_created_idx
  on public.client_email_send_intents (status, created_at desc);

alter table public.client_email_send_intents enable row level security;

create table if not exists public.client_email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references public.client_email_send_intents (id) on delete cascade,
  provider text null,
  provider_message_id text null,
  webhook_event_id text null,
  status text not null check (status in (
    'queued',
    'sent',
    'delivered',
    'deferred',
    'bounced',
    'failed',
    'complained',
    'suppressed'
  )),
  occurred_at timestamptz not null default timezone('utc', now()),
  last_error_redacted text null,
  metadata_redacted jsonb not null default '{}'::jsonb
);

comment on table public.client_email_delivery_events is
  'Provider delivery journal for transactional email intents.';

create unique index if not exists client_email_delivery_events_webhook_event_id_idx
  on public.client_email_delivery_events (webhook_event_id)
  where webhook_event_id is not null;

create index if not exists client_email_delivery_events_intent_occurred_idx
  on public.client_email_delivery_events (intent_id, occurred_at desc);

create index if not exists client_email_delivery_events_status_occurred_idx
  on public.client_email_delivery_events (status, occurred_at desc);

alter table public.client_email_delivery_events enable row level security;
