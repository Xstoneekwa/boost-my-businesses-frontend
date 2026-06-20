# Target auto-archive — low followback ratio (production policy)

Status: **production-ready with env gates**.

## Product rule (platform-wide)

Soft-archive a target when **all** are true for the same `account_id` + normalized username:

1. `follows_sent_count >= 100`
2. `followback_ratio < 8%` (**strict** — exactly 8.0% is **not** archived)
3. `followbacks_metrics_reliable_at IS NOT NULL`
4. `quality_status = eligible` and target active (not archived/deleted)

Action:

- `status = archived` (soft archive only)
- `archive_reason = auto_low_followback_ratio`
- `auto_archived_at = now()`
- **Permanent re-add block** (same campaign):
  - `readd_blocked_permanently = true`
  - `readd_block_reason = auto_low_followback_ratio`
  - `readd_blocked_at = now()`
  - `readd_blocked_until = null` (no 90-day window)

Never hard delete.

## Never auto-archive when

- `follows_sent_count < 100`
- `followbacks_metrics_reliable_at IS NULL`
- `followback_ratio IS NULL`
- FBR not measured (0 followbacks without certification → **non mesuré**, not 0%)
- already archived/deleted

## Feature flags

```env
TARGET_AUTO_ARCHIVE_LOW_FBR_ENABLED=false
TARGET_AUTO_ARCHIVE_LOW_FBR_DRY_RUN=true
TARGET_AUTO_ARCHIVE_ALLOW_ADMIN_RESTORE=false

TARGET_AUTO_ARCHIVE_LOW_FBR_CRON_ENABLED=false
TARGET_AUTO_ARCHIVE_LOW_FBR_CRON_TOKEN=...
TARGET_AUTO_ARCHIVE_LOW_FBR_CRON_LOCK_TTL_SECONDS=900
TARGET_AUTO_ARCHIVE_LOW_FBR_CRON_WORKER_ID=target_auto_archive_low_fbr_cron
```

Execution requires **all** for real writes:

- `ENABLED=true`
- `DRY_RUN=false`
- candidate eligible + metrics reliable

## Daily scheduler

Route (ops only, token-protected):

`GET|POST /api/instagram-dashboard/targets/auto-archive-low-fbr-cron`

- Global scan all eligible active targets (paginated batches)
- Lock via `claim_target_auto_archive_low_fbr_scheduler_lock` with dedicated worker id
- Idempotent: already-archived rows excluded from scan

Local/script dry-run:

```bash
TARGET_AUTO_ARCHIVE_LOW_FBR_ENABLED=true \
TARGET_AUTO_ARCHIVE_LOW_FBR_DRY_RUN=true \
node scripts/run-target-auto-archive-low-fbr.mjs
```

## Re-add blocking

Guard in shared `targets-service.ts` for:

- client manual / bulk / Target AI
- admin / BotApp relay (same service)
- **restore blocked** for `auto_low_followback_ratio` unless `TARGET_AUTO_ARCHIVE_ALLOW_ADMIN_RESTORE=true`

Client message:

> Ce compte cible a été mis de côté pour cette campagne.

Scope: same `account_id` + normalized username only.

## Audit events

- `target_auto_archived_low_followback_ratio`
- `target_readd_blocked_low_followback_ratio`

## Files

- `lib/instagram-dashboard/target-auto-archive-low-fbr-policy.ts`
- `lib/instagram-dashboard/target-auto-archive-low-fbr-executor.ts`
- `lib/instagram-dashboard/target-auto-archive-low-fbr-cron.ts`
- `app/api/instagram-dashboard/targets/auto-archive-low-fbr-cron/route.ts`
- `supabase/migrations/20260615190000_target_auto_archive_low_fbr_permanent_block.sql`
