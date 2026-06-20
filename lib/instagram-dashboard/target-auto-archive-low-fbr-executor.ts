import { createSupabaseClient } from "@/lib/supabase";
import { readString } from "@/lib/instagram-client/guards";
import {
  TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON,
  TARGET_AUTO_ARCHIVE_LOW_FBR_AUDIT_OPERATION,
  TARGET_AUTO_ARCHIVE_READD_BLOCKED_AUDIT_REASON,
  classifyLowFbrPerformance,
  shouldExecuteTargetAutoArchiveLowFbr,
  targetAutoArchiveLowFbrFlags,
  type AutoArchiveCandidateEvaluation,
} from "./target-auto-archive-low-fbr-policy";

type SupabaseRecord = Record<string, unknown>;

export type TargetAutoArchiveBatchItem = {
  targetId: string;
  accountId: string;
  targetUsername: string;
  evaluation: AutoArchiveCandidateEvaluation;
};

export type TargetAutoArchiveBatchResult = {
  scanned: number;
  targets_skipped_unreliable: number;
  targets_skipped_under_minimum: number;
  targets_qualified: number;
  targets_archived: number;
  targets_readd_blocked: number;
  errors: number;
  dryRun: boolean;
  enabled: boolean;
  items: TargetAutoArchiveBatchItem[];
};

export type TargetAutoArchiveGlobalResult = TargetAutoArchiveBatchResult;

function emptyBatchResult(flags: ReturnType<typeof targetAutoArchiveLowFbrFlags>): TargetAutoArchiveBatchResult {
  return {
    scanned: 0,
    targets_skipped_unreliable: 0,
    targets_skipped_under_minimum: 0,
    targets_qualified: 0,
    targets_archived: 0,
    targets_readd_blocked: 0,
    errors: 0,
    dryRun: flags.dryRun,
    enabled: flags.enabled,
    items: [],
  };
}

function mergeBatchResults(
  left: TargetAutoArchiveBatchResult,
  right: TargetAutoArchiveBatchResult,
): TargetAutoArchiveBatchResult {
  return {
    scanned: left.scanned + right.scanned,
    targets_skipped_unreliable: left.targets_skipped_unreliable + right.targets_skipped_unreliable,
    targets_skipped_under_minimum: left.targets_skipped_under_minimum + right.targets_skipped_under_minimum,
    targets_qualified: left.targets_qualified + right.targets_qualified,
    targets_archived: left.targets_archived + right.targets_archived,
    targets_readd_blocked: left.targets_readd_blocked + right.targets_readd_blocked,
    errors: left.errors + right.errors,
    dryRun: right.dryRun,
    enabled: right.enabled,
    items: [...left.items, ...right.items],
  };
}

