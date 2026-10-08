-- Notification Router V2. Durable business events are committed before any
-- provider call. All tables and RPCs are service-role only.

begin;

create table if not exists public.notification_destination_settings (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('incident','new_client','plan_change','auto_login','ct_lifecycle')),
  environment text not null check (environment in ('test','live')),
  channel text not null check (channel in ('slack','discord')),
  enabled boolean not null default false,
  webhook_ciphertext text,
  webhook_key_version text,
  destination_label text,
  external_destination_hint text,
  configured_at timestamptz,
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_test_at timestamptz,
  last_error_at timestamptz,
  last_error_summary text,
  retry_state jsonb not null default '{}'::jsonb check (jsonb_typeof(retry_state) = 'object'),
  constraint notification_destination_settings_unique unique (category, environment, channel),
  constraint notification_destination_cipher_contract check (
    (webhook_ciphertext is null and webhook_key_version is null)
    or (webhook_ciphertext is not null and webhook_key_version is not null)
  )
);

create table if not exists public.notification_business_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(trim(idempotency_key)) > 0),
  category text not null check (category in ('incident','new_client','plan_change','auto_login','ct_lifecycle')),
  environment text not null check (environment in ('test','live')),
  event_type text not null check (length(trim(event_type)) > 0),
  account_id uuid,
  client_id uuid,
  tenant_id uuid,
  business_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(business_payload) = 'object'),
  technical_diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(technical_diagnostics) = 'object'),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_business_events(id) on delete restrict,
  destination_id uuid not null references public.notification_destination_settings(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','processing','retry','sent','skipped','dead_letter')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 4),
  next_retry_at timestamptz,
  claimed_at timestamptz,
  claim_owner text,
  sent_at timestamptz,
  last_error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_event_destination_unique unique (event_id, destination_id)
);

create table if not exists public.notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.notification_deliveries(id) on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 4),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  status text not null check (status in ('sent','failed')),
  http_status integer,
  error_summary text,
  created_at timestamptz not null default now(),
  constraint notification_delivery_attempts_unique unique (delivery_id, attempt_number)
);

create index if not exists notification_deliveries_claimable_idx
  on public.notification_deliveries (next_retry_at, created_at)
  where status in ('pending','retry');
create index if not exists notification_deliveries_stale_claim_idx
  on public.notification_deliveries (claimed_at)
  where status = 'processing';
create index if not exists notification_deliveries_destination_history_idx
  on public.notification_deliveries (destination_id, created_at desc);
create index if not exists notification_business_events_category_created_idx
  on public.notification_business_events (category, environment, created_at desc);

create or replace function public.notification_business_events_immutable_v2()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'notification_business_event_immutable' using errcode = '55000';
end;
$$;

drop trigger if exists notification_business_events_immutable_v2 on public.notification_business_events;
create trigger notification_business_events_immutable_v2
before update or delete on public.notification_business_events
for each row execute function public.notification_business_events_immutable_v2();

-- Seed every category/environment/channel combination. Unconfigured and
-- disabled are healthy states.
insert into public.notification_destination_settings (category, environment, channel)
select category, environment, channel
from unnest(array['incident','new_client','plan_change','auto_login','ct_lifecycle']) category
cross join unnest(array['test','live']) environment
cross join unnest(array['slack','discord']) channel
on conflict (category, environment, channel) do nothing;

-- Transactional V1 compatibility migration. Ciphertext is preserved byte for
-- byte and tagged with its legacy dedicated-key version for lazy rotation.
insert into public.notification_destination_settings (
  category, environment, channel, enabled, webhook_ciphertext,
  webhook_key_version, configured_at, updated_at, last_success_at, last_test_at,
  last_error_at, last_error_summary, retry_state
)
select
  'incident', 'live', legacy.channel, legacy.enabled,
  legacy.webhook_ciphertext,
  case when legacy.webhook_ciphertext is null then null else 'incident_v1' end,
  case when legacy.configured then coalesce(legacy.updated_at, now()) else null end,
  coalesce(legacy.updated_at, now()), legacy.last_success_at, legacy.last_test_at,
  legacy.last_failure_at, legacy.last_error_redacted,
  jsonb_build_object(
    'legacy_attempt_count', coalesce(legacy.attempt_count, 0),
    'legacy_next_retry_at', legacy.next_retry_at
  )
