-- Global system settings for dashboard/BotApp relay-managed features.
-- Service role backend access only; no tenant/client exposure.

create table if not exists public.ig_system_settings (
  setting_key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text null
);

create index if not exists ig_system_settings_updated_at_idx
  on public.ig_system_settings (updated_at desc);

comment on table public.ig_system_settings is
  'Key/value JSON settings for global dashboard features (e.g. targeting_ai).';

comment on column public.ig_system_settings.setting_key is
  'Stable setting identifier such as targeting_ai.';

alter table public.ig_system_settings enable row level security;
