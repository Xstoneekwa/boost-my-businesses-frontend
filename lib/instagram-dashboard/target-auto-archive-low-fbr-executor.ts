import { createSupabaseClient } from "@/lib/supabase";
import { readString } from "@/lib/instagram-client/guards";
import {
  TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON,
  TARGET_AUTO_ARCHIVE_LOW_FBR_AUDIT_OPERATION,
  classifyLowFbrPerformance,
  computeTargetReaddBlockedUntil,
  shouldExecuteTargetAutoArchiveLowFbr,
  targetAutoArchiveLowFbrFlags,
  type AutoArchiveCandidateEvaluation,
} from "./target-auto-archive-low-fbr-policy";

type SupabaseRecord = Record<string, unknown>;

export type TargetAutoArchiveDryRunResult = {
  scanned: number;
  candidates: number;
  wouldArchive: number;
  archived: number;
  skippedUnreliable: number;
  dryRun: boolean;
  enabled: boolean;
  items: Array<{
    targetId: string;
    accountId: string;
    targetUsername: string;
    evaluation: AutoArchiveCandidateEvaluation;
  }>;
};

async function tryRecordAutoArchiveAudit(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    accountId: string;
    targetId: string;
    result: "review" | "archived" | "skipped_unreliable";
    reason: string;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await supabase.from("ct_target_audit_events").insert({
      account_id: input.accountId,
      target_id: input.targetId,
      operation: TARGET_AUTO_ARCHIVE_LOW_FBR_AUDIT_OPERATION,
      result: input.result === "archived" ? "archived" : "review",
      reason: input.reason,
      actor_type: "system",
      metadata_safe: {
        source_surface: "auto_performance_policy",
        policy: "low_followback_ratio",
        ...(input.metadata ?? {}),
      },
    });
  } catch {
    // Best-effort audit only.
  }
}

export async function runTargetAutoArchiveLowFbrPolicy(input: {
  accountId?: string;
  limit?: number;
} = {}): Promise<TargetAutoArchiveDryRunResult> {
  const flags = targetAutoArchiveLowFbrFlags();
  const supabase = createSupabaseClient();
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit ?? 200)), 1), 1000);

  let query = supabase
    .from("ig_targets")
    .select("id,account_id,normalized_username,target_username,status,quality_status,follows_sent_count,followbacks_count,followback_ratio,followbacks_metrics_reliable_at,metrics_updated_at")
    .neq("status", "archived")
    .neq("status", "deleted")
    .order("follows_sent_count", { ascending: false })
    .limit(limit);

  if (input.accountId) {
    query = query.eq("account_id", input.accountId.trim());
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as SupabaseRecord[];
  const items: TargetAutoArchiveDryRunResult["items"] = [];
  let wouldArchive = 0;
  let archived = 0;
  let skippedUnreliable = 0;

  for (const row of rows) {
    const evaluation = classifyLowFbrPerformance(
      row as SupabaseRecord,
      readString(row.quality_status, "unknown"),
    );
    if (!evaluation.wouldArchive) {
      if (evaluation.reviewCandidate && !evaluation.metricsReliable) skippedUnreliable += 1;
      continue;
    }

    wouldArchive += 1;
    const targetId = readString(row.id, "");
    const accountId = readString(row.account_id, "");
    const targetUsername = readString(row.normalized_username, readString(row.target_username, ""));
    items.push({ targetId, accountId, targetUsername, evaluation });

    if (!shouldExecuteTargetAutoArchiveLowFbr(evaluation, flags)) {
      if (flags.dryRun || !flags.enabled || !evaluation.metricsReliable) {
        await tryRecordAutoArchiveAudit(supabase, {
          accountId,
          targetId,
          result: evaluation.metricsReliable ? "review" : "skipped_unreliable",
          reason: evaluation.metricsReliable ? "dry_run_candidate" : (evaluation.blockReason ?? "metrics_unreliable"),
          metadata: {
            dry_run: flags.dryRun,
            enabled: flags.enabled,
            follows_sent_count: evaluation.followsSent,
            followback_ratio: evaluation.followbackRatio,
          },
        });
      }
      continue;
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("ig_targets")
      .update({
        status: "archived",
        archived_at: now,
        auto_archived_at: now,
        archive_reason: TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON,
        readd_blocked_until: computeTargetReaddBlockedUntil(new Date(now)),
        updated_at: now,
      })
      .eq("id", targetId)
      .eq("account_id", accountId);

    if (updateError) continue;

    archived += 1;
    await tryRecordAutoArchiveAudit(supabase, {
      accountId,
      targetId,
      result: "archived",
      reason: TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON,
      metadata: {
        follows_sent_count: evaluation.followsSent,
        followback_ratio: evaluation.followbackRatio,
      },
    });
  }

  return {
    scanned: rows.length,
    candidates: items.length,
    wouldArchive,
    archived,
    skippedUnreliable,
    dryRun: flags.dryRun,
    enabled: flags.enabled,
    items,
  };
}
