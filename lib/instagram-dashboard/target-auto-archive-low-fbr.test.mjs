import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON,
  TARGET_AUTO_ARCHIVE_LOW_FBR_MIN_FOLLOWS_SENT,
  TARGET_AUTO_ARCHIVE_LOW_FBR_THRESHOLD_PERCENT,
  classifyLowFbrPerformance,
  evaluateTargetFollowbackMetricsReliability,
  evaluateTargetReaddBlock,
  isPermanentAutoLowFbrReaddBlock,
  shouldExecuteTargetAutoArchiveLowFbr,
  targetAutoArchiveLowFbrFlags,
  targetAdminAutoArchiveLabel,
} from "./target-auto-archive-low-fbr-policy.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("followback metrics are unreliable when followbacks_count is never populated", () => {
  const evaluation = evaluateTargetFollowbackMetricsReliability({
    follows_sent_count: 120,
    followbacks_count: 0,
    followback_ratio: 0,
  });
  assert.equal(evaluation.metricsReliable, false);
  assert.equal(evaluation.reason, "followbacks_count_not_populated");
});

test("followback metrics become reliable only after explicit certification timestamp", () => {
  const evaluation = evaluateTargetFollowbackMetricsReliability({
    follows_sent_count: 120,
    followbacks_count: 0,
    followback_ratio: 0,
    followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
  });
  assert.equal(evaluation.metricsReliable, true);
});

test("FBR below threshold with insufficient follows does not archive", () => {
  const candidate = classifyLowFbrPerformance({
    follows_sent_count: 99,
    followbacks_count: 1,
    followback_ratio: 1,
    followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
  });
  assert.equal(candidate.performanceStatus, "insufficient_data");
  assert.equal(candidate.wouldArchive, false);
});

test("FBR 7.99% with reliable metrics archives", () => {
  const candidate = classifyLowFbrPerformance({
    follows_sent_count: 100,
    followbacks_count: 7,
    followback_ratio: 7.99,
    followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
  });
  assert.equal(candidate.wouldArchive, true);
});

test("FBR exactly 8.0% does not archive", () => {
  const candidate = classifyLowFbrPerformance({
    follows_sent_count: TARGET_AUTO_ARCHIVE_LOW_FBR_MIN_FOLLOWS_SENT,
    followbacks_count: 8,
    followback_ratio: TARGET_AUTO_ARCHIVE_LOW_FBR_THRESHOLD_PERCENT,
    followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
  });
  assert.equal(candidate.wouldArchive, false);
});

test("FBR above threshold does not archive", () => {
  const candidate = classifyLowFbrPerformance({
    follows_sent_count: 100,
    followbacks_count: 9,
    followback_ratio: 9,
    followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
  });
  assert.equal(candidate.wouldArchive, false);
});

test("FBR below threshold with reliable metrics marks candidate but respects dry-run defaults", () => {
  const candidate = classifyLowFbrPerformance({
    follows_sent_count: 100,
    followbacks_count: 7,
    followback_ratio: 7,
    followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
  });
  assert.equal(candidate.wouldArchive, true);
  assert.equal(
    shouldExecuteTargetAutoArchiveLowFbr(candidate, {
      enabled: false,
      dryRun: true,
      allowAdminRestoreOverride: false,
    }),
    false,
  );
});

test("unreliable low FBR never executes even when enabled and not dry-run", () => {
  const candidate = classifyLowFbrPerformance({
    follows_sent_count: 100,
    followbacks_count: 0,
    followback_ratio: 0,
  });
  assert.equal(candidate.wouldArchive, false);
  assert.equal(
    shouldExecuteTargetAutoArchiveLowFbr(candidate, {
      enabled: true,
      dryRun: false,
      allowAdminRestoreOverride: false,
    }),
    false,
  );
});

test("auto-archived target cannot be re-added for same account permanently", () => {
  const block = evaluateTargetReaddBlock([
    {
      normalized_username: "bad_target",
      status: "archived",
      archived_at: "2026-06-01T00:00:00.000Z",
      archive_reason: TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON,
      readd_blocked_permanently: true,
      readd_block_reason: TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON,
    },
  ], "bad_target");
  assert.equal(block.blocked, true);
  assert.match(block.clientMessageFr ?? "", /mis de côté/i);
  assert.doesNotMatch(block.clientMessageFr ?? "", /followback|FBR|8%|worker|run_id|90/i);
});