async function tryRecordAutoArchiveAudit(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    accountId: string;
    targetId: string;
    operation: string;
    result: "review" | "archived" | "skipped_unreliable" | "readd_blocked";
    reason: string;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await supabase.from("ct_target_audit_events").insert({
      account_id: input.accountId,
      target_id: input.targetId,
      operation: input.operation,
      result: input.result === "archived" ? "archived" : input.result === "readd_blocked" ? "rejected" : "review",
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

export async function runTargetAutoArchiveLowFbrPolicyBatch(input: {
  accountId?: string;
  offset?: number;
  limit?: number;
} = {}): Promise<TargetAutoArchiveBatchResult> {
  const flags = targetAutoArchiveLowFbrFlags();
  const supabase = createSupabaseClient();
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit ?? 500)), 1), 1000);
  const offset = Math.max(Math.trunc(Number(input.offset ?? 0)), 0);

  let query = supabase
    .from("ig_targets")
    .select("id,account_id,normalized_username,target_username,status,quality_status,follows_sent_count,followbacks_count,followback_ratio,followbacks_metrics_reliable_at,metrics_updated_at,archive_reason,readd_blocked_permanently")
    .eq("quality_status", "eligible")
    .neq("status", "archived")
    .neq("status", "deleted")
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (input.accountId) {
    query = query.eq("account_id", input.accountId.trim());
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as SupabaseRecord[];
  const result = emptyBatchResult(flags);

  for (const row of rows) {
    result.scanned += 1;
    const evaluation = classifyLowFbrPerformance(
      row as SupabaseRecord,
      readString(row.quality_status, "unknown"),
    );

    if (evaluation.blockReason === "insufficient_follow_volume") {
      result.targets_skipped_under_minimum += 1;
    }

    if (!evaluation.wouldArchive) {
      if (evaluation.reviewCandidate && !evaluation.metricsReliable) {
        result.targets_skipped_unreliable += 1;
      }
      continue;
    }

    result.targets_qualified += 1;
    const targetId = readString(row.id, "");
    const accountId = readString(row.account_id, "");
    const targetUsername = readString(row.normalized_username, readString(row.target_username, ""));
    result.items.push({ targetId, accountId, targetUsername, evaluation });

    if (!shouldExecuteTargetAutoArchiveLowFbr(evaluation, flags)) {
      if (flags.dryRun || !flags.enabled || !evaluation.metricsReliable) {
        await tryRecordAutoArchiveAudit(supabase, {
          accountId,
          targetId,
          operation: TARGET_AUTO_ARCHIVE_LOW_FBR_AUDIT_OPERATION,
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
        readd_blocked_until: null,
        readd_blocked_permanently: true,
        readd_block_reason: TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON,
        readd_blocked_at: now,
        updated_at: now,
      })
      .eq("id", targetId)
      .eq("account_id", accountId)
      .neq("status", "archived");

    if (updateError) {
      result.errors += 1;
      continue;
    }

    result.targets_archived += 1;
    result.targets_readd_blocked += 1;
    await tryRecordAutoArchiveAudit(supabase, {
      accountId,
      targetId,
      operation: TARGET_AUTO_ARCHIVE_LOW_FBR_AUDIT_OPERATION,
      result: "archived",
      reason: TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON,
      metadata: {
        follows_sent_count: evaluation.followsSent,
        followback_ratio: evaluation.followbackRatio,
      },
    });
    await tryRecordAutoArchiveAudit(supabase, {
      accountId,
      targetId,
      operation: TARGET_AUTO_ARCHIVE_READD_BLOCKED_AUDIT_REASON,
      result: "readd_blocked",
      reason: TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON,
      metadata: {
        permanent: true,
        follows_sent_count: evaluation.followsSent,
        followback_ratio: evaluation.followbackRatio,
      },
    });
  }

  return result;
}

export async function runTargetAutoArchiveLowFbrPolicyGlobal(input: {
  accountId?: string;
  batchSize?: number;
} = {}): Promise<TargetAutoArchiveGlobalResult> {
  const batchSize = Math.min(Math.max(Math.trunc(Number(input.batchSize ?? 500)), 1), 1000);
  let offset = 0;
  let aggregate = emptyBatchResult(targetAutoArchiveLowFbrFlags());

  while (true) {
    const batch = await runTargetAutoArchiveLowFbrPolicyBatch({
      accountId: input.accountId,
      offset,
      limit: batchSize,
    });
    aggregate = mergeBatchResults(aggregate, batch);
    if (batch.scanned < batchSize) break;
    offset += batchSize;
  }

  return aggregate;
}

/** @deprecated Use runTargetAutoArchiveLowFbrPolicyGlobal */
export async function runTargetAutoArchiveLowFbrPolicy(input: {
  accountId?: string;
  limit?: number;
} = {}) {
  const batch = await runTargetAutoArchiveLowFbrPolicyBatch({
    accountId: input.accountId,
    limit: input.limit,
  });
  return {
    scanned: batch.scanned,
    candidates: batch.items.length,
    wouldArchive: batch.targets_qualified,
    archived: batch.targets_archived,
    skippedUnreliable: batch.targets_skipped_unreliable,
    dryRun: batch.dryRun,
    enabled: batch.enabled,
    items: batch.items,
  };
}
