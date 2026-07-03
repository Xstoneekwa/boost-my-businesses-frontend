-- Stripe Test webhook recovery and attempt fulfillment state machine (additive only).

alter table public.commercial_stripe_webhook_events
  drop constraint if exists commercial_stripe_webhook_events_status_check;

alter table public.commercial_stripe_webhook_events
  add constraint commercial_stripe_webhook_events_status_check
  check (status in (
    'received',
    'processing',
    'processed',
    'ignored',
    'failed',
    'retryable'
  ));

alter table public.commercial_stripe_webhook_events
  add column if not exists processing_started_at timestamptz null,
  add column if not exists attempts_count integer not null default 0,
  add column if not exists last_error_redacted text null;

comment on column public.commercial_stripe_webhook_events.processing_started_at is
  'Lease start for in-flight webhook processing. Stale leases may be reclaimed.';
comment on column public.commercial_stripe_webhook_events.attempts_count is
  'Number of processing attempts for this Stripe event id.';
comment on column public.commercial_stripe_webhook_events.last_error_redacted is
  'Redacted last fulfillment error for retryable/failed events.';

alter table public.commercial_stripe_checkout_attempts
  drop constraint if exists commercial_stripe_checkout_attempts_status_check;

alter table public.commercial_stripe_checkout_attempts
  add constraint commercial_stripe_checkout_attempts_status_check
  check (status in (
    'pending',
    'session_created',
    'awaiting_payment',
    'payment_confirmed',
    'fulfillment_processing',
    'fulfilled',
    'reconciliation_required',
    'failed_recoverable',
    'completed',
    'expired',
    'failed',
    'cancelled'
  ));

alter table public.commercial_stripe_checkout_attempts
  add column if not exists target_stripe_price_id text null,
  add column if not exists payment_confirmed_at timestamptz null,
  add column if not exists fulfilled_at timestamptz null,
  add column if not exists fulfillment_error_redacted text null;

comment on column public.commercial_stripe_checkout_attempts.target_stripe_price_id is
  'Server-resolved target Stripe Price for plan-change fulfillment. Never client supplied.';
comment on column public.commercial_stripe_checkout_attempts.fulfillment_error_redacted is
  'Redacted last fulfillment error when reconciliation is required.';

create or replace function public.claim_commercial_stripe_webhook_event(
  p_stripe_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_stripe_object_id text default null,
  p_stripe_customer_id text default null,
  p_stripe_subscription_id text default null,
  p_stripe_checkout_session_id text default null,
  p_metadata_safe jsonb default '{}'::jsonb,
  p_stale_after_seconds integer default 120
)
returns table (
  event_row_id uuid,
  claim_result text,
  prior_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.commercial_stripe_webhook_events%rowtype;
  v_now timestamptz := now();
  v_stale_before timestamptz := v_now - make_interval(secs => greatest(p_stale_after_seconds, 30));
begin
  if p_livemode then
    raise exception 'stripe_livemode_rejected';
  end if;

  select *
  into v_row
  from public.commercial_stripe_webhook_events
  where stripe_event_id = p_stripe_event_id
  for update;

  if not found then
    insert into public.commercial_stripe_webhook_events (
      stripe_event_id,
      event_type,
      livemode,
      status,
      stripe_object_id,
      stripe_customer_id,
      stripe_subscription_id,
      stripe_checkout_session_id,
      metadata_safe,
      processing_started_at,
      attempts_count,
      received_at
    ) values (
      p_stripe_event_id,
      p_event_type,
      false,
      'processing',
      p_stripe_object_id,
      p_stripe_customer_id,
      p_stripe_subscription_id,
      p_stripe_checkout_session_id,
      coalesce(p_metadata_safe, '{}'::jsonb),
      v_now,
      1,
      v_now
    )
    returning id into event_row_id;

    claim_result := 'claimed';
    prior_status := null;
    return next;
    return;
  end if;

  event_row_id := v_row.id;
  prior_status := v_row.status;

  if v_row.status in ('processed', 'ignored') then
    claim_result := 'deduplicated';
    return next;
    return;
  end if;

  if v_row.status = 'processing'
     and v_row.processing_started_at is not null
     and v_row.processing_started_at > v_stale_before then
    claim_result := 'concurrent';
    return next;
    return;
  end if;

  update public.commercial_stripe_webhook_events
  set
    status = 'processing',
    processing_started_at = v_now,
    attempts_count = v_row.attempts_count + 1,
    event_type = p_event_type,
    stripe_object_id = coalesce(p_stripe_object_id, v_row.stripe_object_id),
    stripe_customer_id = coalesce(p_stripe_customer_id, v_row.stripe_customer_id),
    stripe_subscription_id = coalesce(p_stripe_subscription_id, v_row.stripe_subscription_id),
    stripe_checkout_session_id = coalesce(p_stripe_checkout_session_id, v_row.stripe_checkout_session_id),
    metadata_safe = coalesce(p_metadata_safe, v_row.metadata_safe),
    last_error_redacted = null,
    processed_at = null
  where id = v_row.id;

  if v_row.status = 'processing' then
    claim_result := 'reclaimed_stale';
  elsif v_row.status in ('failed', 'retryable', 'received') then
    claim_result := 'claimed';
  else
    claim_result := 'claimed';
  end if;

  return next;
end;
$$;

revoke all on function public.claim_commercial_stripe_webhook_event(
  text, text, boolean, text, text, text, text, jsonb, integer
) from public;
revoke all on function public.claim_commercial_stripe_webhook_event(
  text, text, boolean, text, text, text, text, jsonb, integer
) from anon;
revoke all on function public.claim_commercial_stripe_webhook_event(
  text, text, boolean, text, text, text, text, jsonb, integer
) from authenticated;
grant execute on function public.claim_commercial_stripe_webhook_event(
  text, text, boolean, text, text, text, text, jsonb, integer
) to service_role;
