-- Safe rollback for account_protection_lists_v1.
-- Refuses to run after any canonical row, version, or audit event has been persisted.

do $$
begin
  if to_regclass('public.account_protection_list_entries') is not null
    and exists (select 1 from public.account_protection_list_entries) then
    raise exception 'account_protection_lists_v1 rollback refused: canonical entries exist';
  end if;
  if to_regclass('public.account_protection_list_versions') is not null
    and exists (select 1 from public.account_protection_list_versions) then
    raise exception 'account_protection_lists_v1 rollback refused: version rows exist';
  end if;
  if to_regclass('public.account_protection_list_events') is not null
    and exists (select 1 from public.account_protection_list_events) then
    raise exception 'account_protection_lists_v1 rollback refused: audit events exist';
  end if;
end;
$$;

drop function if exists public.mutate_account_protection_list(
  uuid, text, text, text[], text[], text[], text, uuid, text, text, bigint, text
);
drop table if exists public.account_protection_list_events;
drop table if exists public.account_protection_list_entries;
drop table if exists public.account_protection_list_versions;

notify pgrst, 'reload schema';
