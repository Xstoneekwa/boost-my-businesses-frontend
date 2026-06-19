-- Target auto-archive low FBR foundation (schema only).
-- Policy remains OFF by default until followbacks_count is certified reliable.
-- No automatic data mutation in this migration.

alter table public.ig_targets
  add column if not exists auto_archived_at timestamptz,
  add column if not exists readd_blocked_until timestamptz,
  add column if not exists followbacks_metrics_reliable_at timestamptz;

comment on column public.ig_targets.auto_archived_at is
  'Timestamp when a target was auto-archived by the low-FBR performance policy.';
comment on column public.ig_targets.readd_blocked_until is
  'Re-add block expiry for the same account_id + normalized username after auto-archive.';
comment on column public.ig_targets.followbacks_metrics_reliable_at is
  'Set only when the worker certifies durable CT-level followbacks_count attribution.';

create index if not exists ig_targets_readd_block_lookup_idx
  on public.ig_targets (account_id, normalized_username, archive_reason, readd_blocked_until desc)
  where status = 'archived';
