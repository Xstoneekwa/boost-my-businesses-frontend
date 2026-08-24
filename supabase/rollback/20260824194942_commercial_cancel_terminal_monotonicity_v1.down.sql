-- Safe rollback for terminal cancellation monotonicity V1.
-- Refuse once immutable terminal provenance exists: dropping it would make a
-- cancelled account commercially reusable.
do $$
begin
  if exists (
    select 1 from public.commercial_account_lifecycle_states
    where terminal_cancel_operation_id is not null
  ) then
    raise exception 'rollback_refused_terminal_cancel_provenance_exists';
  end if;
end $$;

drop function if exists public.record_commercial_cancel_terminal_v1(uuid, uuid, uuid, text);

drop trigger if exists terminal_cancel_subscription_monotonicity_v1
  on public.commercial_stripe_subscriptions;
drop function if exists public.enforce_terminal_cancel_subscription_monotonicity_v1();
drop trigger if exists terminal_cancel_entitlement_monotonicity_v1
  on public.client_account_entitlements;
drop function if exists public.enforce_terminal_cancel_entitlement_monotonicity_v1();
drop trigger if exists terminal_cancel_admin_monotonicity_v1 on public.ig_accounts;
drop function if exists public.enforce_terminal_cancel_admin_monotonicity_v1();
drop trigger if exists commercial_cancel_terminal_monotonicity_v1
  on public.commercial_account_lifecycle_states;
drop function if exists public.enforce_commercial_cancel_terminal_monotonicity_v1();

alter table public.commercial_account_lifecycle_states
  drop constraint if exists commercial_account_lifecycle_states_terminal_cancel_complete_check,
  drop column if exists terminal_cancel_stripe_subscription_id,
  drop column if exists terminal_cancel_entitlement_id,
  drop column if exists terminal_cancelled_at,
  drop column if exists terminal_cancel_operation_id;

-- Restore the capacity V1 RPC exactly: last_operation_id is again only the
-- pre-V1.1 authority after a safe, data-free rollback.
create or replace function public.release_client_instagram_account_capacity_v1(
  p_account_id uuid, p_operation_id uuid, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_link public.client_instagram_accounts%rowtype;
  v_state public.commercial_account_lifecycle_states%rowtype;
  v_operation public.commercial_account_lifecycle_operations%rowtype;
  v_entitlement public.client_account_entitlements%rowtype;
  v_subscription public.commercial_stripe_subscriptions%rowtype;
  v_admin_status text;
begin
  if p_account_id is null or p_operation_id is null or nullif(btrim(p_reason), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;
  select * into v_link from public.client_instagram_accounts
    where account_id = p_account_id and active = true for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'active_client_account_link_missing'); end if;
  if v_link.capacity_status = 'released_terminal' then
    return jsonb_build_object('ok', true, 'status', 'already_released_terminal');
  end if;
  select admin_lifecycle_status into v_admin_status from public.ig_accounts where id = p_account_id;
  select * into v_state from public.commercial_account_lifecycle_states where account_id = p_account_id;
  select * into v_operation from public.commercial_account_lifecycle_operations
    where id = p_operation_id and account_id = p_account_id and operation_type = 'cancel'
      and state in ('in_progress', 'completed');
  select * into v_entitlement from public.client_account_entitlements
    where id = v_state.entitlement_id and account_id = p_account_id
      and client_id = v_link.client_id and status = 'entitlement_cancelled';
  select * into v_subscription from public.commercial_stripe_subscriptions
    where stripe_subscription_id = v_state.stripe_subscription_id
      and client_account_entitlement_id = v_state.entitlement_id
      and account_id = p_account_id and status in ('canceled','cancelled','incomplete_expired');
  if v_admin_status <> 'cancelled' or v_state.commercial_state <> 'cancelled'
    or v_state.last_operation_id is distinct from p_operation_id
    or v_operation.id is null or v_entitlement.id is null or v_subscription.stripe_subscription_id is null then
    return jsonb_build_object('ok', false, 'reason', 'terminal_cancellation_evidence_incomplete');
  end if;
  if v_operation.state = 'in_progress' then
    update public.commercial_account_lifecycle_operations
      set state = 'completed', updated_at = now() where id = v_operation.id and state = 'in_progress';
  end if;
  update public.client_instagram_accounts set
    capacity_status = 'released_terminal', capacity_released_at = now(),
    capacity_release_reason = btrim(p_reason), capacity_release_operation_id = p_operation_id,
    updated_at = now()
  where id = v_link.id and capacity_status = 'occupied';
  return jsonb_build_object('ok', true, 'status', 'released_terminal');
end;
$$;

revoke all on function public.release_client_instagram_account_capacity_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_client_instagram_account_capacity_v1(uuid, uuid, text)
  to service_role;