from public.incident_notification_channel_settings legacy
where legacy.channel in ('slack','discord')
on conflict (category, environment, channel) do update set
  enabled = excluded.enabled,
  webhook_ciphertext = excluded.webhook_ciphertext,
  webhook_key_version = excluded.webhook_key_version,
  configured_at = excluded.configured_at,
  updated_at = excluded.updated_at,
  last_success_at = excluded.last_success_at,
  last_test_at = excluded.last_test_at,
  last_error_at = excluded.last_error_at,
  last_error_summary = excluded.last_error_summary,
  retry_state = excluded.retry_state;

create or replace function public.notification_router_materialize_deliveries_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_deliveries (event_id, destination_id, status, next_retry_at)
  select new.id, destination.id, 'pending', now()
  from public.notification_destination_settings destination
  where destination.category = new.category
    and destination.environment = new.environment
    and destination.enabled = true
    and destination.webhook_ciphertext is not null
  on conflict (event_id, destination_id) do nothing;
  return new;
end;
$$;

drop trigger if exists notification_business_events_materialize_v2 on public.notification_business_events;
create trigger notification_business_events_materialize_v2
after insert on public.notification_business_events
for each row execute function public.notification_router_materialize_deliveries_v2();

create or replace function public.emit_notification_business_event_v2(
  p_idempotency_key text,
  p_category text,
  p_environment text,
  p_event_type text,
  p_account_id uuid default null,
  p_client_id uuid default null,
  p_tenant_id uuid default null,
  p_business_payload jsonb default '{}'::jsonb,
  p_technical_diagnostics jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
)
returns public.notification_business_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.notification_business_events;
begin
  insert into public.notification_business_events (
    idempotency_key, category, environment, event_type, account_id, client_id,
    tenant_id, business_payload, technical_diagnostics, occurred_at
  ) values (
    trim(p_idempotency_key), p_category, p_environment, trim(p_event_type),
    p_account_id, p_client_id, p_tenant_id,
    coalesce(p_business_payload, '{}'::jsonb),
    coalesce(p_technical_diagnostics, '{}'::jsonb), p_occurred_at
  )
  on conflict (idempotency_key) do nothing
  returning * into result;

  if result.id is null then
    select * into result
    from public.notification_business_events event
    where event.idempotency_key = trim(p_idempotency_key);
  end if;
  return result;
end;
$$;

create or replace function public.claim_notification_deliveries_v2(
  p_claim_owner text,
  p_limit integer default 20
)
returns setof public.notification_deliveries
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_claim_owner), '') is null then
    raise exception 'notification_claim_owner_required' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select delivery.id
    from public.notification_deliveries delivery
    where (
      delivery.status in ('pending','retry')
      and coalesce(delivery.next_retry_at, delivery.created_at) <= now()
    ) or (
      delivery.status = 'processing'
      and delivery.claimed_at < now() - interval '5 minutes'
    )
    order by coalesce(delivery.next_retry_at, delivery.created_at), delivery.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  update public.notification_deliveries delivery
  set status = 'processing', claimed_at = now(), claim_owner = trim(p_claim_owner), updated_at = now()
  from candidates
  where delivery.id = candidates.id
  returning delivery.*;
end;
$$;

create or replace function public.complete_notification_delivery_attempt_v2(
  p_delivery_id uuid,
  p_claim_owner text,
  p_started_at timestamptz,
  p_success boolean,
  p_http_status integer default null,
  p_error_summary text default null
)
returns public.notification_deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.notification_deliveries;
  attempt_number integer;
