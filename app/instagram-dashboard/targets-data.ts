export type TargetHealthStatus = "good" | "monitor" | "poor" | "unknown" | "pending_source";
export type TargetQualityStatus =
  | "unknown"
  | "eligible"
  | "rejected_low_followers"
  | "rejected_verified"
  | "rejected_private"
  | "rejected_not_found"
  | "review_provider_unavailable"
  | "review_username_changed";
export type TargetSyncStatus = "synced" | "pending" | "failed" | "unknown";
export type TargetSourceStatusCode = "connected" | "pending" | "unknown";

export type TargetSafeRow = {
  target_id?: string;
  id: string;
  account_id: string;
  input_username?: string | null;
  normalized_username?: string | null;
  canonical_username?: string | null;
  target_username: string;
  status: string;
  verification_status?: string | null;
  verification_reason?: string | null;
  quality_status?: string | null;
  avatar_url?: string | null;
  source: string;
  actor_type?: string | null;
  rejected_reason?: string | null;
  batch_id?: string | null;
  provider_checked_at?: string | null;
  created_at: string;
  updated_at: string;
  followers_count?: number | null;
  is_verified?: boolean | null;
  is_private?: boolean | null;
  followback_ratio?: number | null;
  added_at?: string | null;
  deleted_at?: string | null;
  archived_at?: string | null;
};

export type TargetListFilter = "all" | "active" | "pending" | "rejected" | "archived";

export type TargetAccountItem = {
  id: string;
  accountId: string;
  targetUsername: string;
  canonicalUsername: string | null;
  status: string;
  verificationStatus: string;
  verificationReason: string | null;
  healthStatus: TargetHealthStatus;
  source: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  sourceLabel: string;
  statusLabel: string;
  qualityStatus: TargetQualityStatus;
  qualityLabel: string;
  fbrPercent: number | null;
  followsSent: number | null;
  followbacks: number | null;
  followersCount: number | null;
  isVerified: boolean | null;
  isPrivate: boolean | null;
  batchId: string | null;
  providerCheckedAt: string | null;
  lastUsedAt: string | null;
  actor: string | null;
  actorType: "client" | "admin" | "botapp" | "automation" | "system" | null;
  sourceSurface: "client_dashboard" | "admin_dashboard" | "botapp" | "backend" | "automation" | null;
  reason: string | null;
  syncStatus: TargetSyncStatus;
  archivedAt: string | null;
  deletedAt: string | null;
  auditEventId: string | null;
  isFutureMetricPending: boolean;
  isSyncPending: boolean;
};

export type TargetsSummary = {
  total: number;
  validEligible: number;
  pendingReview: number;
  rejected: number;
  pending: number;
  completed: number;
  failed: number;
  skipped: number;
  qualityPending: number;
  poorPerformanceCount: number;
  archivedCount: number;
  deletedCount: number;
  syncPendingCount: number;
};

export type TargetsSourceStatus = {
  targetsTable: TargetSourceStatusCode;
  qualityMetrics: TargetSourceStatusCode;
  validationSource: TargetSourceStatusCode;
  activityAudit: TargetSourceStatusCode;
  clientSync: TargetSourceStatusCode;
  botAppSync: TargetSourceStatusCode;
  archiveDeleteModel: TargetSourceStatusCode;
};

export type TargetsOverview = {
  items: TargetAccountItem[];
  summary: TargetsSummary;
  sourceStatus: TargetsSourceStatus;
};

export type TargetExportRow = {
  target_username: string;
  health: string;
  followers_count: number | null;
  followback_ratio: number | null;
  added_at: string;
};

export function isArchivedOrDeletedTarget(item: Pick<TargetAccountItem, "status" | "archivedAt" | "deletedAt">) {
  const status = item.status.toLowerCase();
  return status === "archived" || status === "deleted" || Boolean(item.archivedAt || item.deletedAt);
}

export function isValidEligibleTarget(item: Pick<TargetAccountItem, "status" | "qualityStatus" | "archivedAt" | "deletedAt">) {
  if (isArchivedOrDeletedTarget(item)) return false;
  const status = item.status.toLowerCase();
  return status === "valid" || status === "active" || item.qualityStatus === "eligible";
}

export function isPendingReviewTarget(item: Pick<TargetAccountItem, "status" | "qualityStatus" | "archivedAt" | "deletedAt">) {
  if (isArchivedOrDeletedTarget(item)) return false;
  const status = item.status.toLowerCase();
  return (
    status === "pending" ||
    status === "pending_verification" ||
    status === "review" ||
    item.qualityStatus === "unknown" ||
    item.qualityStatus.startsWith("review_")
  );
}

