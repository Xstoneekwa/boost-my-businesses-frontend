import {
  pendingTargetVerificationDecision,
  type TargetQualityStatus,
  type TargetVerificationDecision,
} from "./instagram-targets.ts";

export const CT_RESTORE_ELIGIBLE_FRESH_DAYS = 30;

export type TargetLifecycleActorType = "admin" | "client" | "system";
export type TargetLifecycleSourceSurface = "admin_dashboard" | "client_dashboard" | "botapp" | "backend" | "automation";

export type TargetLifecycleRow = {
  id?: string | null;
  target_id?: string | null;
  account_id?: string | null;
  normalized_username?: string | null;
  target_username?: string | null;
  status?: string | null;
  verification_status?: string | null;
  verification_reason?: string | null;
  quality_status?: TargetQualityStatus | string | null;
  archived_at?: string | null;
  deleted_at?: string | null;
  provider_checked_at?: string | null;
  followback_ratio?: number | null;
  fbr_percent?: number | null;
};

export type TargetRestoreLifecycleDecision = {
  targetPatch: {
    status: TargetVerificationDecision["status"];
    verification_status: TargetVerificationDecision["verification_status"];
    verification_reason: string;
    quality_status: TargetVerificationDecision["quality_status"];
    rejected_reason: string | null;
    archived_at: null;
    archive_reason: null;
    updated_at: string;
  };
  shouldQueueVerification: boolean;
  auditReason: string;
};

export function normalizeLifecycleUsername(row: TargetLifecycleRow) {
  return (row.normalized_username || row.target_username || "").trim().toLowerCase();
}

export function isArchivedTargetLifecycle(row: TargetLifecycleRow) {
  return (row.status || "").toLowerCase() === "archived" || Boolean(row.archived_at);
}

export function isDeletedTargetLifecycle(row: TargetLifecycleRow) {
  return (row.status || "").toLowerCase() === "deleted" || Boolean(row.deleted_at);
}

export function isActiveTargetLifecycle(row: TargetLifecycleRow) {
  return !isArchivedTargetLifecycle(row) && !isDeletedTargetLifecycle(row);
}

export function isRestoreQualityFresh(row: TargetLifecycleRow, now: Date) {
  if (row.quality_status !== "eligible" || row.verification_status !== "found") return false;
  if (!row.provider_checked_at) return false;

  const checkedAt = new Date(row.provider_checked_at);
  if (Number.isNaN(checkedAt.getTime())) return false;
  const ageMs = now.getTime() - checkedAt.getTime();
  return ageMs >= 0 && ageMs <= CT_RESTORE_ELIGIBLE_FRESH_DAYS * 24 * 60 * 60 * 1000;
}

export function buildRestoreLifecycleDecision(row: TargetLifecycleRow, now: Date): TargetRestoreLifecycleDecision {
  const updatedAt = now.toISOString();
  if (isRestoreQualityFresh(row, now)) {
    return {
      targetPatch: {
        status: "valid",
        verification_status: "found",
        verification_reason: "manual_restore_quality_fresh",
        quality_status: "eligible",
        rejected_reason: null,
        archived_at: null,
        archive_reason: null,
        updated_at: updatedAt,
      },
      shouldQueueVerification: false,
      auditReason: "manual_restore_quality_fresh",
    };
  }

  const pending = pendingTargetVerificationDecision("manual_restore_reverification_required");
  return {
    targetPatch: {
      status: pending.status,
      verification_status: pending.verification_status,
      verification_reason: pending.verification_reason,
      quality_status: pending.quality_status,
      rejected_reason: null,
      archived_at: null,
      archive_reason: null,
      updated_at: updatedAt,
    },
    shouldQueueVerification: true,
    auditReason: "manual_restore_reverification_required",
  };
}

export function hasActiveDuplicateForRestore(row: TargetLifecycleRow, candidates: TargetLifecycleRow[]) {
  const targetId = row.id || row.target_id || "";
  const username = normalizeLifecycleUsername(row);
  if (!username) return false;

  return candidates.some((candidate) => {
    const candidateId = candidate.id || candidate.target_id || "";
    return candidateId !== targetId && isActiveTargetLifecycle(candidate) && normalizeLifecycleUsername(candidate) === username;
  });
}