begin
  select * into delivery
  from public.notification_deliveries row
  where row.id = p_delivery_id
  for update;

  if delivery.id is null or delivery.status <> 'processing' or delivery.claim_owner <> trim(p_claim_owner) then
    raise exception 'notification_delivery_claim_mismatch' using errcode = '40001';
  end if;

  attempt_number := delivery.attempt_count + 1;
  insert into public.notification_delivery_attempts (
    delivery_id, attempt_number, started_at, finished_at, status, http_status, error_summary
  ) values (
    delivery.id, attempt_number, p_started_at, now(),
    case when p_success then 'sent' else 'failed' end,
    p_http_status,
    case when p_success then null else left(coalesce(p_error_summary, 'delivery_failed'), 160) end
  );

  update public.notification_deliveries row set
    status = case
      when p_success then 'sent'
      when attempt_number >= 4 then 'dead_letter'
      else 'retry'
    end,
    attempt_count = attempt_number,
    next_retry_at = case
      when p_success or attempt_number >= 4 then null
      when attempt_number = 1 then now() + interval '1 minute'
      when attempt_number = 2 then now() + interval '5 minutes'
      else now() + interval '30 minutes'
    end,
    sent_at = case when p_success then now() else null end,
    last_error_summary = case when p_success then null else left(coalesce(p_error_summary, 'delivery_failed'), 160) end,
    claimed_at = null,
    claim_owner = null,
    updated_at = now()
  where row.id = delivery.id
  returning * into delivery;

  update public.notification_destination_settings destination set
    last_success_at = case when p_success then now() else destination.last_success_at end,
    last_error_at = case when p_success then destination.last_error_at else now() end,
    last_error_summary = case when p_success then null else left(coalesce(p_error_summary, 'delivery_failed'), 160) end,
    retry_state = jsonb_build_object('status', delivery.status, 'attempt_count', delivery.attempt_count, 'next_retry_at', delivery.next_retry_at),
    updated_at = now()
  where destination.id = delivery.destination_id;

  return delivery;
end;
$$;

create or replace function public.skip_notification_delivery_v2(
  p_delivery_id uuid,
  p_claim_owner text,
  p_reason text default 'destination_disabled_or_unconfigured'
)
returns public.notification_deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.notification_deliveries;
begin
  update public.notification_deliveries row set
    status = 'skipped',
    next_retry_at = null,
    last_error_summary = left(coalesce(nullif(trim(p_reason), ''), 'destination_disabled_or_unconfigured'), 160),
    claimed_at = null,
    claim_owner = null,
    updated_at = now()
  where row.id = p_delivery_id
    and row.status = 'processing'
    and row.claim_owner = trim(p_claim_owner)
  returning * into delivery;

  if delivery.id is null then
    raise exception 'notification_delivery_claim_mismatch' using errcode = '40001';
  end if;

  return delivery;
end;
$$;

create or replace function public.rotate_notification_incident_ciphertexts_v2(
  p_ciphertexts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  channel_name text;
  rotated integer := 0;
begin
  if jsonb_typeof(coalesce(p_ciphertexts, '{}'::jsonb)) <> 'object' then
    raise exception 'notification_ciphertext_rotation_payload_invalid' using errcode = '22023';
  end if;
  foreach channel_name in array array['slack','discord'] loop
    if nullif(p_ciphertexts ->> channel_name, '') is not null then
      update public.notification_destination_settings destination set
        webhook_ciphertext = p_ciphertexts ->> channel_name,
        webhook_key_version = 'notification_v2',
        configured_at = coalesce(destination.configured_at, now()),
        updated_at = now()
      where destination.category = 'incident'
        and destination.environment = 'live'
        and destination.channel = channel_name;
      rotated := rotated + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'rotated', rotated);
end;
$$;

-- Commercial events are materialized inside the exact terminal state write.
-- No provider call is made by these triggers.
create or replace function public.notification_router_new_client_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  checkout_session public.commercial_checkout_sessions%rowtype;
  entitlement public.client_account_entitlements%rowtype;
  subscription public.commercial_stripe_subscriptions%rowtype;
  username text;
