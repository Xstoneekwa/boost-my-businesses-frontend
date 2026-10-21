-- Commercial Stripe Test E2E V1.
-- Candidate-only migration. Do not apply before the signed deployment gate.

create schema if not exists private;

alter table public.commercial_checkout_sessions
  add column if not exists commercial_test_mode text null;

alter table public.commercial_checkout_sessions
  drop constraint if exists commercial_checkout_sessions_commercial_test_mode_check;
alter table public.commercial_checkout_sessions
  add constraint commercial_checkout_sessions_commercial_test_mode_check
  check (commercial_test_mode is null or commercial_test_mode in ('simulated', 'stripe_test'));

alter table public.commercial_stripe_checkout_attempts
  add column if not exists commercial_test_mode text null;

alter table public.commercial_stripe_checkout_attempts
  drop constraint if exists commercial_stripe_checkout_attempts_test_mode_check;
alter table public.commercial_stripe_checkout_attempts
  add constraint commercial_stripe_checkout_attempts_test_mode_check
  check (commercial_test_mode is null or commercial_test_mode in ('simulated', 'stripe_test'));

create table if not exists public.commercial_stripe_migration_authorizations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  source_entitlement_id uuid not null references public.client_account_entitlements(id) on delete restrict,
  migration_kind text not null check (migration_kind = 'simulated_to_stripe_test'),
  commercial_test_mode text not null check (commercial_test_mode = 'stripe_test'),
  status text not null default 'authorized'
    check (status in ('authorized', 'consumed', 'revoked', 'expired')),
  authorized_by uuid not null,
  reason text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commercial_stripe_migration_authorizations_one_live_source_idx
  on public.commercial_stripe_migration_authorizations(source_entitlement_id)
  where status = 'authorized';

create table if not exists public.commercial_stripe_entitlement_migrations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.ig_accounts(id) on delete restrict,
  source_entitlement_id uuid not null references public.client_account_entitlements(id) on delete restrict,
  replacement_entitlement_id uuid not null references public.client_account_entitlements(id) on delete restrict,
  authorization_id uuid not null references public.commercial_stripe_migration_authorizations(id) on delete restrict,
  migration_kind text not null check (migration_kind = 'simulated_to_stripe_test'),
  state text not null check (state in ('completed', 'reconciliation_required')),
  package_code text not null check (package_code in ('growth', 'pro', 'premium')),
  stripe_subscription_id text not null,
  stripe_customer_id text not null,
  stripe_price_id text not null,
  stripe_checkout_session_id text not null,
  stripe_event_id text not null,
  metadata_safe jsonb not null default '{}'::jsonb,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_entitlement_id),
  unique(replacement_entitlement_id),
  unique(stripe_subscription_id),
  unique(stripe_event_id)
);

alter table public.commercial_stripe_migration_authorizations enable row level security;
alter table public.commercial_stripe_entitlement_migrations enable row level security;

revoke all on table public.commercial_stripe_migration_authorizations from public, anon, authenticated;
revoke all on table public.commercial_stripe_entitlement_migrations from public, anon, authenticated;
grant select, insert, update on table public.commercial_stripe_migration_authorizations to service_role;
grant select, insert, update on table public.commercial_stripe_entitlement_migrations to service_role;

alter table public.account_warmup_settings
  add column if not exists warmup_started_at timestamptz null;

update public.account_warmup_settings
set warmup_started_at = package_started_at
where warmup_started_at is null
  and package_started_at is not null;

comment on column public.account_warmup_settings.warmup_started_at is
  'Immutable account warmup lifecycle anchor. Warmup day remains derived from prior distinct SAST follow_verified dates.';

create or replace function private.preserve_warmup_started_at_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.warmup_started_at := coalesce(new.warmup_started_at, new.package_started_at);
    if new.package_started_at is null then
      new.package_started_at := new.warmup_started_at;
    end if;
    return new;
  end if;

  if old.warmup_started_at is not null
     and new.warmup_started_at is distinct from old.warmup_started_at then
    raise exception using
      errcode = '23514',
      message = 'warmup_started_at_is_immutable';
  end if;
  new.warmup_started_at := coalesce(old.warmup_started_at, new.warmup_started_at, old.package_started_at, new.package_started_at);
  return new;
end;
$$;

drop trigger if exists account_warmup_started_at_immutable_v1 on public.account_warmup_settings;
create trigger account_warmup_started_at_immutable_v1
before insert or update on public.account_warmup_settings
for each row execute function private.preserve_warmup_started_at_v1();

revoke all on function private.preserve_warmup_started_at_v1() from public, anon, authenticated;

