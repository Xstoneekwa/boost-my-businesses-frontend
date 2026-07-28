-- Applied migration registry version: 20260728001632.
revoke all on table public.ig_account_dm_counters from public, anon, authenticated;
grant select, insert, update, delete on table public.ig_account_dm_counters to service_role;

alter table public.ig_account_dm_counters enable row level security;
