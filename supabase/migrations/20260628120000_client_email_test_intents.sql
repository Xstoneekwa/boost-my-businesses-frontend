-- Local migration only. Do not apply without explicit GO (TASK 6C).
-- Distinguishes internal test delivery intents from real client lifecycle sends.

alter table public.client_email_send_intents
  add column if not exists intent_kind text not null default 'client'
    check (intent_kind in ('client', 'test'));

alter table public.client_email_send_intents
  alter column client_id drop not null,
  alter column account_id drop not null;

alter table public.client_email_send_intents
  add column if not exists provider_message_id text null,
  add column if not exists last_error_redacted text null;

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_trigger_check;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_trigger_check
  check (trigger in ('manual', 'automatic', 'reminder', 'manual_test'));

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_client_kind_requires_refs;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_client_kind_requires_refs
  check (
    intent_kind = 'test'
    or (client_id is not null and account_id is not null)
  );

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_test_kind_requires_no_refs;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_test_kind_requires_no_refs
  check (
    intent_kind = 'client'
    or (client_id is null and account_id is null and trigger = 'manual_test')
  );

comment on column public.client_email_send_intents.intent_kind is
  'client = lifecycle send; test = allowlisted internal Postmark test delivery only.';

create index if not exists client_email_send_intents_test_kind_created_idx
  on public.client_email_send_intents (created_at desc)
  where intent_kind = 'test';
