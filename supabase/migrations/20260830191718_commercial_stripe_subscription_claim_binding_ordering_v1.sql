-- Commercial Stripe Test subscription claim/binding ordering v1.
--
-- A subscription webhook can legitimately project a paid test subscription
-- before checkout.session.completed has created the replacement entitlement.
-- Only that exact, still-unbound projection may be claimed. A non-null foreign
-- account remains a hard conflict. Claim + entitlement replacement are one
-- PostgreSQL transaction and therefore cannot partially commit.

create or replace function private.enforce_stripe_subscription_account_binding_v1()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if old.account_id is not null
     and new.account_id is distinct from old.account_id then
    raise exception 'stripe_subscription_cross_account_conflict';
  end if;
  return new;
end;
$$;

drop trigger if exists commercial_stripe_subscription_account_binding_v1
  on public.commercial_stripe_subscriptions;
create trigger commercial_stripe_subscription_account_binding_v1
before update of account_id on public.commercial_stripe_subscriptions
for each row execute function private.enforce_stripe_subscription_account_binding_v1();

create or replace function private.reconcile_simulated_to_stripe_test_v2(
  p_checkout_attempt_id uuid,
  p_client_id uuid,
  p_account_id uuid,
  p_source_entitlement_id uuid,
  p_replacement_entitlement_id uuid,
  p_authorization_id uuid,
  p_stripe_subscription_id text,
  p_stripe_customer_id text,
  p_stripe_price_id text,
  p_stripe_checkout_session_id text,
  p_stripe_event_id text,
  p_stripe_livemode boolean,
  p_stripe_metadata_client_id text,
  p_stripe_metadata_target_account_id text,
  p_stripe_metadata_source_entitlement_id text,
  p_stripe_metadata_migration_kind text,
  p_stripe_metadata_commercial_test_mode text,
  p_stripe_metadata_authorization_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_attempt public.commercial_stripe_checkout_attempts%rowtype;
  v_source public.client_account_entitlements%rowtype;
  v_replacement public.client_account_entitlements%rowtype;
  v_authorization public.commercial_stripe_migration_authorizations%rowtype;
  v_existing public.commercial_stripe_entitlement_migrations%rowtype;
  v_subscription public.commercial_stripe_subscriptions%rowtype;
  v_active_package public.account_commercial_packages%rowtype;
  v_migration_id uuid;
  v_subscription_rows integer;
  v_active_entitlements integer;
  v_active_packages integer;
begin
  if p_checkout_attempt_id is null
     or coalesce(trim(p_stripe_subscription_id), '') = ''
     or coalesce(trim(p_stripe_customer_id), '') = ''
     or coalesce(trim(p_stripe_price_id), '') = ''
     or coalesce(trim(p_stripe_checkout_session_id), '') = ''
     or coalesce(trim(p_stripe_event_id), '') = '' then
    raise exception 'stripe_lineage_required';
  end if;

  -- Values below come from the Subscription object freshly retrieved from
  -- Stripe by the signed-webhook fulfillment path. They are repeated inside
  -- the database transaction so a caller cannot claim by checkout lineage only.
  if p_stripe_livemode is distinct from false
     or coalesce(trim(p_stripe_metadata_client_id), '') <> p_client_id::text
     or coalesce(trim(p_stripe_metadata_target_account_id), '') <> p_account_id::text
     or coalesce(trim(p_stripe_metadata_source_entitlement_id), '') <> p_source_entitlement_id::text
     or coalesce(trim(p_stripe_metadata_migration_kind), '') <> 'simulated_to_stripe_test'
     or coalesce(trim(p_stripe_metadata_commercial_test_mode), '') <> 'stripe_test'
     or coalesce(trim(p_stripe_metadata_authorization_id), '') <> p_authorization_id::text then
    raise exception 'stripe_subscription_metadata_mismatch';
  end if;

  perform 1 from public.ig_accounts where id = p_account_id for update;
  if not found then raise exception 'account_not_found'; end if;

  if not exists (
    select 1 from public.client_instagram_accounts
    where client_id = p_client_id and account_id = p_account_id
  ) then
    raise exception 'account_client_mismatch';
  end if;

  select * into v_attempt
  from public.commercial_stripe_checkout_attempts
  where id = p_checkout_attempt_id
  for update;
  if not found
     or v_attempt.client_id is distinct from p_client_id
     or v_attempt.account_id is distinct from p_account_id
     or v_attempt.stripe_checkout_session_id is distinct from p_stripe_checkout_session_id
     or v_attempt.stripe_subscription_id is distinct from p_stripe_subscription_id
     or v_attempt.checkout_mode is distinct from 'subscription'
     or v_attempt.commercial_test_mode is distinct from 'stripe_test'
     or coalesce(v_attempt.metadata_safe->>'source_entitlement_id', '') <> p_source_entitlement_id::text
     or coalesce(v_attempt.metadata_safe->>'commercial_migration_kind', '') <> 'simulated_to_stripe_test'
     or coalesce(v_attempt.metadata_safe->>'commercial_migration_authorization_id', '') <> p_authorization_id::text then
    raise exception 'checkout_attempt_lineage_mismatch';
  end if;

  select count(*) into v_subscription_rows
  from public.commercial_stripe_subscriptions
  where stripe_subscription_id = p_stripe_subscription_id;

  -- checkout.session.completed may itself be the first relevant event. Seed the
  -- same unbound projection shape transactionally; a concurrent subscription
  -- webhook wins through the unique Stripe subscription identity.
  if v_subscription_rows = 0 then
    insert into public.commercial_stripe_subscriptions (
      client_id, stripe_subscription_id, stripe_customer_id, stripe_price_id,
      status, livemode, account_id, metadata_safe
    ) values (
      p_client_id, p_stripe_subscription_id, p_stripe_customer_id, p_stripe_price_id,
      'active', false, null,
      jsonb_build_object('projection_basis', 'checkout_reconciliation_first')
    )
    on conflict (stripe_subscription_id) do nothing;
  end if;

  select count(*) into v_subscription_rows
  from public.commercial_stripe_subscriptions
  where stripe_subscription_id = p_stripe_subscription_id;
  if v_subscription_rows <> 1 then
    raise exception 'stripe_subscription_projection_cardinality_invalid';
  end if;

  select * into v_subscription
  from public.commercial_stripe_subscriptions
  where stripe_subscription_id = p_stripe_subscription_id
  for update;

  if v_subscription.client_id is distinct from p_client_id
     or v_subscription.stripe_customer_id is distinct from p_stripe_customer_id
     or v_subscription.stripe_price_id is distinct from p_stripe_price_id
     or v_subscription.livemode is distinct from false then
    raise exception 'stripe_subscription_projection_lineage_mismatch';
  end if;

  -- A real non-null foreign owner is never claimable. NULL is only a temporary
  -- webhook ordering state and remains subject to every proof above and below.
  if v_subscription.account_id is not null
     and v_subscription.account_id <> p_account_id then
    raise exception 'stripe_subscription_cross_account_conflict';
  end if;

  if v_subscription.client_account_entitlement_id is not null
     and v_subscription.client_account_entitlement_id <> p_replacement_entitlement_id then
    raise exception 'stripe_subscription_entitlement_conflict';
  end if;
  if v_subscription.commercial_checkout_session_id is not null
     and v_subscription.commercial_checkout_session_id <> v_attempt.commercial_checkout_session_id then
    raise exception 'stripe_subscription_checkout_conflict';
  end if;
  if coalesce(v_subscription.metadata_safe->>'target_account_id', p_account_id::text) <> p_account_id::text
     or coalesce(v_subscription.metadata_safe->>'source_entitlement_id', p_source_entitlement_id::text) <> p_source_entitlement_id::text
     or coalesce(v_subscription.metadata_safe->>'commercial_migration_kind', 'simulated_to_stripe_test') <> 'simulated_to_stripe_test' then
    raise exception 'stripe_subscription_projection_metadata_conflict';
  end if;

  select * into v_existing
  from public.commercial_stripe_entitlement_migrations
  where source_entitlement_id = p_source_entitlement_id
  for update;
  if found then
    if v_existing.state = 'completed'
       and v_existing.client_id = p_client_id
       and v_existing.account_id = p_account_id
       and v_existing.replacement_entitlement_id = p_replacement_entitlement_id
       and v_existing.stripe_subscription_id = p_stripe_subscription_id
       and v_subscription.account_id = p_account_id then
      return jsonb_build_object(
        'ok', true,
        'idempotent_replay', true,
        'migration_id', v_existing.id
      );
    end if;
    raise exception 'commercial_migration_conflict';
  end if;

  select * into v_authorization
  from public.commercial_stripe_migration_authorizations
  where id = p_authorization_id
  for update;
  if not found
     or v_authorization.client_id <> p_client_id
     or v_authorization.account_id <> p_account_id
     or v_authorization.source_entitlement_id <> p_source_entitlement_id
     or v_authorization.migration_kind <> 'simulated_to_stripe_test'
     or v_authorization.commercial_test_mode <> 'stripe_test'
     or v_authorization.status <> 'authorized'
     or v_attempt.payment_confirmed_at is null
     or v_attempt.payment_confirmed_at > v_authorization.expires_at
     or v_attempt.created_at > v_authorization.expires_at then
    raise exception 'commercial_migration_authorization_invalid';
  end if;

  select * into v_source
  from public.client_account_entitlements
  where id = p_source_entitlement_id
  for update;
  if not found
     or v_source.client_id <> p_client_id
     or v_source.account_id <> p_account_id
     or v_source.status <> 'entitlement_consumed'
     or coalesce(v_source.metadata->>'checkout_mode', '') <> 'simulated'
     or coalesce(v_source.metadata->>'billing_excluded', '') <> 'true' then
    raise exception 'simulated_source_entitlement_ineligible';
  end if;

  select * into v_replacement
  from public.client_account_entitlements
  where id = p_replacement_entitlement_id
  for update;
  if not found
     or v_replacement.client_id <> p_client_id
     or v_replacement.status not in ('entitlement_reserved', 'entitlement_consumed')
     or (v_replacement.account_id is not null and v_replacement.account_id <> p_account_id)
     or coalesce(v_replacement.metadata->>'checkout_mode', '') <> 'stripe'
     or v_replacement.checkout_session_id is distinct from v_attempt.commercial_checkout_session_id then
    raise exception 'stripe_replacement_entitlement_ineligible';
  end if;

  if v_replacement.plan_key is distinct from v_source.plan_key
     or v_replacement.commercial_package_code is distinct from v_source.commercial_package_code then
    raise exception 'replacement_package_mismatch';
  end if;

  select * into v_active_package
  from public.account_commercial_packages
  where account_id = p_account_id and status = 'active' and ends_at is null
  order by starts_at desc
  limit 1
  for update;
  if not found or v_active_package.package_code <> v_source.commercial_package_code then
    raise exception 'active_package_mismatch';
  end if;

  if exists (
    select 1 from public.client_account_entitlements
    where client_id = p_client_id
      and account_id = p_account_id
      and status = 'entitlement_consumed'
      and id <> p_source_entitlement_id
  ) then
    raise exception 'duplicate_active_entitlement';
  end if;

  if exists (
    select 1 from public.commercial_stripe_subscriptions
    where client_id = p_client_id
      and account_id = p_account_id
      and stripe_subscription_id <> p_stripe_subscription_id
      and status not in ('canceled', 'cancelled', 'incomplete_expired', 'unpaid')
  ) then
    raise exception 'duplicate_active_stripe_subscription';
  end if;

  -- This is the claim. It is intentionally inside the same transaction as the
  -- entitlement switch below; any later exception rolls it back.
  if v_subscription.account_id is null then
    update public.commercial_stripe_subscriptions
    set account_id = p_account_id,
        client_account_entitlement_id = p_replacement_entitlement_id,
        commercial_checkout_session_id = v_replacement.checkout_session_id,
        commercial_mode = 'full_cycle',
        pricing_mode = 'public_catalog',
        metadata_safe = coalesce(metadata_safe, '{}'::jsonb) || jsonb_build_object(
          'claim_basis', 'signed_stripe_subscription_metadata',
          'target_account_id', p_account_id,
          'source_entitlement_id', p_source_entitlement_id,
          'commercial_migration_kind', 'simulated_to_stripe_test',
          'stripe_checkout_session_id', p_stripe_checkout_session_id,
          'stripe_event_id', p_stripe_event_id
        ),
        updated_at = v_now
    where id = v_subscription.id and account_id is null;
    if not found then raise exception 'stripe_subscription_claim_lost'; end if;
  end if;

  update public.client_account_entitlements
  set status = 'entitlement_consumed',
      account_id = p_account_id,
      consumed_at = coalesce(consumed_at, v_now),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'checkout_mode', 'stripe',
        'billing_excluded', false,
        'commercial_migration_kind', 'simulated_to_stripe_test',
        'source_entitlement_id', p_source_entitlement_id,
        'stripe_subscription_id', p_stripe_subscription_id
      ),
      updated_at = v_now
  where id = p_replacement_entitlement_id;

  update public.client_account_entitlements
  set status = 'entitlement_cancelled',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'superseded_by_entitlement_id', p_replacement_entitlement_id,
        'superseded_by_stripe_subscription_id', p_stripe_subscription_id,
        'superseded_reason', 'simulated_to_stripe_test',
        'superseded_at', v_now
      ),
      updated_at = v_now
  where id = p_source_entitlement_id;

  update public.commercial_stripe_subscriptions
  set stripe_customer_id = p_stripe_customer_id,
      stripe_price_id = p_stripe_price_id,
      status = 'active',
      client_account_entitlement_id = p_replacement_entitlement_id,
      account_id = p_account_id,
      commercial_checkout_session_id = v_replacement.checkout_session_id,
      commercial_mode = 'full_cycle',
      pricing_mode = 'public_catalog',
      updated_at = v_now,
      metadata_safe = coalesce(metadata_safe, '{}'::jsonb) || jsonb_build_object(
        'commercial_migration_kind', 'simulated_to_stripe_test',
        'source_entitlement_id', p_source_entitlement_id,
        'stripe_checkout_session_id', p_stripe_checkout_session_id,
        'stripe_event_id', p_stripe_event_id
      )
  where id = v_subscription.id;

  insert into public.commercial_stripe_entitlement_migrations (
    client_id, account_id, source_entitlement_id, replacement_entitlement_id,
    authorization_id, migration_kind, state, package_code,
    stripe_subscription_id, stripe_customer_id, stripe_price_id,
    stripe_checkout_session_id, stripe_event_id, completed_at, metadata_safe
  ) values (
    p_client_id, p_account_id, p_source_entitlement_id, p_replacement_entitlement_id,
    p_authorization_id, 'simulated_to_stripe_test', 'completed', v_source.commercial_package_code,
    p_stripe_subscription_id, p_stripe_customer_id, p_stripe_price_id,
    p_stripe_checkout_session_id, p_stripe_event_id, v_now,
    jsonb_build_object(
      'source_history_preserved', true,
      'local_switch_atomic', true,
      'unbound_projection_claimed', v_subscription.account_id is null
    )
  ) returning id into v_migration_id;

  update public.commercial_stripe_migration_authorizations
  set status = 'consumed', consumed_at = v_now, updated_at = v_now
  where id = p_authorization_id;

  select count(*) into v_active_entitlements
  from public.client_account_entitlements
  where client_id = p_client_id and account_id = p_account_id
    and status = 'entitlement_consumed';
  select count(*) into v_active_packages
  from public.account_commercial_packages
  where account_id = p_account_id and status = 'active' and ends_at is null;
  if v_active_entitlements <> 1 or v_active_packages <> 1 then
    raise exception 'post_reconciliation_cardinality_violation';
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'migration_id', v_migration_id,
    'unbound_projection_claimed', v_subscription.account_id is null,
    'active_entitlements', v_active_entitlements,
    'active_commercial_packages', v_active_packages
  );
