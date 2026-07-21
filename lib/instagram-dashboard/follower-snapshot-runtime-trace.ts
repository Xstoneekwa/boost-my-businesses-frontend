import { createHash } from "node:crypto";
import { createSupabaseClient } from "../supabase.ts";

type SupabaseClient = ReturnType<typeof createSupabaseClient>;

export type FollowerCollectorAccountTrace = {
  accountId: string;
  accountUsername: string;
  attemptedAt: string;
  status: "succeeded" | "failed" | "skipped";
  followersCount: number | null;
  provider: string | null;
  failureReason: string | null;
  providerStatus?: string | number | null;
  snapshotWritten: boolean;
  snapshotTimestamp: string | null;
};

export type FollowerCollectorRunTrace = {
  collectorRunId: string;
  scheduledAt: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "succeeded" | "partial" | "failed";
  accountsSelected: number;
  accountsSucceeded: number;
  accountsFailed: number;
  accountsSkipped: number;
  provider: string;
  failureReason: string | null;
};

export type FollowerCollectorTraceWriter = {
  writeRun(input: FollowerCollectorRunTrace): Promise<void>;
  writeAccount(collectorRunId: string, input: FollowerCollectorAccountTrace): Promise<void>;
};

export type FollowerCollectorTriggerContext = {
  triggerSource: "scheduled_cron" | "manual_validation";
  requestedBy: "vercel_cron" | "controlled_review";
  requestedDeploymentSha: string | null;
};

function stableUuid(seed: string) {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function followerCollectorRunId(scheduledAt: string) {
  return stableUuid(`follower-snapshot-collector:${new Date(scheduledAt).toISOString()}`);
}

export function followerCollectorScheduledAt(now: Date) {
  return `${now.toISOString().slice(0, 10)}T00:30:00.000Z`;
}

export function sanitizeFollowerCollectorFailureReason(value: unknown) {
  const text = String(value ?? "unknown_failure")
    .replace(/https?:\/\/\S+/gi, "[redacted_url]")
    .replace(/(authorization|apikey|token|password|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  return (text || "unknown_failure").slice(0, 240);
}

function deploymentMetadata() {
  return {
    deployment_id: process.env.VERCEL_DEPLOYMENT_ID || null,
    deployment_url: process.env.VERCEL_URL || null,
    git_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
  };
}

async function upsertRuntimeEvent(supabase: SupabaseClient, row: Record<string, unknown>) {
  const { error } = await supabase.from("runtime_events").upsert(row, { onConflict: "id" });
  if (error) throw new Error(`follower_collector_trace_failed:${sanitizeFollowerCollectorFailureReason(error.message)}`);
}

export function createFollowerCollectorTraceWriter(
  supabase: SupabaseClient = createSupabaseClient(),
  context: FollowerCollectorTriggerContext = {
    triggerSource: "scheduled_cron",
    requestedBy: "vercel_cron",
    requestedDeploymentSha: null,
  },
): FollowerCollectorTraceWriter {
  return {
    async writeRun(input) {
      const failureReason = input.failureReason
        ? sanitizeFollowerCollectorFailureReason(input.failureReason)
        : null;
      await upsertRuntimeEvent(supabase, {
        id: stableUuid(`follower-snapshot-collector-run-event:${input.collectorRunId}`),
        job_id: input.collectorRunId,
        account_id: null,
        event_type: "follower_snapshot_collector_run",
        source: "follower_snapshot_collector",
        severity: input.status === "failed" || input.status === "partial" ? "warning" : "info",
        visibility: "admin_only",
        reason: failureReason || input.status,
        message: `Follower snapshot collector ${input.status}`,
        metadata: {
          collector_run_id: input.collectorRunId,
          scheduled_at: input.scheduledAt,
          started_at: input.startedAt,
          completed_at: input.completedAt,
          status: input.status,
          accounts_selected: input.accountsSelected,
          accounts_succeeded: input.accountsSucceeded,
          accounts_failed: input.accountsFailed,
          accounts_skipped: input.accountsSkipped,
          provider: input.provider,
          failure_reason: failureReason,
          trigger_source: context.triggerSource,
          requested_by: context.requestedBy,
          requested_deployment_sha: context.requestedDeploymentSha,
          ...deploymentMetadata(),
        },
      });
    },

    async writeAccount(collectorRunId, input) {
      const failureReason = input.failureReason
        ? sanitizeFollowerCollectorFailureReason(input.failureReason)
        : null;
      await upsertRuntimeEvent(supabase, {
        id: stableUuid(`follower-snapshot-collector-account-event:${collectorRunId}:${input.accountId}`),
        job_id: collectorRunId,
        account_id: input.accountId,
        event_type: "follower_snapshot_collector_account",
        source: "follower_snapshot_collector",
        severity: input.status === "failed" ? "warning" : "info",
        visibility: "admin_only",
        reason: failureReason || input.status,
        message: `Follower snapshot account ${input.status}`,
        metadata: {
          collector_run_id: collectorRunId,
          account_id: input.accountId,
          account_username: input.accountUsername,
          attempted_at: input.attemptedAt,
          status: input.status,
          followers_count: input.followersCount,
          provider: input.provider,
          sanitized_failure_reason: failureReason,
          provider_status: input.providerStatus ?? null,
          snapshot_written: input.snapshotWritten,
          snapshot_timestamp: input.snapshotTimestamp,
          trigger_source: context.triggerSource,
          requested_by: context.requestedBy,
          requested_deployment_sha: context.requestedDeploymentSha,
          ...deploymentMetadata(),
        },
      });
    },
  };
}
