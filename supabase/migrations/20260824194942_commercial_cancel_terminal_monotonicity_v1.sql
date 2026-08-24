-- Commercial cancellation terminal monotonicity V1.
-- Keeps immutable cancellation provenance separate from mutable last-operation telemetry.

alter table public.commercial_account_lifecycle_states
  add column if not exists terminal_cancel_operation_id uuid null
    references public.commercial_account_lifecycle_operations(id) on delete restrict,
  add column if not exists terminal_cancelled_at timestamptz null,
  add column if not exists terminal_cancel_entitlement_id uuid null
    references public.client_account_entitlements(id) on delete restrict,
  add column if not exists terminal_cancel_stripe_subscription_id text null;

alter table public.commercial_account_lifecycle_states
  drop constraint if exists commercial_account_lifecycle_states_terminal_cancel_complete_check,
  add constraint commercial_account_lifecycle_states_terminal_cancel_complete_check check (
    (terminal_cancel_operation_id is null and terminal_cancelled_at is null
      and terminal_cancel_entitlement_id is null and terminal_cancel_stripe_subscription_id is null)
    or
    (terminal_cancel_operation_id is not null and terminal_cancelled_at is not null
      and terminal_cancel_entitlement_id is not null
      and nullif(btrim(terminal_cancel_stripe_subscription_id), '') is not null
      and commercial_state = 'cancelled'
      and action_required_reason is null
      and entitlement_id = terminal_cancel_entitlement_id
      and stripe_subscription_id = terminal_cancel_stripe_subscription_id)
  );

create or replace function public.enforce_commercial_cancel_terminal_monotonicity_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.terminal_cancel_operation_id is not null and (
    new.terminal_cancel_operation_id is distinct from old.terminal_cancel_operation_id
    or new.terminal_cancelled_at is distinct from old.terminal_cancelled_at
    or new.terminal_cancel_entitlement_id is distinct from old.terminal_cancel_entitlement_id
    or new.terminal_cancel_stripe_subscription_id is distinct from old.terminal_cancel_stripe_subscription_id
    or new.commercial_state <> 'cancelled'
    or new.action_required_reason is not null
    or new.entitlement_id is distinct from old.terminal_cancel_entitlement_id
    or new.stripe_subscription_id is distinct from old.terminal_cancel_stripe_subscription_id
  ) then
    raise exception 'terminal_cancel_provenance_is_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists commercial_cancel_terminal_monotonicity_v1
  on public.commercial_account_lifecycle_states;
create trigger commercial_cancel_terminal_monotonicity_v1
before update on public.commercial_account_lifecycle_states
for each row execute function public.enforce_commercial_cancel_terminal_monotonicity_v1();

create or replace function public.enforce_terminal_cancel_admin_monotonicity_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.admin_lifecycle_status = 'cancelled' and new.admin_lifecycle_status <> 'cancelled'
    and exists (
      select 1 from public.commercial_account_lifecycle_states st
      where st.account_id = old.id and st.terminal_cancel_operation_id is not null
    ) then
    raise exception 'terminal_cancelled_account_cannot_reactivate' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists terminal_cancel_admin_monotonicity_v1 on public.ig_accounts;
create trigger terminal_cancel_admin_monotonicity_v1
before update of admin_lifecycle_status on public.ig_accounts
for each row execute function public.enforce_terminal_cancel_admin_monotonicity_v1();

create or replace function public.enforce_terminal_cancel_entitlement_monotonicity_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.account_id is not null and exists (
    select 1 from public.commercial_account_lifecycle_states st
    where st.account_id = new.account_id
      and st.terminal_cancel_operation_id is not null
      and st.terminal_cancel_entitlement_id is distinct from new.id
  ) then
    raise exception 'terminal_cancelled_account_requires_new_account' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'entitlement_cancelled' and new.status <> 'entitlement_cancelled'
      and exists (
      select 1 from public.commercial_account_lifecycle_states st
      where st.terminal_cancel_entitlement_id = old.id
      ) then
      raise exception 'terminal_cancel_entitlement_cannot_reactivate' using errcode = '23514';
    end if;
    if new.account_id is distinct from old.account_id and exists (
      select 1 from public.commercial_account_lifecycle_states st
      where st.terminal_cancel_entitlement_id = old.id
      ) then
      raise exception 'terminal_cancel_entitlement_cannot_rebind' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists terminal_cancel_entitlement_monotonicity_v1
  on public.client_account_entitlements;
create trigger terminal_cancel_entitlement_monotonicity_v1
before insert or update on public.client_account_entitlements
for each row execute function public.enforce_terminal_cancel_entitlement_monotonicity_v1();