end;
$$;

create or replace function public.reconcile_simulated_to_stripe_test_v2(
  p_checkout_attempt_id uuid,
  p_client_id uuid,
  p_account_id uuid,
  p_source_entitlement_id uuid,
  p_replacement_entitlement_id uuid,
  p_authorization_id uuid,
  p_stripe_subscription_id text,
  p_stripe_customer_id text,
  p_stripe_price_id text,
  p_stripe_checkout_session_id text,
  p_stripe_event_id text,
  p_stripe_livemode boolean,
  p_stripe_metadata_client_id text,
  p_stripe_metadata_target_account_id text,
  p_stripe_metadata_source_entitlement_id text,
  p_stripe_metadata_migration_kind text,
  p_stripe_metadata_commercial_test_mode text,
  p_stripe_metadata_authorization_id text
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.reconcile_simulated_to_stripe_test_v2(
    p_checkout_attempt_id,
    p_client_id,
    p_account_id,
    p_source_entitlement_id,
    p_replacement_entitlement_id,
    p_authorization_id,
    p_stripe_subscription_id,
    p_stripe_customer_id,
    p_stripe_price_id,
    p_stripe_checkout_session_id,
    p_stripe_event_id,
    p_stripe_livemode,
    p_stripe_metadata_client_id,
    p_stripe_metadata_target_account_id,
    p_stripe_metadata_source_entitlement_id,
    p_stripe_metadata_migration_kind,
    p_stripe_metadata_commercial_test_mode,
    p_stripe_metadata_authorization_id
  );
$$;

revoke all on function private.reconcile_simulated_to_stripe_test_v2(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.reconcile_simulated_to_stripe_test_v2(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, text, text, text, text, text
) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.reconcile_simulated_to_stripe_test_v2(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, text, text, text, text, text
) to service_role;
grant execute on function public.reconcile_simulated_to_stripe_test_v2(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, text, text, text, text, text
) to service_role;

comment on function private.reconcile_simulated_to_stripe_test_v2(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, boolean,
  text, text, text, text, text, text
) is 'Atomically claims one exact unbound Stripe Test subscription projection and replaces one authorized simulated entitlement; non-null foreign accounts remain fail-closed.';