begin
  if new.flow_type <> 'first_purchase'
     or old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'failed' and new.payment_confirmed_at is not null then
    select '@' || trim(leading '@' from account.username) into username
    from public.ig_accounts account where account.id = new.account_id;
    perform public.emit_notification_business_event_v2(
      'new_client.activation_attention_required:' || new.id::text,
      'new_client', case when new.livemode then 'live' else 'test' end,
      'new_client.activation_attention_required', new.account_id, new.client_id, null,
      jsonb_build_object('username', coalesce(username, '@non-renseigné')),
      jsonb_build_object('checkout_attempt_id', new.id, 'failure', new.fulfillment_error_redacted),
      coalesce(new.updated_at, now())
    );
    return new;
  end if;

  if new.status <> 'fulfilled' then return new; end if;
  select * into checkout_session from public.commercial_checkout_sessions
    where id = new.commercial_checkout_session_id;
  select * into entitlement from public.client_account_entitlements
    where id = new.client_account_entitlement_id;
  select * into subscription from public.commercial_stripe_subscriptions
    where stripe_subscription_id = new.stripe_subscription_id
      and client_id = new.client_id
      and account_id = new.account_id
      and client_account_entitlement_id = new.client_account_entitlement_id
      and status in ('active','trialing');

  if checkout_session.id is null or checkout_session.status <> 'checkout_paid'
     or entitlement.id is null or entitlement.status <> 'entitlement_consumed'
     or entitlement.account_id is distinct from new.account_id
     or entitlement.commercial_package_code <> entitlement.plan_key
     or subscription.id is null then
    raise exception 'new_client_notification_convergence_incomplete' using errcode = '23514';
  end if;
  select '@' || trim(leading '@' from account.username) into username
    from public.ig_accounts account where account.id = new.account_id;
  perform public.emit_notification_business_event_v2(
    'new_client.activated:' || new.id::text,
    'new_client', case when new.livemode then 'live' else 'test' end,
    'new_client.activated', new.account_id, new.client_id, null,
    jsonb_build_object(
      'username', coalesce(username, '@non-renseigné'),
      'plan', initcap(entitlement.plan_key),
      'duration', entitlement.billing_interval_months::text || ' mois',
      'amount', to_char(checkout_session.total_period_cents::numeric / 100, 'FM999999990D00') || ' €'
    ),
    jsonb_build_object('checkout_attempt_id', new.id, 'entitlement_id', entitlement.id, 'subscription_id', subscription.id),
    coalesce(new.fulfilled_at, new.updated_at, now())
  );
  return new;
end;
$$;

drop trigger if exists notification_router_new_client_v2 on public.commercial_stripe_checkout_attempts;
create trigger notification_router_new_client_v2
after update of status on public.commercial_stripe_checkout_attempts
for each row execute function public.notification_router_new_client_v2();

create or replace function public.notification_router_plan_change_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  quote public.commercial_plan_change_quotes%rowtype;
  entitlement public.client_account_entitlements%rowtype;
  username text;
  stripe_event_id text;
begin
  if coalesce(new.metadata_safe ->> 'plan_change_state', '') <> 'webhook_reconciled'
     or coalesce(old.metadata_safe ->> 'plan_change_state', '') = 'webhook_reconciled'
     or new.plan_change_quote_id is null then
    return new;
  end if;
  select * into quote from public.commercial_plan_change_quotes where id = new.plan_change_quote_id;
  select * into entitlement from public.client_account_entitlements
    where id = new.client_account_entitlement_id
      and client_id = new.client_id and account_id = new.account_id
      and status = 'entitlement_consumed';
  stripe_event_id := nullif(new.metadata_safe ->> 'stripe_event_id', '');
  if quote.id is null or quote.status <> 'quote_activated'
     or quote.client_id is distinct from new.client_id
     or quote.account_id is distinct from new.account_id
     or quote.target_plan_key is distinct from entitlement.plan_key
     or quote.actual_stripe_reconciled_at is null
     or quote.actual_stripe_period_end_at is null
     or quote.actual_stripe_remaining_credit_cents is null
     or stripe_event_id is null then
    raise exception 'plan_change_notification_convergence_incomplete' using errcode = '23514';
  end if;
  select '@' || trim(leading '@' from account.username) into username
    from public.ig_accounts account where account.id = new.account_id;
  perform public.emit_notification_business_event_v2(
    'plan_change.completed:' || quote.id::text || ':' || stripe_event_id,
    'plan_change', case when new.livemode then 'live' else 'test' end,
    'plan_change.completed', new.account_id, new.client_id, null,
    jsonb_build_object(
      'username', coalesce(username, '@non-renseigné'),
      'previousPlan', initcap(quote.source_plan_key),
      'newPlan', initcap(quote.target_plan_key),
      'expiry', to_char(quote.actual_stripe_period_end_at at time zone 'UTC', 'DD/MM/YYYY'),
      'remainingCredit', case when quote.actual_stripe_remaining_credit_cents > 0
        then to_char(quote.actual_stripe_remaining_credit_cents::numeric / 100, 'FM999999990D00') || ' €' else null end
    ),
    jsonb_build_object('quote_id', quote.id, 'stripe_event_id', stripe_event_id, 'subscription_id', new.id),
    quote.actual_stripe_reconciled_at
  );
  return new;