export function isRejectedTarget(item: Pick<TargetAccountItem, "status" | "qualityStatus" | "archivedAt" | "deletedAt">) {
  if (isArchivedOrDeletedTarget(item)) return false;
  const status = item.status.toLowerCase();
  return status === "rejected" || item.qualityStatus.startsWith("rejected_");
}

export function targetMatchesListFilter(item: TargetAccountItem, filter: TargetListFilter) {
  if (filter === "all") return true;
  if (filter === "active") return isValidEligibleTarget(item);
  if (filter === "pending") return isPendingReviewTarget(item);
  if (filter === "rejected") return isRejectedTarget(item);
  return isArchivedOrDeletedTarget(item);
}

export function targetStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "pending_verification") return "Pending verification";
  if (normalized === "valid") return "Valid";
  if (normalized === "rejected") return "Rejected";
  if (normalized === "review") return "Review";
  if (normalized === "duplicate") return "Duplicate";
  if (normalized === "pending") return "Pending";
  if (normalized === "completed") return "Completed";
  if (normalized === "failed") return "Failed";
  if (normalized === "skipped") return "Skipped";
  if (normalized === "active") return "Active";
  if (normalized === "paused") return "Paused";
  if (normalized === "archived") return "Archived";
  if (normalized === "filtered") return "Filtered";
  if (normalized === "deleted") return "Deleted";
  if (normalized === "poor_performance") return "Poor performance";
  return "Unknown";
}

export function targetSourceLabel(source: string) {
  const normalized = source.trim().toLowerCase();
  if (normalized === "manual_single") return "Manual single";
  if (normalized === "manual_bulk") return "Manual bulk";
  if (normalized === "admin") return "Admin";
  if (normalized === "client") return "Client";
  if (normalized === "future_discovery") return "Future discovery";
  if (normalized === "dashboard_manual") return "Manual add";
  if (normalized === "dashboard_bulk") return "Bulk import";
  if (normalized === "client_dashboard") return "Client dashboard";
  if (normalized === "admin_dashboard") return "Admin dashboard";
  if (normalized === "botapp") return "BotApp";
  if (normalized === "automation") return "Automation";
  if (normalized === "backend") return "Backend";
  return "Unknown source";
}

function countByStatus(items: TargetAccountItem[], status: string) {
  return items.filter((item) => item.status.toLowerCase() === status).length;
}

export function targetHealthFromFbr(fbrPercent: number | null): TargetHealthStatus {
  if (fbrPercent === null) return "pending_source";
  if (fbrPercent < 8) return "poor";
  if (fbrPercent < 13) return "monitor";
  return "good";
}

export function targetHealthLabel(healthStatus: TargetQualityStatus | TargetHealthStatus) {
  if (healthStatus === "eligible") return "Eligible";
  if (healthStatus === "rejected_low_followers") return "Low followers";
  if (healthStatus === "rejected_verified") return "Verified";
  if (healthStatus === "rejected_private") return "Private";
  if (healthStatus === "rejected_not_found") return "Not found";
  if (healthStatus === "review_provider_unavailable") return "Review provider";
  if (healthStatus === "review_username_changed") return "Username changed";
  if (healthStatus === "poor") return "Poor";
  if (healthStatus === "monitor") return "Monitor";
  if (healthStatus === "good") return "Good";
  return "Quality pending";
}

export function targetHealthHelper(healthStatus: TargetQualityStatus | TargetHealthStatus) {
  if (healthStatus === "eligible") return "Target passed CT quality V1";
  if (healthStatus === "rejected_low_followers") return "Follower count is below 500";
  if (healthStatus === "rejected_verified") return "Verified profiles are rejected in CT quality V1";
  if (healthStatus === "rejected_private") return "Private profiles are rejected in CT quality V1";
  if (healthStatus === "rejected_not_found") return "Provider returned a clear not_found";
  if (healthStatus === "review_provider_unavailable") return "Provider was unavailable or rate limited; never permanently reject";
  if (healthStatus === "review_username_changed") return "Canonical username differs from submitted username";
  if (healthStatus === "poor") return "Followback ratio below 8%";
  if (healthStatus === "monitor") return "Followback ratio between 8% and 12%";
  if (healthStatus === "good") return "Followback ratio 13% or higher";
  return "Quality V1 pending. FBR remains a future performance metric after CT usage.";
}

export function targetFbrLabel(fbrPercent: number | null) {
  if (fbrPercent === null) return "Performance pending";
  return `${new Intl.NumberFormat("en").format(fbrPercent)}%`;
}

export function targetFbrHelper(fbrPercent: number | null) {
  if (fbrPercent === null) return "FBR is future performance: followers gained divided by follows sent from this CT.";
  return "FBR performance after this CT has been used.";
}

