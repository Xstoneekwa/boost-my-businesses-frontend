# Target auto-archive — low followback ratio (design only)

Status: **designed + scaffolded, not production-active**.

## Product rule (future)

Archive a target account (soft) when **all** are true:

1. `follows_sent_count >= 100` for the same `account_id` + target username
2. `followback_ratio <= 8%` (aligned with existing P1c classifier)
3. `followbacks_metrics_reliable_at IS NOT NULL` (mandatory reliability gate)

Action:

- soft archive only (`status = archived`)
- `archive_reason = auto_low_followback_ratio`
- `auto_archived_at` set
- `readd_blocked_until = now + 90 days` (same campaign / `account_id`)

Never hard delete.

## Metrics reliability audit (2026-06-15)

| Metric | Reliable today? | Evidence |
|--------|-----------------|----------|
| `follows_sent_count` | **Mostly yes** | Incremented by worker via `record_follow_source_follow_success` → RPC `increment_ig_target_follows_sent_p1c` per `target_id` |
| `followbacks_count` | **No** | Column exists; worker never writes it; prod max = 0 |
| `followback_ratio` | **No for policy** | DB trigger computes `followbacks / follows`; with `followbacks_count = 0` and `follows > 0` → artificial **0%** |

Conclusion: **`metricsReliable = false`** until worker certifies CT-level followbacks and sets `followbacks_metrics_reliable_at`.

Prod snapshot: max `follows_sent_count = 18`, zero targets with `>= 100` follows, zero with `followbacks_count > 0`.

## Feature flags (default safe)

```env
TARGET_AUTO_ARCHIVE_LOW_FBR_ENABLED=false
TARGET_AUTO_ARCHIVE_LOW_FBR_DRY_RUN=true
TARGET_AUTO_ARCHIVE_ALLOW_ADMIN_RESTORE=false
```

Execution requires **all**:

- `ENABLED=true`
- `DRY_RUN=false`
- candidate eligible
- metrics reliable

## Re-add blocking

Guard wired in shared `targets-service.ts`:

- client manual add
- client bulk / Target AI bulk (`addAccountTargetsBulk`)
- admin/BotApp routes delegating to the same service
- restore blocked while `readd_blocked_until` active (admin override env only)

Client message:

> Ce compte cible a été mis de côté pour cette campagne.

## Audit events

Internal operations (not client-facing):

- `target_auto_archived_low_followback_ratio`
- `target_readd_blocked_low_followback_ratio`

Client Activity Log label (future): **Compte cible mis de côté**

## Activation checklist (future GO)

1. Worker: durable CT followback attribution from `ig_interacted_users.source_target_id`
2. Worker: increment `ig_targets.followbacks_count` + set `followbacks_metrics_reliable_at`
3. Tests on real attribution paths
4. Enable dry-run review in staging
5. Liam GO → `ENABLED=true`, `DRY_RUN=false`

## Files

- `lib/instagram-dashboard/target-auto-archive-low-fbr-policy.ts`
- `lib/instagram-dashboard/target-auto-archive-low-fbr-executor.ts`
- `lib/instagram-dashboard/target-auto-archive-low-fbr.test.mjs`
- `supabase/migrations/20260615180000_target_auto_archive_low_fbr_foundation.sql`
