export type TargetQualityStatus = "good" | "monitor" | "poor" | "unknown" | "pending_source";
export type TargetSyncStatus = "synced" | "pending" | "failed" | "unknown";
export type TargetSourceStatusCode = "connected" | "pending" | "unknown";

export type TargetSafeRow = {
  id: string;
  account_id: string;
  target_username: string;
  status: string;
  source: string;
  created_at: string;
  updated_at: string;
  followers_count?: number | null;
  followback_ratio?: number | null;
  added_at?: string | null;
  deleted_at?: string | null;
  archived_at?: string | null;
};

export type TargetAccountItem = {
  id: string;
  accountId: string;
  targetUsername: string;
  status: string;
  healthStatus: TargetQualityStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
  sourceLabel: string;
  statusLabel: string;
  qualityStatus: TargetQualityStatus;
  fbrPercent: number | null;
  followsSent: number | null;
  followbacks: number | null;
  followersCount: number | null;
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

export function targetStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase();
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

export function targetHealthFromFbr(fbrPercent: number | null): TargetQualityStatus {
  if (fbrPercent === null) return "pending_source";
  if (fbrPercent < 8) return "poor";
  if (fbrPercent < 13) return "monitor";
  return "good";
}

export function targetHealthLabel(healthStatus: TargetQualityStatus) {
  if (healthStatus === "poor") return "Poor";
  if (healthStatus === "monitor") return "Monitor";
  if (healthStatus === "good") return "Good";
  return "Pending source";
}

export function targetHealthHelper(healthStatus: TargetQualityStatus) {
  if (healthStatus === "poor") return "Followback ratio below 8%";
  if (healthStatus === "monitor") return "Followback ratio between 8% and 12%";
  if (healthStatus === "good") return "Followback ratio 13% or higher";
  return "Followback ratio source is not connected yet";
}

export function mapTargetRow(row: TargetSafeRow): TargetAccountItem {
  const followersCount = typeof row.followers_count === "number" ? row.followers_count : null;
  const fbrPercent = typeof row.followback_ratio === "number" ? row.followback_ratio : null;
  const addedAt = row.added_at || row.created_at;
  const deletedAt = row.deleted_at ?? null;
  const archivedAt = row.archived_at ?? null;
  const healthStatus = targetHealthFromFbr(fbrPercent);

  return {
    id: row.id,
    accountId: row.account_id,
    targetUsername: row.target_username,
    status: row.status || "unknown",
    healthStatus,
    source: row.source || "unknown",
    createdAt: addedAt,
    updatedAt: row.updated_at,
    sourceLabel: targetSourceLabel(row.source || "unknown"),
    statusLabel: targetStatusLabel(row.status || "unknown"),
    qualityStatus: healthStatus,
    fbrPercent,
    followsSent: null,
    followbacks: null,
    followersCount,
    lastUsedAt: null,
    actor: null,
    actorType: null,
    sourceSurface: null,
    reason: null,
    syncStatus: "unknown",
    archivedAt,
    deletedAt,
    auditEventId: null,
    isFutureMetricPending: followersCount === null || fbrPercent === null,
    isSyncPending: true,
  };
}

export function buildTargetsOverview(rows: TargetSafeRow[]): TargetsOverview {
  const items = rows.map(mapTargetRow);

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
      pending: countByStatus(items, "pending"),
      completed: countByStatus(items, "completed"),
      failed: countByStatus(items, "failed"),
      skipped: countByStatus(items, "skipped"),
      qualityPending: items.filter((item) => item.isFutureMetricPending).length,
      poorPerformanceCount: items.filter((item) => item.qualityStatus === "poor").length,
      archivedCount: items.filter((item) => item.archivedAt || item.status === "archived").length,
      deletedCount: items.filter((item) => item.deletedAt || item.status === "deleted").length,
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
    health: targetHealthLabel(item.healthStatus),
    followers_count: item.followersCount,
    followback_ratio: item.fbrPercent,
    added_at: item.createdAt,
  }));
}
