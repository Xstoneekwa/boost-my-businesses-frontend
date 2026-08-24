-- Terminal cancellation provenance is immutable audit evidence. This data-only
-- reconciliation has no safe destructive rollback. Runtime rollback is the
-- preceding application release; reconciled terminal rows remain authoritative.
do $$
begin
  if exists (
    select 1
    from public.client_instagram_accounts
    where capacity_release_reason = 'terminal_cancel_historical_provenance_v1'
  ) then
    raise exception 'terminal_cancel_historical_provenance_is_immutable';
  end if;
end;
$$;