create or replace function private.reconcile_simulated_to_stripe_test_v1(
  p_client_id uuid,
  p_account_id uuid,
  p_source_entitlement_id uuid,
  p_replacement_entitlement_id uuid,
  p_authorization_id uuid,
  p_stripe_subscription_id text,
  p_stripe_customer_id text,
  p_stripe_price_id text,
  p_stripe_checkout_session_id text,
  p_stripe_event_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_source public.client_account_entitlements%rowtype;
  v_replacement public.client_account_entitlements%rowtype;
  v_authorization public.commercial_stripe_migration_authorizations%rowtype;
  v_existing public.commercial_stripe_entitlement_migrations%rowtype;
  v_active_package public.account_commercial_packages%rowtype;
  v_migration_id uuid;
  v_active_entitlements integer;
  v_active_packages integer;
begin
  if coalesce(trim(p_stripe_subscription_id), '') = ''
     or coalesce(trim(p_stripe_customer_id), '') = ''
     or coalesce(trim(p_stripe_price_id), '') = ''
     or coalesce(trim(p_stripe_checkout_session_id), '') = ''
     or coalesce(trim(p_stripe_event_id), '') = '' then
    raise exception 'stripe_lineage_required';
  end if;

  perform 1 from public.ig_accounts where id = p_account_id for update;
  if not found then raise exception 'account_not_found'; end if;

  if not exists (
    select 1 from public.client_instagram_accounts
    where client_id = p_client_id and account_id = p_account_id
  ) then
    raise exception 'account_client_mismatch';
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
       and v_existing.stripe_subscription_id = p_stripe_subscription_id then
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
     or v_authorization.expires_at <= v_now then
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
     or coalesce(v_replacement.metadata->>'checkout_mode', '') <> 'stripe' then
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

  if exists (
    select 1 from public.commercial_stripe_subscriptions
    where stripe_subscription_id = p_stripe_subscription_id
      and (client_id <> p_client_id or account_id is distinct from p_account_id)
  ) then
    raise exception 'stripe_subscription_cross_account_conflict';
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

  insert into public.commercial_stripe_subscriptions (
    client_id, stripe_subscription_id, stripe_customer_id, stripe_price_id,
    status, livemode, client_account_entitlement_id, account_id,
    commercial_checkout_session_id, commercial_mode, pricing_mode, metadata_safe
  ) values (
    p_client_id, p_stripe_subscription_id, p_stripe_customer_id, p_stripe_price_id,
    'active', false, p_replacement_entitlement_id, p_account_id,
    v_replacement.checkout_session_id, 'full_cycle', 'public_catalog',
    jsonb_build_object(
      'commercial_migration_kind', 'simulated_to_stripe_test',
      'source_entitlement_id', p_source_entitlement_id,
      'stripe_checkout_session_id', p_stripe_checkout_session_id,
      'stripe_event_id', p_stripe_event_id
    )
  )
  on conflict (stripe_subscription_id) do update set
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_price_id = excluded.stripe_price_id,
    status = excluded.status,
    client_account_entitlement_id = excluded.client_account_entitlement_id,
    account_id = excluded.account_id,
    commercial_checkout_session_id = excluded.commercial_checkout_session_id,
    updated_at = v_now,
    metadata_safe = coalesce(public.commercial_stripe_subscriptions.metadata_safe, '{}'::jsonb)
      || excluded.metadata_safe;

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
    jsonb_build_object('source_history_preserved', true, 'local_switch_atomic', true)
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
    'active_entitlements', v_active_entitlements,
    'active_commercial_packages', v_active_packages
  );
end;
$$;

create or replace function public.reconcile_simulated_to_stripe_test_v1(
  p_client_id uuid,
  p_account_id uuid,
  p_source_entitlement_id uuid,
  p_replacement_entitlement_id uuid,
  p_authorization_id uuid,
  p_stripe_subscription_id text,
  p_stripe_customer_id text,
  p_stripe_price_id text,
  p_stripe_checkout_session_id text,
  p_stripe_event_id text
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.reconcile_simulated_to_stripe_test_v1(
    p_client_id,
    p_account_id,
    p_source_entitlement_id,
    p_replacement_entitlement_id,
    p_authorization_id,
    p_stripe_subscription_id,
    p_stripe_customer_id,
    p_stripe_price_id,
    p_stripe_checkout_session_id,
    p_stripe_event_id
  );
$$;

revoke all on function private.reconcile_simulated_to_stripe_test_v1(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.reconcile_simulated_to_stripe_test_v1(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.reconcile_simulated_to_stripe_test_v1(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text
) to service_role;
grant execute on function public.reconcile_simulated_to_stripe_test_v1(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text
) to service_role;
