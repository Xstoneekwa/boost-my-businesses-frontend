-- Canonical migration version 20260626142303 (already applied on main production DB).
-- See supabase/MIGRATION_HISTORY.md for local filename reconciliation (TASK 5C).

alter table public.ig_targets
  add column if not exists periodic_revalidation_last_terminal_at timestamptz,
  add column if not exists periodic_revalidation_next_due_at timestamptz,
  add column if not exists periodic_revalidation_window_key text;

comment on column public.ig_targets.periodic_revalidation_last_terminal_at is
  'UTC timestamp of the last successful terminal periodic CT revalidation.';
comment on column public.ig_targets.periodic_revalidation_next_due_at is
  'UTC timestamp when the next periodic CT revalidation becomes due.';
comment on column public.ig_targets.periodic_revalidation_window_key is
  'Idempotence key for the current periodic revalidation enqueue window.';

create index if not exists ig_targets_periodic_revalidation_due_idx
  on public.ig_targets (periodic_revalidation_next_due_at)
  where status in ('valid', 'active')
    and archived_at is null
    and deleted_at is null;
