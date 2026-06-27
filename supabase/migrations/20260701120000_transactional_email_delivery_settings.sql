-- Local migration only. Do not apply without explicit GO (TASK 9A).
-- Singleton transactional delivery settings + audit + intent snapshots.

create table if not exists public.transactional_email_delivery_settings (
  settings_key text primary key,
  active_from_email text not null
    check (active_from_email ~* '^[^@]+@[^@]+\.[^@]+$'),
  support_email text not null
    check (support_email ~* '^[^@]+@[^@]+\.[^@]+$'),
  config_version integer not null default 1 check (config_version > 0),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by text null,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.transactional_email_delivery_settings is
  'Singleton transactional email delivery settings for active From address and {{support_email}}.';

insert into public.transactional_email_delivery_settings (
  settings_key,
  active_from_email,
  support_email,
  config_version
) values (
  'default',
  'growth@boostmybusinesses.com',
  'growth@boostmybusinesses.com',
  1
) on conflict (settings_key) do nothing;

create table if not exists public.transactional_email_delivery_settings_audit (
  id uuid primary key default gen_random_uuid(),
  settings_key text not null default 'default',
  previous_active_from_email text not null,
  new_active_from_email text not null,
  previous_support_email text not null,
  new_support_email text not null,
  previous_config_version integer not null,
  new_config_version integer not null,
  changed_at timestamptz not null default timezone('utc', now()),
  changed_by text null,
  change_source text not null default 'admin_relay'
);

comment on table public.transactional_email_delivery_settings_audit is
  'Audit trail for transactional delivery settings changes. No secrets stored.';

create index if not exists transactional_email_delivery_settings_audit_changed_at_idx
  on public.transactional_email_delivery_settings_audit (changed_at desc);

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_from_email_check;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_from_email_check
  check (from_email ~* '^[^@]+@[^@]+\.[^@]+$');

alter table public.client_email_send_intents
  add column if not exists from_email_snapshot text null
    check (from_email_snapshot is null or from_email_snapshot ~* '^[^@]+@[^@]+\.[^@]+$'),
  add column if not exists support_email_snapshot text null
    check (support_email_snapshot is null or support_email_snapshot ~* '^[^@]+@[^@]+\.[^@]+$');

comment on column public.client_email_send_intents.from_email_snapshot is
  'Immutable snapshot of the active From address applied when the intent was created.';
comment on column public.client_email_send_intents.support_email_snapshot is
  'Immutable snapshot of {{support_email}} applied when the intent was created.';

update public.client_email_send_intents
set
  from_email_snapshot = coalesce(from_email_snapshot, from_email),
  support_email_snapshot = coalesce(support_email_snapshot, 'growth@boostmybusinesses.com')
where from_email_snapshot is null
   or support_email_snapshot is null;

alter table public.transactional_email_delivery_settings enable row level security;
alter table public.transactional_email_delivery_settings_audit enable row level security;
