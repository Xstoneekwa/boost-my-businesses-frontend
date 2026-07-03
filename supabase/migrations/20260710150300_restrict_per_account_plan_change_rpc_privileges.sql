-- Server-only per-account plan-change RPC surface: revoke client EXECUTE, grant service_role only.
-- These five RPCs must never be exposed to browser anon/authenticated PostgREST callers.
-- Does not alter function bodies, signatures, SECURITY DEFINER, or commercial data.

revoke all on function public.commercial_plan_change_source_revision_for_account_source(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.commercial_plan_change_source_revision_for_account_source(uuid, uuid, uuid, integer) to service_role;

revoke all on function public.account_scoped_credit_balance_cents(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.account_scoped_credit_balance_cents(uuid, uuid, text) to service_role;

revoke all on function public.activate_commercial_plan_change_per_account(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.activate_commercial_plan_change_per_account(uuid, text, text, boolean) to service_role;

revoke all on function public.apply_account_commercial_package_plan_change(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_account_commercial_package_plan_change(uuid, text, uuid) to service_role;

revoke all on function public.bump_account_commercial_policy_revision(uuid, uuid, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.bump_account_commercial_policy_revision(uuid, uuid, text, uuid, uuid, jsonb) to service_role;
