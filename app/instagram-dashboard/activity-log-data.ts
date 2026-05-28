export type ActivityActorType = "admin" | "system" | "client" | "unknown";
export type ActivityDomain = "settings" | "targets" | "lifecycle" | "device" | "credentials" | "incident" | "run" | "account" | "unknown";
export type ActivityResult = "success" | "failed" | "pending" | "unknown";
export type ActivityMetadataStatus = "redacted" | "unavailable" | "pending_source";

export type ActivityLogItem = {
  id: string;
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
  safeSummary: string;
  sourceLabel: string;
  metadataStatus: ActivityMetadataStatus;
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

function buildSummary(items: ActivityLogItem[]): ActivityLogSummary {
  return {
    totalItems: items.length,
    adminActionsCount: items.filter((item) => item.actorType === "admin").length,
    systemActionsCount: items.filter((item) => item.actorType === "system").length,
    failedActionsCount: items.filter((item) => item.result === "failed").length,
    pendingSourceCount: 1,
  };
}

export async function getActivityLogData(): Promise<ActivityLogOverview> {
  const items: ActivityLogItem[] = [];

  // TODO: Future dedicated audit backend should record Controls clicked, stop run
  // requested, settings saved, filters saved, targets add/bulk/delete/reset/import/export,
  // archive/trash/restore, add profile, credentials actions, incidents acknowledged/resolved,
  // device controls requested, phone notes edited, and phone order saved.
  // Keep raw worker logs, payloads, metadata, screenshots, device internals, and secrets out
  // of Activity Log. Only render redacted safeSummary/sourceLabel projections.

  return {
    items,
    summary: buildSummary(items),
    sourceStatus: {
      activityLog: "pending",
      technicalLogs: "available",
      auditBackend: "pending",
    },
    sourceDetails: {
      activityLog: {
        label: "Activity Log source pending",
        description: "No dedicated admin/dashboard activity source is connected yet.",
      },
      technicalLogs: {
        label: "Technical logs available",
        description: "ig_action_logs and ig_runs exist for worker/run diagnostics, but are not rendered as admin audit events here.",
      },
      auditBackend: {
        label: "Admin audit pending source",
        description: "Future backend audit events should feed this read-only Activity Log without exposing raw logs or sensitive metadata.",
      },
    },
  };
}
