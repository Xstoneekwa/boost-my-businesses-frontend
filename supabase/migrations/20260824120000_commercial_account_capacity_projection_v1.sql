-- Commercial account capacity projection V1.
-- `active` remains an ownership/history visibility flag. Capacity is projected separately.

alter table public.client_instagram_accounts
  add column if not exists capacity_status text not null default 'occupied',
  add column if not exists capacity_released_at timestamptz null,
  add column if not exists capacity_release_reason text null,
  add column if not exists capacity_release_operation_id uuid null
    references public.commercial_account_lifecycle_operations(id) on delete restrict;

alter table public.client_instagram_accounts
  drop constraint if exists client_instagram_accounts_capacity_status_check,
  add constraint client_instagram_accounts_capacity_status_check
    check (capacity_status in ('occupied', 'released_terminal')),
  drop constraint if exists client_instagram_accounts_capacity_metadata_check,
  add constraint client_instagram_accounts_capacity_metadata_check check (
    (capacity_status = 'occupied'
      and capacity_released_at is null
      and capacity_release_reason is null
      and capacity_release_operation_id is null)
    or
    (capacity_status = 'released_terminal'
      and capacity_released_at is not null
      and nullif(btrim(capacity_release_reason), '') is not null
      and capacity_release_operation_id is not null)
  );

create index if not exists client_instagram_accounts_client_capacity_idx
  on public.client_instagram_accounts (client_id, capacity_status)
  where active = true;

create or replace function public.enforce_client_instagram_account_capacity_monotonicity_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.capacity_status = 'released_terminal' then
    if new.capacity_status <> old.capacity_status
      or new.capacity_released_at is distinct from old.capacity_released_at
      or new.capacity_release_reason is distinct from old.capacity_release_reason
      or new.capacity_release_operation_id is distinct from old.capacity_release_operation_id then
      raise exception 'released_terminal_capacity_is_immutable' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists client_instagram_accounts_capacity_monotonicity_v1
  on public.client_instagram_accounts;
create trigger client_instagram_accounts_capacity_monotonicity_v1
before update of capacity_status, capacity_released_at, capacity_release_reason, capacity_release_operation_id
on public.client_instagram_accounts
for each row execute function public.enforce_client_instagram_account_capacity_monotonicity_v1();

create or replace function public.release_client_instagram_account_capacity_v1(
  p_account_id uuid,
  p_operation_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
     and account_id = p_account_id
     and status in ('canceled', 'cancelled', 'incomplete_expired');

  if v_admin_status <> 'cancelled'
    or v_state.commercial_state <> 'cancelled'
    or v_state.last_operation_id is distinct from p_operation_id
    or v_operation.id is null or v_entitlement.id is null or v_subscription.stripe_subscription_id is null then
    return jsonb_build_object('ok', false, 'reason', 'terminal_cancellation_evidence_incomplete');
  end if;

  -- The capacity transition and the lifecycle operation terminalization are one
  -- atomic database handoff. A retry may arrive after either the RPC or the
  -- caller's idempotent completion write, but no committed capacity release can
  -- point at a non-terminal cancellation operation.
  if v_operation.state = 'in_progress' then
    update public.commercial_account_lifecycle_operations
       set state = 'completed',
           updated_at = now()
     where id = v_operation.id and state = 'in_progress';
  end if;

  update public.client_instagram_accounts
     set capacity_status = 'released_terminal',
         capacity_released_at = now(),
         capacity_release_reason = btrim(p_reason),
         capacity_release_operation_id = p_operation_id,
         updated_at = now()
   where id = v_link.id and capacity_status = 'occupied';
  return jsonb_build_object('ok', true, 'status', 'released_terminal');
end;
$$;

revoke all on function public.release_client_instagram_account_capacity_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_client_instagram_account_capacity_v1(uuid, uuid, text)
  to service_role;

-- Conservative backfill: only exact, complete, terminal cancellation chains are released.
with proven as (
  select distinct on (cia.account_id)
    cia.id as link_id,
    op.id as operation_id
  from public.client_instagram_accounts cia
  join public.ig_accounts a on a.id = cia.account_id and a.admin_lifecycle_status = 'cancelled'
  join public.commercial_account_lifecycle_states st on st.account_id = cia.account_id
  join public.commercial_account_lifecycle_operations op
    on op.id = st.last_operation_id and op.account_id = cia.account_id
   and op.operation_type = 'cancel' and op.state = 'completed'
  join public.client_account_entitlements ent
    on ent.id = st.entitlement_id and ent.account_id = cia.account_id
   and ent.client_id = cia.client_id and ent.status = 'entitlement_cancelled'
  join public.commercial_stripe_subscriptions sub
    on sub.stripe_subscription_id = st.stripe_subscription_id
   and sub.client_account_entitlement_id = ent.id and sub.account_id = cia.account_id
   and sub.status in ('canceled', 'cancelled', 'incomplete_expired')
  where cia.active = true and cia.capacity_status = 'occupied'
    and (st.commercial_state = 'cancelled'
      or (st.commercial_state = 'action_required' and st.action_required_reason = 'commercial_subscription_missing'))
  order by cia.account_id, op.updated_at desc
)
update public.commercial_account_lifecycle_states st
set commercial_state = 'cancelled', action_required_reason = null, updated_at = now()
from proven p, public.client_instagram_accounts cia
where cia.id = p.link_id and st.account_id = cia.account_id;

with proven as (
  select cia.id as link_id, st.last_operation_id as operation_id
  from public.client_instagram_accounts cia
  join public.ig_accounts a on a.id = cia.account_id and a.admin_lifecycle_status = 'cancelled'
  join public.commercial_account_lifecycle_states st on st.account_id = cia.account_id and st.commercial_state = 'cancelled'
  join public.commercial_account_lifecycle_operations op on op.id = st.last_operation_id and op.state = 'completed' and op.operation_type = 'cancel'
  join public.client_account_entitlements ent on ent.id = st.entitlement_id and ent.status = 'entitlement_cancelled' and ent.account_id = cia.account_id
  join public.commercial_stripe_subscriptions sub on sub.stripe_subscription_id = st.stripe_subscription_id and sub.client_account_entitlement_id = ent.id and sub.account_id = cia.account_id and sub.status in ('canceled','cancelled','incomplete_expired')
  where cia.active = true and cia.capacity_status = 'occupied'
)
update public.client_instagram_accounts cia
set capacity_status = 'released_terminal', capacity_released_at = now(),
    capacity_release_reason = 'terminal_cancel_backfill_v1', capacity_release_operation_id = p.operation_id,
    updated_at = now()
from proven p where cia.id = p.link_id;

comment on column public.client_instagram_accounts.active is
  'Ownership/history visibility. It is not commercial capacity occupancy.';
comment on column public.client_instagram_accounts.capacity_status is
  'Monotonic commercial capacity projection: occupied or released_terminal.';
