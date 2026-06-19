import type { SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";
import { safeInstagramPublicAvatarUrl } from "@/lib/instagram-public-profile-lookup";
import { targetFbrBotAppLabel } from "@/lib/instagram-dashboard/target-fbr-metrics";
import { safeTargetRow as projectSharedTargetRow } from "@/lib/instagram-dashboard/targets-service";

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readStoredFollowbackRatio(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function projectProfileDetailsTargetRow(row: SupabaseRecord, job: SupabaseRecord | null = null) {
  const metrics = projectSharedTargetRow(row);
  const id = readString(row.id, "");
  const rawAvatarUrl = readString(row.avatar_url, readString(row.profile_picture_url, readString(row.profile_image_url, "")));
  const avatarUrl = id && safeInstagramPublicAvatarUrl(rawAvatarUrl)
    ? `/api/instagram-dashboard/avatar?kind=target&id=${encodeURIComponent(id)}`
    : null;
  const fbrMetricsReliable = metrics.fbrMetricsReliable ?? Boolean(metrics.followbacks_metrics_reliable_at);
  const followsSentCount = metrics.follows_sent_count ?? metrics.followsSent ?? null;
  const fbrPercent = metrics.fbrPercent ?? metrics.followback_ratio ?? null;
  const followbackRatioDb = readStoredFollowbackRatio(row.followback_ratio);

  return {
    id,
    account_id: readString(row.account_id, ""),
    target_username: readString(row.target_username, readString(row.normalized_username, "")),
    normalized_username: readString(row.normalized_username, ""),
    display_name: readString(row.display_name, ""),
    avatar_url: avatarUrl || null,
    avatar_source: avatarUrl ? "dashboard_avatar_proxy" : "not_available",
    avatar_last_checked_at: readString(row.provider_checked_at, readString(row.avatar_last_checked_at, "")) || null,
    status: readString(row.status, "unknown"),
    quality_status: readString(row.quality_status, "unknown"),
    verification_status: readString(row.verification_status, "pending"),
    verification_reason: readString(row.verification_reason, "") || null,
    source: readString(row.source, "unknown"),
    followers_count: row.followers_count ?? null,
    is_private: typeof row.is_private === "boolean" ? row.is_private : null,
    is_verified: typeof row.is_verified === "boolean" ? row.is_verified : null,
    followbacks_count: metrics.followbacks_count ?? null,
    follows_sent_count: followsSentCount,
    followback_ratio: fbrMetricsReliable ? fbrPercent : null,
    followback_ratio_db: followbackRatioDb,
    fbrMetricsReliable,
    followbacks_metrics_reliable_at: metrics.followbacks_metrics_reliable_at ?? null,
    fbrPercent,
    followbacksCount: metrics.followbacks_count ?? null,
    followsSentCount,
    fbrLabel: targetFbrBotAppLabel(fbrPercent, followsSentCount, fbrMetricsReliable),
    performance_status: metrics.performance_status ?? (readString(row.performance_status, "") || null),
    archived_at: readString(row.archived_at, "") || null,
    deleted_at: readString(row.deleted_at, "") || null,
    last_used_at: readString(row.last_used_at, "") || null,
    last_selected_at: readString(row.last_selected_at, "") || null,
    last_successful_candidate_at: readString(row.last_successful_candidate_at, "") || null,
    last_exhausted_at: readString(row.last_exhausted_at, "") || null,
    exhaustion_reason: readString(row.exhaustion_reason, "") || null,
    cooldown_until: readString(row.cooldown_until, "") || null,
    metrics_updated_at: readString(row.metrics_updated_at, "") || null,
    rejected_reason: readString(row.rejected_reason, "") || null,
    rejection_reason: readString(row.rejected_reason, "") || null,
    batch_id: readString(row.batch_id, "") || null,
    provider_checked_at: readString(row.provider_checked_at, "") || null,
    last_verified_at: readString(row.provider_checked_at, "") || null,
    job_status: readString(job?.status, "") || null,
    job_provider_status: readString(job?.provider_status, "") || null,
    job_attempt_count: job?.attempt_count ?? null,
    job_next_attempt_at: readString(job?.next_attempt_at, "") || null,
    job_last_error_code: readString(job?.last_error_code, "") || null,
    updated_at: readString(row.updated_at, "") || null,
  };
}
