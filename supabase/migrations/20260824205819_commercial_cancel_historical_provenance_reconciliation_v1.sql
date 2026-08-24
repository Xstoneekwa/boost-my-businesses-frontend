-- Reconcile terminal cancellation provenance from immutable historical evidence.
-- This intentionally does not trust lifecycle state's mutable current pointers.

with proven as (
  select distinct on (st.account_id)
    st.account_id,
    op.id as operation_id,
    op.updated_at as cancelled_at,
    ent.id as entitlement_id,
    sub.stripe_subscription_id
  from public.commercial_account_lifecycle_states st
  join public.ig_accounts a
    on a.id = st.account_id
   and a.admin_lifecycle_status = 'cancelled'
  join public.client_instagram_accounts cia
    on cia.account_id = st.account_id
   and cia.active = true
  join public.commercial_account_lifecycle_operations op
    on op.account_id = st.account_id
   and op.operation_type = 'cancel'
   and op.state = 'completed'
   and op.entitlement_id is not null
  join public.client_account_entitlements ent
    on ent.id = op.entitlement_id
   and ent.account_id = st.account_id
   and ent.client_id = cia.client_id
   and ent.status = 'entitlement_cancelled'
  join public.commercial_stripe_subscriptions sub
    on sub.client_account_entitlement_id = ent.id
   and sub.account_id = st.account_id
   and sub.status in ('canceled', 'cancelled', 'incomplete_expired')
  where st.terminal_cancel_operation_id is null
    and st.commercial_state in ('cancelled', 'action_required')
  order by st.account_id, op.updated_at asc, op.id, sub.stripe_subscription_id
)
update public.commercial_account_lifecycle_states st
set commercial_state = 'cancelled',
    action_required_reason = null,
    entitlement_id = p.entitlement_id,
    stripe_subscription_id = p.stripe_subscription_id,
    terminal_cancel_operation_id = p.operation_id,
    terminal_cancelled_at = p.cancelled_at,
    terminal_cancel_entitlement_id = p.entitlement_id,
    terminal_cancel_stripe_subscription_id = p.stripe_subscription_id,
    updated_at = now()
from proven p
where st.account_id = p.account_id;

update public.client_instagram_accounts cia
set capacity_status = 'released_terminal',
    capacity_released_at = coalesce(cia.capacity_released_at, now()),
    capacity_release_reason = 'terminal_cancel_historical_provenance_v1',
    capacity_release_operation_id = st.terminal_cancel_operation_id,
    updated_at = now()
from public.commercial_account_lifecycle_states st
where cia.account_id = st.account_id
  and cia.active = true
  and cia.capacity_status = 'occupied'
  and st.terminal_cancel_operation_id is not null;

