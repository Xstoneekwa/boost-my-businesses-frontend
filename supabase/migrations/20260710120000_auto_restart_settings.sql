-- Auto Restart V1 canonical settings (global singleton).
-- Defaults remain OFF; operators enable from Admin or BotApp after foundation deploy.

create table if not exists public.auto_restart_settings (
  id text primary key default 'global',
  auto_restart_enabled boolean not null default false,
  mode text not null default 'disabled',
  check_every_minutes integer not null default 15,
  restart_delay_minutes integer not null default 20,
  max_attempts_per_session integer not null default 2,
  max_restarts_per_day_per_account integer not null default 3,
  max_restarts_per_window_per_account integer not null default 2,
  restart_yellow_accounts boolean not null default false,
  restart_red_accounts boolean not null default false,
  respect_blackout_windows boolean not null default true,
  respect_six_hour_window boolean not null default true,
  resume_follow_if_quota_remaining boolean not null default true,
  resume_unfollow_if_quota_remaining boolean not null default true,
  block_on_challenge boolean not null default true,
  block_on_restriction boolean not null default true,
  block_on_account_mismatch boolean not null default true,
  block_on_device_offline boolean not null default true,
  notify_on_blocked_restart boolean not null default true,
  phone_rest_enabled boolean not null default false,
  phone_rest_max_session_minutes integer null,
  phone_rest_min_rest_minutes integer null,
  updated_at timestamptz not null default now(),
  updated_by uuid null,
  constraint auto_restart_settings_id_check check (id = 'global'),
  constraint auto_restart_settings_mode_check
    check (mode in ('disabled', 'dry_run', 'active')),
  constraint auto_restart_settings_check_every_minutes_check
    check (check_every_minutes between 1 and 1440),
  constraint auto_restart_settings_restart_delay_minutes_check
    check (restart_delay_minutes between 1 and 1440),
  constraint auto_restart_settings_max_attempts_per_session_check
    check (max_attempts_per_session between 0 and 20),
  constraint auto_restart_settings_max_restarts_per_day_check
    check (max_restarts_per_day_per_account between 0 and 50),
  constraint auto_restart_settings_max_restarts_per_window_check
    check (max_restarts_per_window_per_account between 0 and 50)
);

insert into public.auto_restart_settings (id)
values ('global')
on conflict (id) do nothing;

comment on table public.auto_restart_settings is
  'Canonical Auto Restart policy for phone-farm operators. Disabled by default.';

alter table public.auto_restart_settings enable row level security;

do $policy$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'auto_restart_settings'
      and policyname = 'auto_restart_settings_service_role_all'
  ) then
    create policy auto_restart_settings_service_role_all
      on public.auto_restart_settings
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end
$policy$;

revoke all on table public.auto_restart_settings from public, anon, authenticated;
grant all on table public.auto_restart_settings to service_role;
