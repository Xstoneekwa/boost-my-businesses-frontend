-- Production incident notification channel settings.
-- Stores Slack/Discord webhooks as write-only encrypted ciphertext for service-role backends.

create table if not exists public.incident_notification_channel_settings (
  channel text primary key,
  enabled boolean not null default false,
  webhook_ciphertext text,
  configured boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_redacted text,
  last_test_at timestamptz,
  last_test_status text,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint incident_notification_channel_settings_channel_check
    check (channel in ('slack', 'discord')),
  constraint incident_notification_channel_settings_attempt_count_check
    check (attempt_count >= 0),
  constraint incident_notification_channel_settings_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.incident_notification_channel_settings is
  'Write-only Slack/Discord incident notification settings. webhook_ciphertext is service-role only and must never be returned by public APIs.';

comment on column public.incident_notification_channel_settings.webhook_ciphertext is
  'Encrypted webhook URL ciphertext. Never expose through API responses, logs, or clients.';

alter table public.incident_notification_channel_settings enable row level security;

do $policy$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'incident_notification_channel_settings'
      and policyname = 'incident_notification_channel_settings_service_role_all'
  ) then
    create policy incident_notification_channel_settings_service_role_all
      on public.incident_notification_channel_settings
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end
$policy$;

do $trigger$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'incident_notification_channel_settings_set_updated_at'
      and tgrelid = 'public.incident_notification_channel_settings'::regclass
  ) then
    create trigger incident_notification_channel_settings_set_updated_at
      before update on public.incident_notification_channel_settings
      for each row
      execute function public.set_updated_at();
  end if;
end
$trigger$;

revoke all on table public.incident_notification_channel_settings from public, anon, authenticated;
grant all on table public.incident_notification_channel_settings to service_role;
