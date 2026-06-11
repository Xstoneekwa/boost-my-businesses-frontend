import { createSupabaseClient } from "../../lib/supabase.ts";

export type ActivityActorType = "admin" | "system" | "client" | "unknown";
export type ActivityDomain = "settings" | "targets" | "lifecycle" | "device" | "credentials" | "incident" | "run" | "account" | "unknown";
export type ActivityResult = "success" | "failed" | "pending" | "accepted" | "duplicate" | "rejected" | "review" | "archived" | "restored" | "unknown";
export type ActivityMetadataStatus = "redacted" | "unavailable" | "safe_projection";
export type ActivityInvestigationMode = "search_by_ct" | "search_by_account" | "recent_interactions" | "disputes_evidence";
export type ActivityInvestigationPeriod = "24h" | "7d" | "30d";
export type ActivityInvestigationQuery = {
  mode: ActivityInvestigationMode;
  search: string;
  period: ActivityInvestigationPeriod;
  actionType: string;
  clientAccount: string;
  status: string;
};

export type ActivityLogItem = {
  id: string;
  sourceRecordId?: string | null;
  evidenceSourceTable?: string | null;
  timestamp: string | null;
  actor: string;
  actorType: ActivityActorType;
  domain: ActivityDomain;
  action: string;
  result: ActivityResult;
  accountId: string | null;
  username: string | null;
  targetType: string | null;
  targetLabel: string | null;
  targetIdShort: string | null;
  batchIdShort: string | null;
  sourceSurface: string | null;
  reason: string | null;
  safeSummary: string;
  sourceLabel: string;
  metadataStatus: ActivityMetadataStatus;
  clientId?: string | null;
  clientAccountUsername?: string | null;
  ctId?: string | null;
  ctUsername?: string | null;
  interactedUsername?: string | null;
  actionType?: string | null;
  actionStatus?: string | null;
  occurredAt?: string | null;
  runId?: string | null;
  requestId?: string | null;
  safeDeviceLabel?: string | null;
  evidenceSource?: string | null;
  evidenceConfidence?: string | null;
  isEvidenceProjection?: boolean;
};

export type ActivityLogSummary = {
  totalItems: number;
  adminActionsCount: number;
  systemActionsCount: number;
  failedActionsCount: number;
  pendingSourceCount: number;
};

export type ActivityLogSourceStatus = {
  activityLog: "pending" | "derived" | "connected" | "unknown";
  technicalLogs: "available" | "unavailable" | "pending";
  auditBackend: "pending" | "connected" | "unavailable";
};

export type ActivityLogSourceDetail = {
  label: string;
  description: string;
};

export type ActivityLogOverview = {
  items: ActivityLogItem[];
  summary: ActivityLogSummary;
  sourceStatus: ActivityLogSourceStatus;
  sourceDetails: {
    activityLog: ActivityLogSourceDetail;
    technicalLogs: ActivityLogSourceDetail;
    auditBackend: ActivityLogSourceDetail;
  };
};

type SafeRecord = Record<string, unknown>;

export type CtTargetAuditEventRow = {
  id?: string | null;
  created_at?: string | null;
  account_id?: string | null;
  target_id?: string | null;
  operation?: string | null;
  result?: string | null;
  reason?: string | null;
  actor_type?: string | null;
  batch_id?: string | null;
  counts?: SafeRecord | null;
  metadata_safe?: SafeRecord | null;
};

export type InteractionEvidenceRow = {
  source_record_id?: string | null;
  evidence_source_table?: string | null;
  account_id?: string | null;
  client_id?: string | null;
  client_account_username?: string | null;
  ct_id?: string | null;
  ct_username?: string | null;
  interacted_username?: string | null;
  action_type?: string | null;
  action_status?: string | null;
  occurred_at?: string | null;
  run_id?: string | null;
  request_id?: string | null;
  safe_device_label?: string | null;
  evidence_source?: string | null;
  evidence_confidence?: "high" | "medium" | "best_effort" | "unknown" | string | null;
  evidence_summary?: string | null;
  metadata_safe?: SafeRecord | null;
};

type AccountLookup = Map<string, string>;
type TargetLookup = Map<string, string>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function shortId(value: string | null | undefined) {
  return value ? value.slice(0, 8) : null;
}

