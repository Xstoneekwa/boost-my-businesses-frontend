-- Local migration only. Do not apply without explicit GO (TASK 10A).
-- Explicit parent linkage between client_email_send_intents and lifecycle business episodes.

alter table public.client_email_send_intents
  add column if not exists lifecycle_episode_id uuid null;

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_lifecycle_episode_id_fkey;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_lifecycle_episode_id_fkey
  foreign key (lifecycle_episode_id)
  references public.client_email_lifecycle_episodes (id)
  on delete restrict;

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_sequence_id_fkey;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_sequence_id_fkey
  foreign key (sequence_id)
  references public.client_email_needs_more_targets_sequences (id)
  on delete restrict;

create index if not exists client_email_send_intents_lifecycle_episode_id_idx
  on public.client_email_send_intents (lifecycle_episode_id)
  where lifecycle_episode_id is not null;

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_parent_exclusivity;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_parent_exclusivity
  check (
    not (sequence_id is not null and lifecycle_episode_id is not null)
  );

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_test_kind_requires_no_refs;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_test_kind_requires_no_refs
  check (
    intent_kind = 'client'
    or (
      client_id is null
      and account_id is null
      and sequence_id is null
      and lifecycle_episode_id is null
      and trigger = 'manual_test'
    )
  );

alter table public.client_email_send_intents
  drop constraint if exists client_email_send_intents_client_parent_requires_refs;

alter table public.client_email_send_intents
  add constraint client_email_send_intents_client_parent_requires_refs
  check (
    intent_kind = 'test'
    or (
      category = 'needs_more_target_accounts'
      and sequence_id is not null
      and lifecycle_episode_id is null
    )
    or (
      category in ('account_paused', 'account_canceled', 'needs_assistance')
      and lifecycle_episode_id is not null
      and sequence_id is null
    )
  );

comment on column public.client_email_send_intents.lifecycle_episode_id is
  'FK to client_email_lifecycle_episodes for account_paused, account_canceled, and needs_assistance client intents.';

comment on column public.client_email_send_intents.sequence_id is
  'FK to client_email_needs_more_targets_sequences for needs_more_target_accounts client intents.';