end;
$$;

drop trigger if exists notification_router_plan_change_v2 on public.commercial_stripe_subscriptions;
create trigger notification_router_plan_change_v2
after update of metadata_safe on public.commercial_stripe_subscriptions
for each row execute function public.notification_router_plan_change_v2();

-- Auto Login producers live at the canonical database convergence boundaries,
-- so the Worker does not gain notification behavior and no provider call is
-- made from its runtime transaction.
create or replace function public.notification_router_auto_login_success_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  username text;
  plan_key text;
  event_environment text := 'live';
begin
  if not (
    new.active is true
    and new.login_status = 'connected'
    and new.provisioning_status = 'ready'
    and new.onboarding_status = 'ready'
    and new.login_identity_proof_status = 'verified'
    and new.login_identity_profile_opened is true
    and new.login_identity_username_match is true
    and new.login_identity_verified_at is not null
    and nullif(trim(coalesce(new.login_state_invalidation_reason, '')), '') is null
  ) then return new; end if;

  if exists (
    select 1 from public.account_run_requests request
    where request.account_id = new.account_id
      and request.status in ('pending','queued','claimed','starting','processing','running','in_progress','active','cancel_requested')
  ) or exists (
    select 1 from public.ig_runs run
    where run.account_id = new.account_id
      and run.status in ('pending','queued','claimed','starting','processing','running','in_progress','active')
  ) then return new; end if;

  if new.login_identity_source_run_id is not null and not exists (
    select 1 from public.ig_runs run
    join public.account_run_requests request on request.run_id = run.id and request.account_id = run.account_id
    where run.id = new.login_identity_source_run_id
      and run.account_id = new.account_id
      and run.status in ('completed','failed','stopped','canceled')
      and request.requested_run_type = 'login_provisioning'
      and request.status in ('completed','failed','canceled')
  ) then return new; end if;

  if tg_op = 'UPDATE' and
    old.login_status = 'connected' and old.provisioning_status = 'ready'
    and old.onboarding_status = 'ready' and old.login_identity_proof_status = 'verified'
    and old.login_identity_profile_opened is true and old.login_identity_username_match is true
    and old.login_identity_verified_at is not distinct from new.login_identity_verified_at
  then return new; end if;

  select '@' || trim(leading '@' from account.username) into username
  from public.ig_accounts account where account.id = new.account_id;

  select entitlement.plan_key into plan_key
  from public.client_account_entitlements entitlement
  where entitlement.client_id = new.client_id and entitlement.account_id = new.account_id
    and entitlement.status = 'entitlement_consumed'
  order by entitlement.created_at desc limit 1;

  select case when subscription.livemode is false then 'test' else 'live' end into event_environment
  from public.commercial_stripe_subscriptions subscription
  where subscription.client_id = new.client_id and subscription.account_id = new.account_id
    and subscription.status in ('active','trialing')
  order by subscription.updated_at desc limit 1;

  perform public.emit_notification_business_event_v2(
    'auto_login.connected:' || new.id::text || ':' || new.login_identity_proof_version::text || ':' || extract(epoch from new.login_identity_verified_at)::bigint::text,
    'auto_login', coalesce(event_environment, 'live'), 'auto_login.connected',
    new.account_id, new.client_id, null,
    jsonb_build_object('username', coalesce(username, '@non-renseigné'), 'plan', coalesce(plan_key, 'Formule active')),
    jsonb_build_object('client_instagram_account_id', new.id, 'source_run_id', new.login_identity_source_run_id),
    new.login_identity_verified_at
  );
  return new;