create or replace function public.enforce_terminal_cancel_subscription_monotonicity_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.account_id is not null and exists (
    select 1 from public.commercial_account_lifecycle_states st
    where st.account_id = new.account_id
      and st.terminal_cancel_operation_id is not null
      and st.terminal_cancel_stripe_subscription_id is distinct from new.stripe_subscription_id
  ) then
    raise exception 'terminal_cancelled_account_requires_new_account' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.status in ('canceled', 'cancelled', 'incomplete_expired')
      and new.status not in ('canceled', 'cancelled', 'incomplete_expired')
      and exists (
      select 1 from public.commercial_account_lifecycle_states st
      where st.terminal_cancel_stripe_subscription_id = old.stripe_subscription_id
      ) then
      raise exception 'terminal_cancel_subscription_cannot_reactivate' using errcode = '23514';
    end if;
    if (new.account_id is distinct from old.account_id
        or new.client_account_entitlement_id is distinct from old.client_account_entitlement_id)
      and exists (
      select 1 from public.commercial_account_lifecycle_states st
      where st.terminal_cancel_stripe_subscription_id = old.stripe_subscription_id
      ) then
      raise exception 'terminal_cancel_subscription_cannot_rebind' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists terminal_cancel_subscription_monotonicity_v1
  on public.commercial_stripe_subscriptions;
create trigger terminal_cancel_subscription_monotonicity_v1
before insert or update on public.commercial_stripe_subscriptions
for each row execute function public.enforce_terminal_cancel_subscription_monotonicity_v1();

create or replace function public.record_commercial_cancel_terminal_v1(
  p_account_id uuid,
  p_operation_id uuid,
  p_entitlement_id uuid,
  p_stripe_subscription_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_state public.commercial_account_lifecycle_states%rowtype;
  v_operation public.commercial_account_lifecycle_operations%rowtype;
  v_link public.client_instagram_accounts%rowtype;
  v_admin text;
  v_entitlement public.client_account_entitlements%rowtype;
  v_subscription public.commercial_stripe_subscriptions%rowtype;
begin
  if p_account_id is null or p_operation_id is null or p_entitlement_id is null
    or nullif(btrim(p_stripe_subscription_id), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  select * into v_state from public.commercial_account_lifecycle_states
    where account_id = p_account_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'lifecycle_state_missing'); end if;

  if v_state.terminal_cancel_operation_id is not null then
    if v_state.terminal_cancel_operation_id = p_operation_id
      and v_state.terminal_cancel_entitlement_id = p_entitlement_id
      and v_state.terminal_cancel_stripe_subscription_id = p_stripe_subscription_id then
      return jsonb_build_object('ok', true, 'status', 'already_recorded');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'terminal_cancel_provenance_conflict');
  end if;

  select * into v_link from public.client_instagram_accounts
    where account_id = p_account_id and active = true for update;
  select admin_lifecycle_status into v_admin from public.ig_accounts
    where id = p_account_id for update;
  select * into v_operation from public.commercial_account_lifecycle_operations
    where id = p_operation_id and account_id = p_account_id
      and operation_type = 'cancel' and state in ('in_progress', 'completed') for update;
  select * into v_entitlement from public.client_account_entitlements
    where id = p_entitlement_id and account_id = p_account_id
      and client_id = v_link.client_id and status = 'entitlement_cancelled' for update;
  select * into v_subscription from public.commercial_stripe_subscriptions
    where stripe_subscription_id = p_stripe_subscription_id
      and client_account_entitlement_id = p_entitlement_id and account_id = p_account_id
      and status in ('canceled', 'cancelled', 'incomplete_expired') for update;

  if v_link.id is null or v_admin <> 'cancelled' or v_operation.id is null
    or v_entitlement.id is null or v_subscription.stripe_subscription_id is null
    or v_state.commercial_state <> 'cancelled'
    or v_state.entitlement_id is distinct from p_entitlement_id
    or v_state.stripe_subscription_id is distinct from p_stripe_subscription_id then
    return jsonb_build_object('ok', false, 'reason', 'terminal_cancellation_evidence_incomplete');
  end if;

  if v_operation.state = 'in_progress' then
    update public.commercial_account_lifecycle_operations
      set state = 'completed', updated_at = now() where id = p_operation_id;
    v_operation.updated_at := now();
  end if;
  update public.commercial_account_lifecycle_states set
    terminal_cancel_operation_id = p_operation_id,
    terminal_cancelled_at = coalesce(v_operation.updated_at, now()),
    terminal_cancel_entitlement_id = p_entitlement_id,
    terminal_cancel_stripe_subscription_id = p_stripe_subscription_id,
    updated_at = now()
  where account_id = p_account_id;
  return jsonb_build_object('ok', true, 'status', 'recorded');
