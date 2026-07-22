-- Locked policy: initial attempt + exactly two silent Auto Restart retries.
-- Prepared only; do not apply before the consolidated Auto Login integration.

alter table public.auto_restart_settings
  add column if not exists max_retries_after_initial_failure integer not null default 2;

do $policy$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'auto_restart_settings_max_retries_after_initial_failure_check'
  ) then
    alter table public.auto_restart_settings
      add constraint auto_restart_settings_max_retries_after_initial_failure_check
      check (max_retries_after_initial_failure between 0 and 20);
  end if;
end
$policy$;

update public.auto_restart_settings
set max_retries_after_initial_failure = 2,
    max_attempts_per_session = 3,
    updated_at = now()
where id = 'global';

comment on column public.auto_restart_settings.max_retries_after_initial_failure is
  'Automatic retries after the initial failure. Locked product value: 2; total possible attempts: 3.';
