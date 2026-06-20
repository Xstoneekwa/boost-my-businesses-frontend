import { readString } from "../instagram-client/guards.ts";

export const TARGET_AUTO_ARCHIVE_LOW_FBR_THRESHOLD_PERCENT = 8;
export const TARGET_AUTO_ARCHIVE_LOW_FBR_MIN_FOLLOWS_SENT = 100;
export const TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON = "auto_low_followback_ratio";
export const TARGET_AUTO_ARCHIVE_LOW_FBR_AUDIT_OPERATION = "target_auto_archived_low_followback_ratio";
export const TARGET_AUTO_ARCHIVE_READD_BLOCKED_AUDIT_REASON = "target_readd_blocked_low_followback_ratio";

export type TargetMetricsRow = {
  follows_sent_count?: number | null;
  followbacks_count?: number | null;
  followback_ratio?: number | null;
  followbacks_metrics_reliable_at?: string | null;
  metrics_updated_at?: string | null;
};

export type TargetReaddRow = {
  normalized_username?: string | null;
  target_username?: string | null;
  status?: string | null;
  archived_at?: string | null;
  archive_reason?: string | null;
  readd_blocked_until?: string | null;
  readd_blocked_permanently?: boolean | null;
  readd_block_reason?: string | null;
  readd_blocked_at?: string | null;
};

export type MetricsReliabilityEvaluation = {
  metricsReliable: boolean;
  reason: string;
};

export type AutoArchiveCandidateEvaluation = {
  eligible: boolean;
  metricsReliable: boolean;
  followsSent: number;
  followbackRatio: number | null;
  performanceStatus: "pending" | "insufficient_data" | "bad" | "avg" | "good" | "not_applicable";
  reviewCandidate: boolean;
  wouldArchive: boolean;
  blockReason: string | null;
};

export type TargetReaddBlockEvaluation = {
  blocked: boolean;
  reason: string | null;
  clientMessageFr: string | null;
  clientMessageEn: string | null;
};

export type TargetAutoArchiveLowFbrFlags = {
  enabled: boolean;
  dryRun: boolean;
  allowAdminRestoreOverride: boolean;
};