export function normalizeActivitySearchTerm(value: string) {
  return readString(value, "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function readableActivityText(value: string | null | undefined) {
  return readString(value, "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function periodMs(period: ActivityInvestigationPeriod) {
  if (period === "24h") return 24 * 60 * 60 * 1000;
  if (period === "7d") return 7 * 24 * 60 * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}

function itemTimestampMs(item: ActivityLogItem) {
  const timestamp = item.occurredAt ?? item.timestamp;
  const ms = timestamp ? new Date(timestamp).getTime() : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
}

export function buildNoInteractionMessage(search: string) {
  const term = normalizeActivitySearchTerm(search);
  return `No interaction found for ${term ? `@${term}` : "the selected filters"} in the selected period.`;
}

export function itemMatchesInvestigationQuery(
  item: ActivityLogItem,
  query: ActivityInvestigationQuery,
  now = new Date(),
) {
  const occurredAtMs = itemTimestampMs(item);
  if (occurredAtMs && occurredAtMs < now.getTime() - periodMs(query.period)) return false;

  if (query.actionType !== "all" && readableActivityText(item.actionType ?? item.action) !== query.actionType) return false;
  if (query.status !== "all" && readableActivityText(item.actionStatus ?? item.result) !== query.status) return false;
  if (query.clientAccount !== "all") {
    const clientAccount = readableActivityText(item.clientAccountUsername ?? item.username);
    if (clientAccount !== query.clientAccount) return false;
  }

  const term = normalizeActivitySearchTerm(query.search);
  if (!term) return query.mode === "recent_interactions" || query.mode === "disputes_evidence";

  const ctUsername = readableActivityText(item.ctUsername);
  const interactedUsername = readableActivityText(item.interactedUsername ?? item.targetLabel);
  const clientAccountUsername = readableActivityText(item.clientAccountUsername ?? item.username);

  if (query.mode === "search_by_ct") return ctUsername.includes(term);
  if (query.mode === "search_by_account") return interactedUsername.includes(term);
  return ctUsername.includes(term) || interactedUsername.includes(term) || clientAccountUsername.includes(term);
}

function safeReason(value: unknown) {
  return readString(value, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, "_")
    .slice(0, 120) || null;
}

function readSafeMetadataString(metadata: SafeRecord | null | undefined, key: string) {
  if (!metadata || typeof metadata !== "object") return null;
  return safeReason(metadata[key]);
}

function actionLabel(operation: string) {
  const labels: Record<string, string> = {
    target_add_single: "Add target",
    target_add_bulk: "Bulk add targets",
    target_verify: "Verify target",
    target_archive: "Archive target",
    target_restore: "Restore target",
    target_reset: "Reset target verification",
    target_quality_decision: "Quality decision",
  };
  return labels[operation] ?? operation.replace(/^target_/, "").replace(/_/g, " ");
}

function interactionActionLabel(actionType: string) {
  const labels: Record<string, string> = {
    follow: "Follow",
    unfollow: "Unfollow",
    like: "Like",
    dm: "DM",
    story_view: "Story view",
    profile_visit: "Profile visit",
    followback: "Followback",
  };
  return labels[actionType] ?? actionType.replace(/_/g, " ");
}

function activityResult(result: string): ActivityResult {
  if (result === "accepted" || result === "duplicate" || result === "rejected" || result === "review" || result === "archived" || result === "restored") return result;
  if (result === "failed") return "failed";
  if (result === "pending") return "pending";
  if (result === "succeeded" || result === "success") return "success";
  return "unknown";
}

function sourceLabel(surface: string | null, operation: string) {
  const readableSurface = surface ? surface.replace(/_/g, " ") : "unknown surface";
  return `${readableSurface} · ${operation}`;
}

export function mapInteractionEvidenceRow(row: InteractionEvidenceRow): ActivityLogItem {
  const id = readString(row.source_record_id, "unknown");
  const accountId = readString(row.account_id, "") || null;
  const clientId = readString(row.client_id, "") || null;
  const ctId = readString(row.ct_id, "") || null;
  const ctUsername = readString(row.ct_username, "").trim().replace(/^@+/, "");
  const interactedUsername = readString(row.interacted_username, "").trim().replace(/^@+/, "");
  const actionType = safeReason(row.action_type) ?? "unknown";
  const actionStatus = safeReason(row.action_status) ?? "unknown";
  const confidence = safeReason(row.evidence_confidence) ?? "unknown";
  const sourceTable = safeReason(row.evidence_source_table) ?? "interaction_evidence";
  const accountUsername = readString(row.client_account_username, "").trim().replace(/^@+/, "");
  const safeDeviceLabel = readString(row.safe_device_label, "").trim();
  const evidenceSummary = readString(row.evidence_summary, "").trim();
  const runId = readString(row.run_id, "") || null;
  const requestId = readString(row.request_id, "") || null;
  const deviceText = safeDeviceLabel ? ` Device ${safeDeviceLabel}.` : "";
  const runText = runId ? ` Run ${shortId(runId)}.` : "";
  const requestText = requestId ? ` Request ${shortId(requestId)}.` : "";
  const ctText = ctUsername ? ` CT @${ctUsername}.` : ctId ? ` CT ${shortId(ctId)}.` : " CT unknown.";
  const interactedText = interactedUsername ? ` Interacted @${interactedUsername}.` : " Interacted account unknown.";

  return {
    id,
    sourceRecordId: id,
    evidenceSourceTable: sourceTable,
    timestamp: readString(row.occurred_at, "") || null,
    actor: "worker",
    actorType: "system",
    domain: "account",
    action: interactionActionLabel(actionType),
    result: activityResult(actionStatus),
    accountId,
    username: accountUsername ? `@${accountUsername}` : accountId ? shortId(accountId) : null,
    targetType: "interaction_evidence",
    targetLabel: interactedUsername ? `@${interactedUsername}` : null,
    targetIdShort: shortId(ctId),
    batchIdShort: null,
    sourceSurface: "activity_log_investigation",
    reason: confidence,
    safeSummary: evidenceSummary || `${interactionActionLabel(actionType)}.${interactedText}${ctText}${runText}${requestText}${deviceText}`.trim(),
    sourceLabel: `${sourceTable} · ${confidence}`,
    metadataStatus: "safe_projection",
    clientId,
    clientAccountUsername: accountUsername || null,
    ctId,
    ctUsername: ctUsername || null,
    interactedUsername: interactedUsername || null,
    actionType,
    actionStatus,
    occurredAt: readString(row.occurred_at, "") || null,
    runId,
    requestId,
    safeDeviceLabel: safeDeviceLabel || null,
    evidenceSource: readString(row.evidence_source, "") || null,
    evidenceConfidence: confidence,
    isEvidenceProjection: true,
  };
}

export function mapCtTargetAuditEvent(
  row: CtTargetAuditEventRow,
  accounts: AccountLookup = new Map(),
  targets: TargetLookup = new Map(),
): ActivityLogItem {
  const id = readString(row.id, "unknown");
  const operation = safeReason(row.operation) ?? "unknown";
  const result = safeReason(row.result) ?? "unknown";
  const accountId = readString(row.account_id, "") || null;
  const targetId = readString(row.target_id, "") || null;
  const batchId = readString(row.batch_id, "") || null;
  const reason = safeReason(row.reason);
  const actorType = row.actor_type === "admin" || row.actor_type === "client" || row.actor_type === "system"
    ? row.actor_type
    : "unknown";
  const sourceSurface = readSafeMetadataString(row.metadata_safe, "source_surface");
  const previousStatus = readSafeMetadataString(row.metadata_safe, "previous_status");
  const nextStatus = readSafeMetadataString(row.metadata_safe, "next_status");
  const accountLabel = accountId ? accounts.get(accountId) ?? shortId(accountId) : null;
  const targetLabel = targetId ? targets.get(targetId) ?? shortId(targetId) : null;
  const statusText = previousStatus || nextStatus ? ` ${previousStatus ?? "unknown"} -> ${nextStatus ?? "unknown"}.` : "";
  const batchText = batchId ? ` Batch ${shortId(batchId)}.` : "";
  const targetText = targetLabel ? ` Target ${targetLabel}.` : targetId ? ` Target ${shortId(targetId)}.` : "";

  return {
    id,
    timestamp: readString(row.created_at, "") || null,
    actor: actorType,
    actorType,
    domain: "targets",
    action: actionLabel(operation),
    result: activityResult(result),
    accountId,
    username: accountLabel,
    targetType: "target_account",
    targetLabel,
    targetIdShort: shortId(targetId),
    batchIdShort: shortId(batchId),
    sourceSurface,
    reason,
    safeSummary: `${actionLabel(operation)} ${result}.${targetText}${batchText}${statusText}${reason ? ` Reason: ${reason}.` : ""}`.trim(),
    sourceLabel: sourceLabel(sourceSurface, operation),
    metadataStatus: "safe_projection",
    clientAccountUsername: accountLabel?.replace(/^@+/, "") ?? null,
    ctId: targetId,
    ctUsername: targetLabel?.replace(/^@+/, "") ?? null,
    interactedUsername: targetLabel?.replace(/^@+/, "") ?? null,
    actionType: operation,
    actionStatus: result,
    occurredAt: readString(row.created_at, "") || null,
    evidenceSource: "ct_target_audit_events",
    evidenceConfidence: "best_effort",
    isEvidenceProjection: false,
  };
}

function buildSummary(items: ActivityLogItem[]): ActivityLogSummary {
  return {
    totalItems: items.length,
    adminActionsCount: items.filter((item) => item.actorType === "admin").length,
    systemActionsCount: items.filter((item) => item.actorType === "system").length,
    failedActionsCount: items.filter((item) => item.result === "failed" || item.result === "rejected").length,
    pendingSourceCount: 0,
  };
}

export async function getActivityLogData(): Promise<ActivityLogOverview> {
  try {
    const supabase = createSupabaseClient();
    const evidenceItems = await loadInteractionEvidenceItems(supabase);
    if (evidenceItems) {
      return {
        items: evidenceItems,
        summary: buildSummary(evidenceItems),
        sourceStatus: {
          activityLog: "connected",
          technicalLogs: "available",
          auditBackend: "connected",
        },
        sourceDetails: {
          activityLog: {
            label: "Interaction evidence connected",
            description: "Activity Log is reading the safe interaction evidence projection.",
          },
          technicalLogs: {
            label: "Server Check boundary",
            description: "Runtime, worker, delivery and process logs remain outside Activity Log and belong in future Server Check.",
          },
          auditBackend: {
            label: "Safe evidence projection",
            description: "Only allowlisted interaction, CT, run and device-label fields are rendered.",
          },
        },
      };
    }

    const { data, error } = await supabase
      .from("ct_target_audit_events")
      .select("id, created_at, account_id, target_id, operation, result, reason, actor_type, batch_id, counts, metadata_safe")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return unavailableActivityLog();
    }

    const rows = (data ?? []) as CtTargetAuditEventRow[];
    const accountIds = [...new Set(rows.map((row) => readString(row.account_id, "")).filter(Boolean))];
    const targetIds = [...new Set(rows.map((row) => readString(row.target_id, "")).filter(Boolean))];

    const [accounts, targets] = await Promise.all([
      loadAccountLabels(accountIds),
      loadTargetLabels(targetIds),
    ]);
    const items = rows.map((row) => mapCtTargetAuditEvent(row, accounts, targets));

    return {
      items,
      summary: buildSummary(items),
      sourceStatus: {
        activityLog: "connected",
        technicalLogs: "available",
        auditBackend: "connected",
      },
      sourceDetails: {
        activityLog: {
          label: "CT audit connected",
          description: "Target account audit events are read from a safe projection of ct_target_audit_events.",
        },
        technicalLogs: {
          label: "Technical logs available",
          description: "ig_action_logs and ig_runs stay separate from admin audit visibility.",
        },
        auditBackend: {
          label: "Safe audit projection",
          description: "Only allowlisted CT audit fields are rendered. Raw metadata_safe is never displayed.",
        },
      },
    };
  } catch {
    return unavailableActivityLog();
  }
}

async function loadInteractionEvidenceItems(supabase: ReturnType<typeof createSupabaseClient>): Promise<ActivityLogItem[] | null> {
  try {
    const { data, error } = await supabase.rpc("get_activity_log_interaction_evidence_admin", {
      p_account_id: null,
      p_search: null,
      p_mode: "all",
      p_period: "30d",
      p_limit: 500,
    });

    if (error) return null;
    return ((data ?? []) as InteractionEvidenceRow[]).map(mapInteractionEvidenceRow);
  } catch {
    return null;
  }
}

async function loadAccountLabels(accountIds: string[]): Promise<AccountLookup> {
  const labels = new Map<string, string>();
  if (accountIds.length === 0) return labels;

  try {
    const { data } = await createSupabaseClient()
      .from("ig_accounts")
      .select("id, username")
      .in("id", accountIds);
    for (const row of (data ?? []) as SafeRecord[]) {
      const id = readString(row.id, "");
      const username = readString(row.username, "");
      if (id) labels.set(id, username ? `@${username}` : shortId(id) ?? id);
    }
  } catch {
    return labels;
  }

  return labels;
}

async function loadTargetLabels(targetIds: string[]): Promise<TargetLookup> {
  const labels = new Map<string, string>();
  if (targetIds.length === 0) return labels;

  try {
    const { data } = await createSupabaseClient()
      .from("ig_targets")
      .select("id, normalized_username, target_username, input_username")
      .in("id", targetIds);
    for (const row of (data ?? []) as SafeRecord[]) {
      const id = readString(row.id, "");
      const username = readString(row.normalized_username, readString(row.target_username, readString(row.input_username, "")));
      if (id) labels.set(id, username ? `@${username}` : shortId(id) ?? id);
    }
  } catch {
    return labels;
  }

  return labels;
}

function unavailableActivityLog(): ActivityLogOverview {
  const items: ActivityLogItem[] = [];
  return {
    items,
    summary: { ...buildSummary(items), pendingSourceCount: 1 },
    sourceStatus: {
      activityLog: "unknown",
      technicalLogs: "available",
      auditBackend: "unavailable",
    },
    sourceDetails: {
      activityLog: {
        label: "CT audit unavailable",
        description: "The safe CT audit projection could not be loaded.",
      },
      technicalLogs: {
        label: "Technical logs available",
        description: "ig_action_logs and ig_runs exist for worker/run diagnostics, but are not rendered as admin audit events here.",
      },
      auditBackend: {
        label: "Audit backend unavailable",
        description: "Activity Log hides raw errors and sensitive metadata when the audit source is unavailable.",
      },
    },
  };
}
