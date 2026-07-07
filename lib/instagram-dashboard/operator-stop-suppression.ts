import { deriveSessionTransitionTimestamps } from "./session-transition-buffer.ts";

export const OPERATOR_STOP_SUPPRESSED_REASON = "operator_stop_suppressed" as const;
export const OPERATOR_STOP_OPERATOR_LABEL = "Stopped by operator — manual restart required";

export type OperatorStopSuppressionRow = {
  id: string;
  account_id: string;
  assignment_id: string | null;
  scheduled_window_start: string;
  scheduled_window_end: string;
  request_id: string | null;
  run_id: string | null;
  status: "active" | "expired";
  reason_code: string;
  suppressed_at: string;
  expires_at: string;
  metadata_safe: Record<string, unknown>;
};

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => QueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function query(supabase: SupabaseLike, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

function mapSuppressionRow(row: Record<string, unknown> | null | undefined): OperatorStopSuppressionRow | null {
  if (!row) return null;
  const id = readString(row.id);
  if (!id) return null;
  return {
    id,
    account_id: readString(row.account_id),
    assignment_id: readString(row.assignment_id) || null,
    scheduled_window_start: readString(row.scheduled_window_start),
    scheduled_window_end: readString(row.scheduled_window_end),
    request_id: readString(row.request_id) || null,
    run_id: readString(row.run_id) || null,
    status: readString(row.status, "active") as "active" | "expired",
    reason_code: readString(row.reason_code, OPERATOR_STOP_SUPPRESSED_REASON),
    suppressed_at: readString(row.suppressed_at),
    expires_at: readString(row.expires_at),
    metadata_safe: row.metadata_safe && typeof row.metadata_safe === "object" && !Array.isArray(row.metadata_safe)
      ? (row.metadata_safe as Record<string, unknown>)
      : {},
  };
}

export async function resolveAssignmentWindow(
  supabase: SupabaseLike,
  accountId: string,
): Promise<{ assignmentId: string | null; startsAt: string | null; endsAt: string | null }> {
  const result = await query(supabase, "account_assignments")
    .select("id,starts_at,ends_at")
    .eq("account_id", accountId)
    .in("status", ["reserved", "active"])
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "assignment_unavailable");
  const row = (result.data ?? null) as Record<string, unknown> | null;
  return {
    assignmentId: readString(row?.id) || null,
    startsAt: readString(row?.starts_at) || null,
    endsAt: readString(row?.ends_at) || null,
  };
}

export async function getActiveOperatorStopSuppression(
  supabase: SupabaseLike,
  accountId: string,
  now = new Date(),
): Promise<OperatorStopSuppressionRow | null> {
  const { data, error } = await supabase.rpc("get_active_operator_stop_suppression", {
    p_account_id: accountId,
    p_now: now.toISOString(),
  });
  if (error) throw new Error(error.message || "operator_stop_suppression_lookup_failed");
  return mapSuppressionRow(data as Record<string, unknown> | null);
}

export async function createOperatorStopSuppression(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    assignmentId?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    requestId?: string | null;
    runId?: string | null;
    sourceSurface?: string;
    metadataSafe?: Record<string, unknown>;
  },
) {
  let assignmentId = input.assignmentId ?? null;
  let startsAt = input.startsAt ?? null;
  let endsAt = input.endsAt ?? null;
  if (!startsAt || !endsAt) {
    const assignment = await resolveAssignmentWindow(supabase, input.accountId);
    assignmentId = assignmentId ?? assignment.assignmentId;
    startsAt = startsAt ?? assignment.startsAt;
    endsAt = endsAt ?? assignment.endsAt;
  }
  if (!startsAt || !endsAt) {
    throw new Error("operator_stop_window_unresolved");
  }
  const transition = deriveSessionTransitionTimestamps(startsAt, endsAt);
  const { data, error } = await supabase.rpc("upsert_operator_stop_suppression", {
    p_account_id: input.accountId,
    p_assignment_id: assignmentId,
    p_scheduled_window_start: transition?.session_start ?? startsAt,
    p_scheduled_window_end: transition?.session_end ?? endsAt,
    p_request_id: input.requestId ?? null,
    p_run_id: input.runId ?? null,
    p_reason_code: OPERATOR_STOP_SUPPRESSED_REASON,
    p_expires_at: transition?.session_end ?? endsAt,
    p_metadata_safe: {
      source_surface: input.sourceSurface ?? "instagram_dashboard",
      ...(input.metadataSafe ?? {}),
    },
  });
  if (error) throw new Error(error.message || "operator_stop_suppression_upsert_failed");
  return mapSuppressionRow(data as Record<string, unknown> | null);
}

