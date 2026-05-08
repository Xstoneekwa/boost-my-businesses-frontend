create table if not exists public.ig_account_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  template_type text not null default 'full',
  settings_payload jsonb not null default '{}'::jsonb,
  filters_payload jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint ig_account_templates_template_type_check
    check (template_type in ('settings', 'filters', 'full'))
);

create table if not exists public.ig_devices (
  id uuid primary key default gen_random_uuid(),
  device_name text not null,
  device_udid text,
  platform text default 'android',
  status text default 'offline',
  appium_port int,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.ig_accounts
  add column if not exists device_id uuid references public.ig_devices(id),
  add column if not exists clone_mode text default 'off',
  add column if not exists login_method text default 'manual',
  add column if not exists internal_label text,
  add column if not exists notes text;

create unique index if not exists ig_account_templates_single_default_idx
  on public.ig_account_templates(is_default)
  where is_default = true;

create index if not exists ig_account_templates_updated_at_idx
  on public.ig_account_templates(updated_at desc);

create index if not exists ig_devices_updated_at_idx
  on public.ig_devices(updated_at desc);

insert into public.ig_account_templates (
  name,
  description,
  template_type,
  settings_payload,
  filters_payload,
  is_default
)
select
  'Default Safe Setup',
  'Safe baseline for new Instagram Account setup.',
  'full',
  '{
    "dry_run_enabled": true,
    "send_enabled": false,
    "safe_review_mode": true,
    "follow_enabled": false,
    "like_enabled": false,
    "story_watch_enabled": false,
    "max_dm_per_run": 1,
    "random_delay_min_seconds": 8,
    "random_delay_max_seconds": 20
  }'::jsonb,
  '{
    "skip_followers": true,
    "skip_following": true,
    "skip_business_profiles": false,
    "skip_non_business_profiles": false,
    "min_followers": 1,
    "min_following": 1,
    "min_posts": 1
  }'::jsonb,
  true
where not exists (
  select 1
  from public.ig_account_templates
  where is_default = true
);
