-- Permanent re-add block for auto low-FBR archives (no 90-day window).

alter table public.ig_targets
  add column if not exists readd_blocked_permanently boolean not null default false,
  add column if not exists readd_block_reason text,
  add column if not exists readd_blocked_at timestamptz;

comment on column public.ig_targets.readd_blocked_permanently is
  'Permanent re-add block for the same account_id + normalized username.';
comment on column public.ig_targets.readd_block_reason is
  'Stable reason code for permanent re-add block (e.g. auto_low_followback_ratio).';
comment on column public.ig_targets.readd_blocked_at is
  'Timestamp when permanent re-add block was set.';

create index if not exists ig_targets_permanent_readd_block_lookup_idx
  on public.ig_targets (account_id, normalized_username, archive_reason, readd_blocked_permanently)
  where status = 'archived';