function readBooleanEnv(value: string | undefined, fallback: boolean) {
  const normalized = readString(value, "").toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function targetAutoArchiveLowFbrFlags(
  env: NodeJS.ProcessEnv = process.env,
): TargetAutoArchiveLowFbrFlags {
  return {
    enabled: readBooleanEnv(env.TARGET_AUTO_ARCHIVE_LOW_FBR_ENABLED, false),
    dryRun: readBooleanEnv(env.TARGET_AUTO_ARCHIVE_LOW_FBR_DRY_RUN, true),
    allowAdminRestoreOverride: readBooleanEnv(env.TARGET_AUTO_ARCHIVE_ALLOW_ADMIN_RESTORE, false),
  };
}

function readCount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function readRatio(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isBelowAutoArchiveThreshold(ratio: number) {
  return ratio < TARGET_AUTO_ARCHIVE_LOW_FBR_THRESHOLD_PERCENT;
}

export function evaluateTargetFollowbackMetricsReliability(
  row: TargetMetricsRow,
): MetricsReliabilityEvaluation {
  const followsSent = readCount(row.follows_sent_count);
  const followbacks = readCount(row.followbacks_count);
  const reliableAt = readString(row.followbacks_metrics_reliable_at, "");

  if (reliableAt) {
    return { metricsReliable: true, reason: "followbacks_metrics_reliable_at_set" };
  }

  if (followsSent <= 0) {
    return { metricsReliable: false, reason: "no_follows_sent_yet" };
  }

  if (followbacks === 0) {
    return {
      metricsReliable: false,
      reason: "followbacks_count_not_populated",
    };
  }

  return {
    metricsReliable: false,
    reason: "followbacks_pipeline_not_certified",
  };
}

export function classifyLowFbrPerformance(
  row: TargetMetricsRow,
  qualityStatus: string = "eligible",
): AutoArchiveCandidateEvaluation {
  const followsSent = readCount(row.follows_sent_count);
  const followbacks = readCount(row.followbacks_count);
  const storedRatio = readRatio(row.followback_ratio);
  const ratio = storedRatio ?? (followsSent > 0 ? (followbacks / followsSent) * 100 : null);
  const reliability = evaluateTargetFollowbackMetricsReliability(row);

  if (qualityStatus !== "eligible") {
    return {
      eligible: false,
      metricsReliable: reliability.metricsReliable,
      followsSent,
      followbackRatio: ratio,
      performanceStatus: "not_applicable",
      reviewCandidate: false,
      wouldArchive: false,
      blockReason: "quality_not_eligible",
    };
  }

  if (followsSent <= 0) {
    return {
      eligible: false,
      metricsReliable: reliability.metricsReliable,
      followsSent,
      followbackRatio: ratio,
      performanceStatus: "pending",
      reviewCandidate: false,
      wouldArchive: false,
      blockReason: "pending_runtime_data",
    };
  }

  if (followsSent < TARGET_AUTO_ARCHIVE_LOW_FBR_MIN_FOLLOWS_SENT) {
    return {
      eligible: false,
      metricsReliable: reliability.metricsReliable,
      followsSent,
      followbackRatio: ratio,
      performanceStatus: "insufficient_data",
      reviewCandidate: false,
      wouldArchive: false,
      blockReason: "insufficient_follow_volume",
    };
  }

  if (ratio === null) {
    return {
      eligible: false,
      metricsReliable: reliability.metricsReliable,
      followsSent,
      followbackRatio: null,
      performanceStatus: "pending",
      reviewCandidate: false,
      wouldArchive: false,
      blockReason: "missing_followback_ratio",
    };
  }

  if (!reliability.metricsReliable) {
    const performanceStatus = isBelowAutoArchiveThreshold(ratio) ? "bad" : ratio < 15 ? "avg" : "good";
    return {
      eligible: false,
      metricsReliable: false,
      followsSent,
      followbackRatio: ratio,
      performanceStatus,
      reviewCandidate: isBelowAutoArchiveThreshold(ratio),
      wouldArchive: false,
      blockReason: reliability.reason,
    };
  }

  if (isBelowAutoArchiveThreshold(ratio)) {
    return {
      eligible: true,
      metricsReliable: true,
      followsSent,
      followbackRatio: ratio,
      performanceStatus: "bad",
      reviewCandidate: true,
      wouldArchive: true,
      blockReason: null,
    };
  }

  if (ratio < 15) {
    return {
      eligible: false,
      metricsReliable: true,
      followsSent,
      followbackRatio: ratio,
      performanceStatus: "avg",
      reviewCandidate: false,
      wouldArchive: false,
      blockReason: "fbr_above_bad_threshold",
    };
  }

  return {
    eligible: false,
    metricsReliable: true,
    followsSent,
    followbackRatio: ratio,
    performanceStatus: "good",
    reviewCandidate: false,
    wouldArchive: false,
    blockReason: "fbr_good",
  };
}

export function shouldExecuteTargetAutoArchiveLowFbr(
  candidate: AutoArchiveCandidateEvaluation,
  flags: TargetAutoArchiveLowFbrFlags = targetAutoArchiveLowFbrFlags(),
) {
  if (!candidate.wouldArchive) return false;
  if (!candidate.metricsReliable) return false;
  if (!flags.enabled) return false;
  if (flags.dryRun) return false;
  return true;
}

function normalizeUsername(value: unknown) {
  return readString(value, "").trim().replace(/^@+/, "").toLowerCase();
}

function isArchivedRow(row: TargetReaddRow) {
  const status = readString(row.status, "").toLowerCase();
  return status === "archived" || Boolean(readString(row.archived_at, ""));
}

export function isPermanentAutoLowFbrReaddBlock(row: TargetReaddRow) {
  const archiveReason = readString(row.archive_reason, "");
  const blockReason = readString(row.readd_block_reason, "");
  if (archiveReason !== TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON
    && blockReason !== TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON) {
    return false;
  }
  if (row.readd_blocked_permanently === true) return true;
  if (blockReason === TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON) return true;
  return isArchivedRow(row) && archiveReason === TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON;
}

export function evaluateTargetReaddBlock(
  rows: TargetReaddRow[],
  targetUsername: string,
): TargetReaddBlockEvaluation {
  const normalized = normalizeUsername(targetUsername);
  if (!normalized) {
    return { blocked: false, reason: null, clientMessageFr: null, clientMessageEn: null };
  }

  const blockedRow = rows.find((row) => {
    const rowUsername = normalizeUsername(row.normalized_username ?? row.target_username);
    if (rowUsername !== normalized) return false;
    return isPermanentAutoLowFbrReaddBlock(row);
  });

  if (!blockedRow) {
    return { blocked: false, reason: null, clientMessageFr: null, clientMessageEn: null };
  }

  return {
    blocked: true,
    reason: TARGET_AUTO_ARCHIVE_READD_BLOCKED_AUDIT_REASON,
    clientMessageFr: "Ce compte cible a été mis de côté pour cette campagne.",
    clientMessageEn: "This target account has been set aside for this campaign.",
  };
}

export function targetAdminAutoArchiveLabel(item: {
  archiveReason?: string | null;
  autoArchivedAt?: string | null;
}): string | null {
  if (item.archiveReason === TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON) {
    return "Mis de côté automatiquement — FBR faible";
  }
  if (item.autoArchivedAt) {
    return "Archive automatique — rendement insuffisant";
  }
  return null;
}

export function clientSafeAutoArchiveDetailLabel(lang: "fr" | "en" = "fr") {
  return lang === "en"
    ? "Set aside after performance review"
    : "Mis de côté après analyse de performance";
}

export function shouldAllowAutoArchiveRestoreOverride(
  actorType: string,
  flags: TargetAutoArchiveLowFbrFlags = targetAutoArchiveLowFbrFlags(),
) {
  return actorType === "admin" && flags.allowAdminRestoreOverride;
}