export function mapTargetRow(row: TargetSafeRow): TargetAccountItem {
  const followersCount = typeof row.followers_count === "number" ? row.followers_count : null;
  const fbrPercent = typeof row.followback_ratio === "number" ? row.followback_ratio : null;
  const addedAt = row.added_at || row.created_at;
  const deletedAt = row.deleted_at ?? null;
  const archivedAt = row.archived_at ?? null;
  const qualityStatus = (row.quality_status || "unknown") as TargetQualityStatus;
  const healthStatus = qualityStatus !== "unknown" ? (qualityStatus === "eligible" ? "good" : qualityStatus.startsWith("review_") ? "monitor" : "poor") : targetHealthFromFbr(fbrPercent);

  return {
    id: row.target_id || row.id,
    accountId: row.account_id,
    targetUsername: row.normalized_username || row.target_username,
    canonicalUsername: row.canonical_username ?? null,
    status: row.status || "unknown",
    verificationStatus: row.verification_status || "pending",
    verificationReason: row.verification_reason ?? null,
    healthStatus,
    source: row.source || "unknown",
    avatarUrl: row.avatar_url ?? null,
    createdAt: addedAt,
    updatedAt: row.updated_at,
    sourceLabel: targetSourceLabel(row.source || "unknown"),
    statusLabel: targetStatusLabel(row.status || "unknown"),
    qualityStatus,
    qualityLabel: targetHealthLabel(qualityStatus),
    fbrPercent,
    followsSent: null,
    followbacks: null,
    followersCount,
    isVerified: typeof row.is_verified === "boolean" ? row.is_verified : null,
    isPrivate: typeof row.is_private === "boolean" ? row.is_private : null,
    batchId: row.batch_id ?? null,
    providerCheckedAt: row.provider_checked_at ?? null,
    lastUsedAt: null,
    actor: null,
    actorType: null,
    sourceSurface: null,
    reason: row.rejected_reason || row.verification_reason || null,
    syncStatus: "unknown",
    archivedAt,
    deletedAt,
    auditEventId: null,
    isFutureMetricPending: row.verification_status !== "found" || fbrPercent === null,
    isSyncPending: row.status === "pending_verification",
  };
}

export function buildTargetsOverview(rows: TargetSafeRow[]): TargetsOverview {
  const items = rows.map(mapTargetRow);
  const validEligible = items.filter(isValidEligibleTarget).length;
  const pendingReview = items.filter(isPendingReviewTarget).length;
  const rejected = items.filter(isRejectedTarget).length;
  const archivedCount = items.filter((item) => item.archivedAt || item.status === "archived").length;
  const deletedCount = items.filter((item) => item.deletedAt || item.status === "deleted").length;

  // TODO: Future CT sync model must keep backend DB, admin dashboard, client dashboard,
  // and BotApp/Mac app consistent for add, archive, delete, restore, pause, reactivate,
  // and filter actions. Archive should preserve history; delete should be audited and
  // preferably soft-deleted unless hard-delete is explicitly approved.
  // TODO: Future Source Quality should connect FBR, follows sent, followbacks,
  // followers count, poor performance flags, last used, actor/reason, sync status,
  // and audit event ids without exposing raw metadata or internal sync payloads.
  // TODO: Future validate_target_account(username) / Target Discovery service must
  // verify Instagram existence, follower count, 500-50000 eligibility, deleted/archived
  // restore rules, blacklist/filter state, and duplicates before client inserts.
  // TODO: Future Activity Log should record add, bulk add, delete, archive, restore,
  // pause, reactivate, reset, import/export, and relevant refresh actions as safe events.

  return {
    items,
    summary: {
      total: items.length,
      validEligible,
      pendingReview,
      rejected,
      pending: countByStatus(items, "pending") + countByStatus(items, "pending_verification"),
      completed: countByStatus(items, "completed"),
      failed: countByStatus(items, "failed") + countByStatus(items, "rejected"),
      skipped: countByStatus(items, "skipped"),
      qualityPending: items.filter((item) => item.isFutureMetricPending).length,
      poorPerformanceCount: items.filter((item) => item.healthStatus === "poor").length,
      archivedCount,
      deletedCount,
      syncPendingCount: items.filter((item) => item.isSyncPending).length,
    },
    sourceStatus: {
      targetsTable: "connected",
      qualityMetrics: "pending",
      validationSource: "pending",
      activityAudit: "pending",
      clientSync: "pending",
      botAppSync: "pending",
      archiveDeleteModel: "pending",
    },
  };
}

export function safeTargetExportRows(items: TargetAccountItem[]): TargetExportRow[] {
  return items.map((item) => ({
    target_username: item.targetUsername,
    health: item.qualityLabel,
    followers_count: item.followersCount,
    followback_ratio: item.fbrPercent,
    added_at: item.createdAt,
  }));
}