const STOP_CLEANUP_REQUEST_STATUSES = ["queued", "claimed", "starting", "running"] as const;
const STOP_CLEANUP_RUN_STATUSES = ["running", "queued", "pending", "in_progress", "active", "starting"] as const;

export async function getStopCleanupState(
  supabase: SupabaseLike,
  accountId: string,
): Promise<{
  inProgress: boolean;
  phase: "idle" | "stopping" | "cleanup_in_progress" | "stop_requires_attention";
  requestId: string | null;
  runId: string | null;
  cancelRequestedAt: string | null;
}> {
  const requestResult = await query(supabase, "account_run_requests")
    .select("id,status,run_id,cancel_requested_at,error_code,error_message_safe")
    .eq("account_id", accountId)
    .in("status", [...STOP_CLEANUP_REQUEST_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (requestResult.error) throw new Error(requestResult.error.message || "active_request_unavailable");
  const request = (requestResult.data ?? null) as Record<string, unknown> | null;
  const requestId = readString(request?.id) || null;
  const cancelRequestedAt = readString(request?.cancel_requested_at) || null;
  const requestStatus = readString(request?.status).toLowerCase();
  const linkedRunId = readString(request?.run_id) || null;

  if (!requestId) {
    return { inProgress: false, phase: "idle", requestId: null, runId: null, cancelRequestedAt: null };
  }

  if (["queued", "claimed", "starting"].includes(requestStatus)) {
    return {
      inProgress: true,
      phase: "cleanup_in_progress",
      requestId,
      runId: linkedRunId || null,
      cancelRequestedAt,
    };
  }

  if (requestStatus === "running" && cancelRequestedAt) {
    const runResult = linkedRunId
      ? await query(supabase, "ig_runs")
        .select("id,status")
        .eq("id", linkedRunId)
        .limit(1)
        .maybeSingle()
      : await query(supabase, "ig_runs")
        .select("id,status")
        .eq("account_id", accountId)
        .in("status", [...STOP_CLEANUP_RUN_STATUSES])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    const run = (runResult.data ?? null) as Record<string, unknown> | null;
    const runStatus = readString(run?.status).toLowerCase();
    if (run && STOP_CLEANUP_RUN_STATUSES.includes(runStatus as (typeof STOP_CLEANUP_RUN_STATUSES)[number])) {
      const attention = readString(request?.error_code) === "stop_cleanup_timeout";
      return {
        inProgress: true,
        phase: attention ? "stop_requires_attention" : "stopping",
        requestId,
        runId: readString(run.id) || linkedRunId,
        cancelRequestedAt,
      };
    }
    return {
      inProgress: true,
      phase: "cleanup_in_progress",
      requestId,
      runId: linkedRunId,
      cancelRequestedAt,
    };
  }

  return { inProgress: false, phase: "idle", requestId, runId: linkedRunId, cancelRequestedAt };
}

export function operatorStopRunControlProjection(input: {
  suppression: OperatorStopSuppressionRow | null;
  cleanup: Awaited<ReturnType<typeof getStopCleanupState>>;
}) {
  if (input.cleanup.inProgress) {
    const label = input.cleanup.phase === "stop_requires_attention"
      ? "Stop requires attention"
      : input.cleanup.phase === "cleanup_in_progress"
        ? "Cleanup in progress"
        : "Stopping…";
    return {
      runControlPhase: input.cleanup.phase,
      runControlLabel: label,
      operatorStopSuppressed: Boolean(input.suppression),
      eligibility: "blocked_now",
      eligibilityReason: "stop_cleanup_in_progress",
      primary_block_reason: "stop_cleanup_in_progress",
    };
  }
  if (input.suppression) {
    return {
      runControlPhase: "manual_restart_required",
      runControlLabel: OPERATOR_STOP_OPERATOR_LABEL,
      operatorStopSuppressed: true,
    };
  }
  return {};
}

export function shouldBlockAutomaticRestartForOperatorStop(
  trigger: string,
  suppression: OperatorStopSuppressionRow | null,
) {
  if (!suppression) return false;
  return trigger === "scheduler" || trigger === "auto";
}
