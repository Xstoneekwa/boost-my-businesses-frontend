alter table public.ig_accounts
  add column if not exists archived_at timestamptz,
  add column if not exists trashed_at timestamptz,
  add column if not exists scheduled_trash_at timestamptz,
  add column if not exists scheduled_delete_at timestamptz,
  add column if not exists restored_at timestamptz;

