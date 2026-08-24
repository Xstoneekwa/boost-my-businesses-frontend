do $$
begin
  if exists (select 1 from public.client_instagram_accounts where capacity_status = 'released_terminal') then
    raise exception 'rollback_refused_released_terminal_capacity_exists';
  end if;
end $$;

drop function if exists public.release_client_instagram_account_capacity_v1(uuid, uuid, text);
drop trigger if exists client_instagram_accounts_capacity_monotonicity_v1 on public.client_instagram_accounts;
drop function if exists public.enforce_client_instagram_account_capacity_monotonicity_v1();
drop index if exists public.client_instagram_accounts_client_capacity_idx;
alter table public.client_instagram_accounts
  drop constraint if exists client_instagram_accounts_capacity_metadata_check,
  drop constraint if exists client_instagram_accounts_capacity_status_check,
  drop column if exists capacity_release_operation_id,
  drop column if exists capacity_release_reason,
  drop column if exists capacity_released_at,
  drop column if exists capacity_status;
