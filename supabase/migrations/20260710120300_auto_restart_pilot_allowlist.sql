-- Single pilot account allowlist for Auto Restart V1.
-- Exactly one account may be designated; null means no pilot selected.

alter table public.auto_restart_settings
  add column if not exists pilot_account_id uuid null references public.ig_accounts (id) on delete set null;

create index if not exists auto_restart_settings_pilot_account_id_idx
  on public.auto_restart_settings (pilot_account_id)
  where pilot_account_id is not null;

comment on column public.auto_restart_settings.pilot_account_id is
  'Single allowlisted pilot account for Auto Restart V1. Required before active mode.';