end;
$$;

revoke all on function public.record_commercial_cancel_terminal_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_commercial_cancel_terminal_v1(uuid, uuid, uuid, text)
  to service_role;

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
  v_admin text;
begin
  if p_account_id is null or p_operation_id is null or nullif(btrim(p_reason), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;
  select * into v_link from public.client_instagram_accounts
    where account_id = p_account_id and active = true for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'active_client_account_link_missing'); end if;
  if v_link.capacity_status = 'released_terminal' then
    if v_link.capacity_release_operation_id = p_operation_id then
      return jsonb_build_object('ok', true, 'status', 'already_released_terminal');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'capacity_release_provenance_conflict');
  end if;
  select * into v_state from public.commercial_account_lifecycle_states
    where account_id = p_account_id for update;
  select admin_lifecycle_status into v_admin from public.ig_accounts where id = p_account_id;
  select * into v_operation from public.commercial_account_lifecycle_operations
    where id = p_operation_id and account_id = p_account_id
      and operation_type = 'cancel' and state = 'completed';
  select * into v_entitlement from public.client_account_entitlements
    where id = v_state.terminal_cancel_entitlement_id and account_id = p_account_id
      and client_id = v_link.client_id and status = 'entitlement_cancelled';
  select * into v_subscription from public.commercial_stripe_subscriptions
    where stripe_subscription_id = v_state.terminal_cancel_stripe_subscription_id
      and client_account_entitlement_id = v_state.terminal_cancel_entitlement_id
      and account_id = p_account_id and status in ('canceled','cancelled','incomplete_expired');
  if v_admin <> 'cancelled' or v_state.commercial_state <> 'cancelled'
    or v_state.terminal_cancel_operation_id is distinct from p_operation_id
    or v_operation.id is null or v_entitlement.id is null or v_subscription.stripe_subscription_id is null then
    return jsonb_build_object('ok', false, 'reason', 'terminal_cancellation_evidence_incomplete');
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

-- Conservative historical reconciliation: select a completed cancel chain, never last_operation_id.
with proven as (
  select distinct on (st.account_id)
    st.account_id, op.id operation_id, op.updated_at cancelled_at,
    st.entitlement_id, st.stripe_subscription_id
  from public.commercial_account_lifecycle_states st
  join public.ig_accounts a on a.id = st.account_id and a.admin_lifecycle_status = 'cancelled'
  join public.client_instagram_accounts cia on cia.account_id = st.account_id and cia.active = true
  join public.commercial_account_lifecycle_operations op
    on op.account_id = st.account_id and op.entitlement_id = st.entitlement_id
    and op.operation_type = 'cancel' and op.state = 'completed'
  join public.client_account_entitlements ent
    on ent.id = st.entitlement_id and ent.account_id = st.account_id
    and ent.client_id = cia.client_id and ent.status = 'entitlement_cancelled'
  join public.commercial_stripe_subscriptions sub
    on sub.stripe_subscription_id = st.stripe_subscription_id
    and sub.client_account_entitlement_id = ent.id and sub.account_id = st.account_id
    and sub.status in ('canceled','cancelled','incomplete_expired')
  where st.terminal_cancel_operation_id is null
    and st.commercial_state in ('cancelled','action_required')
  order by st.account_id, op.updated_at asc, op.id
)
update public.commercial_account_lifecycle_states st set
  commercial_state = 'cancelled', action_required_reason = null,
  terminal_cancel_operation_id = p.operation_id, terminal_cancelled_at = p.cancelled_at,
  terminal_cancel_entitlement_id = p.entitlement_id,
  terminal_cancel_stripe_subscription_id = p.stripe_subscription_id,
  updated_at = now()
from proven p where st.account_id = p.account_id;

with proven as (
  select st.account_id, st.terminal_cancel_operation_id operation_id
  from public.commercial_account_lifecycle_states st
  where st.terminal_cancel_operation_id is not null
)
update public.client_instagram_accounts cia set
  capacity_status = 'released_terminal', capacity_released_at = now(),
  capacity_release_reason = 'terminal_cancel_backfill_v1_1',
  capacity_release_operation_id = p.operation_id, updated_at = now()
from proven p where cia.account_id = p.account_id and cia.active = true
  and cia.capacity_status = 'occupied';

comment on column public.commercial_account_lifecycle_states.terminal_cancel_operation_id is
  'Immutable successful terminal cancellation operation; independent from mutable last_operation_id.';
