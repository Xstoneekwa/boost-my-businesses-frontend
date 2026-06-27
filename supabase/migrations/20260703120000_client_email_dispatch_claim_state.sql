-- Local migration only. Do not apply without explicit GO (TASK 12A).
-- Prepares durable dispatch claim / lease / uncertain state on client_email_send_intents.
-- No RPC, trigger, cron, queue, or worker is created in this migration.

-- ---------------------------------------------------------------------------
-- Status machine extension (compatible with historical rows)
-- Existing production rows: pending | scheduled | sent | canceled | failed
-- New dispatch-only statuses: claimed | dispatch_uncertain
-- Historical test intents (intent_kind=test, status=sent, provider_message_id set)
-- remain valid with null claim fields and dispatch_attempt_count=0.
-- ---------------------------------------------------------------------------

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_status_check;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_status_check
  check (status in (
    'pending',
    'scheduled',
    'claimed',
    'dispatch_uncertain',
    'sent',
    'canceled',
    'failed'
  ));

-- provider_message_id already exists (TASK 6C). Not re-added here.

alter table public.client_email_send_intents
  add column if not exists claimed_at timestamptz null,
  add column if not exists claim_token uuid null,
  add column if not exists claim_expires_at timestamptz null,
  add column if not exists dispatch_attempt_count smallint not null default 0,
  add column if not exists dispatch_last_attempt_at timestamptz null,
  add column if not exists dispatch_last_error_code text null,
  add column if not exists dispatch_uncertain_at timestamptz null,
  add column if not exists provider_accepted_at timestamptz null;

comment on column public.client_email_send_intents.claimed_at is
  'When a dispatch worker atomically claimed this intent for provider send.';
comment on column public.client_email_send_intents.claim_token is
  'Opaque lease token required to finalize or release a claimed intent. Never a provider secret.';
comment on column public.client_email_send_intents.claim_expires_at is
  'Lease expiry for claimed intents. After expiry, reclaim is allowed only after revalidation.';
comment on column public.client_email_send_intents.dispatch_attempt_count is
  'Bounded count of dispatch attempts. Does not authorize retry after dispatch_uncertain.';
comment on column public.client_email_send_intents.dispatch_last_attempt_at is
  'Timestamp of the latest dispatch attempt (success, failure, or ambiguous).';
comment on column public.client_email_send_intents.dispatch_last_error_code is
  'Stable redacted dispatch error code for ops filtering. Never raw provider payloads.';
comment on column public.client_email_send_intents.dispatch_uncertain_at is
  'When provider outcome became ambiguous (timeout/network). Blocks automatic retry/resend.';
comment on column public.client_email_send_intents.provider_accepted_at is
  'When provider acceptance was recorded (HTTP MessageID or correlated webhook), distinct from sent_at when needed.';

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_dispatch_attempt_count_check;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_dispatch_attempt_count_check
  check (dispatch_attempt_count >= 0 and dispatch_attempt_count <= 8);

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_claimed_state_requires_lease;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_claimed_state_requires_lease
  check (
    status <> 'claimed'
    or (
      claim_token is not null
      and claimed_at is not null
      and claim_expires_at is not null
      and claim_expires_at > claimed_at
    )
  );

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_non_claimed_clears_active_lease;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_non_claimed_clears_active_lease
  check (
    status = 'claimed'
    or (
      claim_token is null
      and claimed_at is null
      and claim_expires_at is null
    )
  );

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_uncertain_state_requires_timestamp;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_uncertain_state_requires_timestamp
  check (
    (status = 'dispatch_uncertain' and dispatch_uncertain_at is not null)
    or (status <> 'dispatch_uncertain' and dispatch_uncertain_at is null)
  );

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_uncertain_clears_active_lease;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_uncertain_clears_active_lease
  check (
    status <> 'dispatch_uncertain'
    or (
      claim_token is null
      and claimed_at is null
      and claim_expires_at is null
    )
  );

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_uncertain_has_no_provider_message;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_uncertain_has_no_provider_message
  check (
    status <> 'dispatch_uncertain'
    or provider_message_id is null
  );

-- One provider MessageID must not correlate to two intents.
create unique index if not exists client_email_send_intents_provider_message_id_idx
  on public.client_email_send_intents (provider_message_id)
  where provider_message_id is not null;

-- Dispatcher selection: client lifecycle intents awaiting first dispatch.
create index if not exists client_email_send_intents_dispatch_pending_idx
  on public.client_email_send_intents (scheduled_for, created_at asc)
  where intent_kind = 'client'
    and status in ('pending', 'scheduled')
    and provider_message_id is null;

-- Active claims nearing or past lease expiry (reclaim only after explicit worker revalidation).
create index if not exists client_email_send_intents_dispatch_claimed_idx
  on public.client_email_send_intents (claim_expires_at asc)
  where status = 'claimed';

-- Ambiguous provider outcomes awaiting webhook or human reconciliation.
create index if not exists client_email_send_intents_dispatch_uncertain_idx
  on public.client_email_send_intents (dispatch_uncertain_at asc)
  where status = 'dispatch_uncertain';

-- Parent correlation for episode/sequence scoped dispatch audits.
create index if not exists client_email_send_intents_sequence_status_idx
  on public.client_email_send_intents (sequence_id, status, created_at desc)
  where sequence_id is not null;

create index if not exists client_email_send_intents_lifecycle_episode_status_idx
  on public.client_email_send_intents (lifecycle_episode_id, status, created_at desc)
  where lifecycle_episode_id is not null;

-- client_email_delivery_events: unchanged in TASK 12A.
-- webhook_event_id partial unique index remains the dedupe source of truth.
