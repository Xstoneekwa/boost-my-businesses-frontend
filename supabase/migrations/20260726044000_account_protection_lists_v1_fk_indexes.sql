-- Cover nullable auth-user foreign keys used by audit and account cleanup paths.

create index if not exists account_protection_list_entries_created_by_idx
  on public.account_protection_list_entries (created_by_auth_user_id)
  where created_by_auth_user_id is not null;

create index if not exists account_protection_list_entries_updated_by_idx
  on public.account_protection_list_entries (updated_by_auth_user_id)
  where updated_by_auth_user_id is not null;

create index if not exists account_protection_list_events_actor_idx
  on public.account_protection_list_events (actor_auth_user_id)
  where actor_auth_user_id is not null;