test("auto archive reason without expiry still blocks re-add permanently", () => {
  const block = evaluateTargetReaddBlock([
    {
      normalized_username: "legacy_auto",
      status: "archived",
      archive_reason: TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON,
      readd_blocked_until: null,
    },
  ], "legacy_auto");
  assert.equal(block.blocked, true);
  assert.equal(isPermanentAutoLowFbrReaddBlock({
    status: "archived",
    archive_reason: TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON,
  }), true);
});

test("readd guard is scoped to rows for the same account query", () => {
  const sameAccountBlock = evaluateTargetReaddBlock([
    {
      normalized_username: "bad_target",
      status: "archived",
      archive_reason: TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON,
      readd_blocked_permanently: true,
    },
  ], "bad_target");
  const otherAccountRows = evaluateTargetReaddBlock([], "bad_target");
  assert.equal(sameAccountBlock.blocked, true);
  assert.equal(otherAccountRows.blocked, false);
});

test("manual archive without auto reason is never blocked for re-add", () => {
  const block = evaluateTargetReaddBlock([
    {
      normalized_username: "manual_archive",
      status: "archived",
      archived_at: "2026-06-01T00:00:00.000Z",
      archive_reason: "dashboard_archive",
    },
  ], "manual_archive");
  assert.equal(block.blocked, false);
});

test("dry-run never executes archive writes", () => {
  assert.equal(
    shouldExecuteTargetAutoArchiveLowFbr(
      classifyLowFbrPerformance({
        follows_sent_count: 100,
        followbacks_count: 1,
        followback_ratio: 1,
        followbacks_metrics_reliable_at: "2026-06-15T12:00:00.000Z",
      }),
      { enabled: true, dryRun: true, allowAdminRestoreOverride: false },
    ),
    false,
  );
});

test("executor sets permanent re-add block fields", () => {
  const executorSource = source("./target-auto-archive-low-fbr-executor.ts");
  assert.match(executorSource, /readd_blocked_permanently:\s*true/);
  assert.match(executorSource, /readd_blocked_until:\s*null/);
  assert.doesNotMatch(executorSource, /computeTargetReaddBlockedUntil/);
});

test("restore blocks auto low FBR without admin override", () => {
  const serviceSource = source("./targets-service.ts");
  assert.match(serviceSource, /Restore is blocked for targets set aside by the low performance policy/);
});

test("cron route is token protected and daily global", () => {
  const cronSource = source("./target-auto-archive-low-fbr-cron.ts");
  const lockSource = source("./target-auto-archive-low-fbr-scheduler-lock.ts");
  const routeSource = source("../../app/api/instagram-dashboard/targets/auto-archive-low-fbr-cron/route.ts");
  assert.match(cronSource, /runTargetAutoArchiveLowFbrPolicyGlobal/);
  assert.match(cronSource, /withTargetAutoArchiveLowFbrSchedulerLock/);
  assert.match(cronSource, /already_running/);
  assert.match(lockSource, /claim_target_auto_archive_low_fbr_scheduler_lock/);
  assert.match(routeSource, /runTargetAutoArchiveLowFbrCron/);
});

test("targets service wires re-add guard", () => {
  const serviceSource = source("./targets-service.ts");
  assert.match(serviceSource, /evaluateTargetReaddBlock/);
  assert.match(serviceSource, /TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON/);
});

test("default feature flags stay off with dry-run on", () => {
  const flags = targetAutoArchiveLowFbrFlags({
    TARGET_AUTO_ARCHIVE_LOW_FBR_ENABLED: "false",
    TARGET_AUTO_ARCHIVE_LOW_FBR_DRY_RUN: "true",
  });
  assert.equal(flags.enabled, false);
  assert.equal(flags.dryRun, true);
});

test("admin auto-archive label stays internal and explicit", () => {
  assert.equal(
    targetAdminAutoArchiveLabel({ archiveReason: TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON }),
    "Mis de côté automatiquement — FBR faible",
  );
  assert.equal(
    targetAdminAutoArchiveLabel({ archiveReason: null, autoArchivedAt: "2026-06-20T03:00:00.000Z" }),
    "Archive automatique — rendement insuffisant",
  );
});