end;
$$;

drop trigger if exists notification_router_auto_login_success_v2 on public.client_instagram_accounts;
create trigger notification_router_auto_login_success_v2
after insert or update of login_status, provisioning_status, onboarding_status,
  login_identity_proof_status, login_identity_profile_opened,
  login_identity_username_match, login_identity_verified_at
on public.client_instagram_accounts
for each row execute function public.notification_router_auto_login_success_v2();

create or replace function public.notification_router_auto_login_failure_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  combined_reason text := lower(coalesce(new.reason, '') || ' ' || coalesce(new.failure_reason, '') || ' ' || coalesce(new.incident_type, ''));
  routed_type text;
  business_problem text;
  business_action text;
begin
  if new.status not in ('open','acknowledged') or not (
    lower(new.incident_type) like '%login%'
    or combined_reason ~ '(password|challenge|identity|checkpoint|device|provision)'
  ) then return new; end if;

  if combined_reason ~ '(password|credential.*reject)' then
    routed_type := 'auto_login.wrong_password';
    business_problem := 'Le mot de passe Instagram a été refusé.';
    business_action := 'Demander au client de mettre à jour son mot de passe.';
  elsif combined_reason ~ '(challenge|checkpoint|verification)' then
    routed_type := 'auto_login.challenge';
    business_problem := 'Instagram demande une vérification supplémentaire.';
    business_action := 'Une intervention est nécessaire avant de poursuivre.';
  elsif combined_reason ~ '(identity|mismatch|wrong_account)' then
    routed_type := 'auto_login.identity_mismatch';
    business_problem := 'Le compte Instagram ouvert ne correspond pas au compte attendu.';
    business_action := 'Vérifier l’identité du compte avant de poursuivre.';
  elsif combined_reason ~ '(device|app.*unavailable)' then
    routed_type := 'auto_login.device_unavailable';
    business_problem := 'Le téléphone ou l’application Instagram n’est pas disponible.';
    business_action := 'Vérifier la disponibilité du téléphone dans BotApp.';
  else
    routed_type := 'auto_login.failure';
    business_problem := 'La connexion Instagram n’a pas pu être terminée.';
    business_action := 'Consulter BotApp pour poursuivre la vérification.';
  end if;

  perform public.emit_notification_business_event_v2(
    'auto_login.failure:' || new.id::text || ':' || new.lifecycle_version::text,
    'auto_login', case when new.metadata->>'environment' = 'test' then 'test' else 'live' end, routed_type,
    new.account_id, new.client_id, null,
    jsonb_build_object(
      'username', coalesce('@' || trim(leading '@' from new.account_username), '@non-renseigné'),
      'summary', business_problem, 'action', business_action
    ),
    jsonb_build_object('incident_id', new.id, 'incident_type', new.incident_type, 'reason', new.reason, 'run_id', new.run_id),
    coalesce(new.last_seen_at, new.created_at)
  );
  return new;
end;
$$;

drop trigger if exists notification_router_auto_login_failure_v2 on public.account_incidents;
create trigger notification_router_auto_login_failure_v2
after insert or update of status, lifecycle_version on public.account_incidents
for each row execute function public.notification_router_auto_login_failure_v2();

create or replace function public.notification_router_general_incident_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  combined_reason text := lower(coalesce(new.reason, '') || ' ' || coalesce(new.failure_reason, '') || ' ' || coalesce(new.incident_type, ''));
begin
  -- Specific business categories own their incidents and suppress the generic
  -- Incident route for the same lifecycle version.
  if lower(new.incident_type) like '%login%'
    or combined_reason ~ '(password|challenge|identity|checkpoint|device.*login|provision)'
  then return new; end if;

  if new.status in ('resolved','ignored') then
    perform public.emit_notification_business_event_v2(
      'incident.resolved:' || new.id::text || ':' || new.lifecycle_version::text,
      'incident', case when new.metadata->>'environment' = 'test' then 'test' else 'live' end,
      'incident.resolved', new.account_id, new.client_id, null,
      jsonb_build_object(
        'username', coalesce('@' || trim(leading '@' from new.account_username), '@non-renseigné'),
        'summary', 'La situation signalée a été traitée.'
      ),
      jsonb_build_object('incident_id', new.id, 'incident_type', new.incident_type, 'resolution_reason', new.resolution_reason),
      coalesce(new.resolved_at, new.last_seen_at, now())
    );
    return new;
  end if;
  if new.status not in ('open','acknowledged') then return new; end if;

  perform public.emit_notification_business_event_v2(
    'incident.opened:' || new.id::text || ':' || new.lifecycle_version::text,
    'incident', coalesce(case when new.metadata->>'environment' = 'test' then 'test' else 'live' end, 'live'),
    'incident.opened', new.account_id, new.client_id, null,
    jsonb_build_object(
      'username', coalesce('@' || trim(leading '@' from new.account_username), '@non-renseigné'),
      'summary', coalesce(new.safe_client_message, 'Une vérification opérationnelle est nécessaire.'),
      'action', coalesce(new.action_required, 'Consulter BotApp.')
    ),
    jsonb_build_object('incident_id', new.id, 'incident_type', new.incident_type, 'reason', new.reason),
    coalesce(new.last_seen_at, new.created_at)
  );
  return new;
end;
$$;

drop trigger if exists notification_router_general_incident_v2 on public.account_incidents;
create trigger notification_router_general_incident_v2
after insert or update of status, lifecycle_version on public.account_incidents
for each row execute function public.notification_router_general_incident_v2();

alter table public.notification_destination_settings enable row level security;
alter table public.notification_business_events enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_delivery_attempts enable row level security;

revoke all on table public.notification_destination_settings from public, anon, authenticated;
revoke all on table public.notification_business_events from public, anon, authenticated;
revoke all on table public.notification_deliveries from public, anon, authenticated;
revoke all on table public.notification_delivery_attempts from public, anon, authenticated;
grant all on table public.notification_destination_settings to service_role;
grant all on table public.notification_business_events to service_role;
grant all on table public.notification_deliveries to service_role;
grant all on table public.notification_delivery_attempts to service_role;

revoke all on function public.notification_router_materialize_deliveries_v2() from public, anon, authenticated;
revoke all on function public.notification_business_events_immutable_v2() from public, anon, authenticated;
revoke all on function public.notification_router_auto_login_success_v2() from public, anon, authenticated;
revoke all on function public.notification_router_auto_login_failure_v2() from public, anon, authenticated;
revoke all on function public.notification_router_general_incident_v2() from public, anon, authenticated;
revoke all on function public.emit_notification_business_event_v2(text,text,text,text,uuid,uuid,uuid,jsonb,jsonb,timestamptz) from public, anon, authenticated;
revoke all on function public.claim_notification_deliveries_v2(text,integer) from public, anon, authenticated;
revoke all on function public.complete_notification_delivery_attempt_v2(uuid,text,timestamptz,boolean,integer,text) from public, anon, authenticated;
revoke all on function public.skip_notification_delivery_v2(uuid,text,text) from public, anon, authenticated;
revoke all on function public.rotate_notification_incident_ciphertexts_v2(jsonb) from public, anon, authenticated;
revoke all on function public.notification_router_new_client_v2() from public, anon, authenticated;
revoke all on function public.notification_router_plan_change_v2() from public, anon, authenticated;
grant execute on function public.emit_notification_business_event_v2(text,text,text,text,uuid,uuid,uuid,jsonb,jsonb,timestamptz) to service_role;
grant execute on function public.claim_notification_deliveries_v2(text,integer) to service_role;
grant execute on function public.complete_notification_delivery_attempt_v2(uuid,text,timestamptz,boolean,integer,text) to service_role;
grant execute on function public.skip_notification_delivery_v2(uuid,text,text) to service_role;
grant execute on function public.rotate_notification_incident_ciphertexts_v2(jsonb) to service_role;

comment on table public.notification_business_events is
  'Immutable Notification Router V2 business outbox. Provider delivery is asynchronous.';
comment on column public.notification_destination_settings.webhook_ciphertext is
  'Write-only encrypted webhook. Never expose through renderer, public API, logs, or delivery history.';

commit;
