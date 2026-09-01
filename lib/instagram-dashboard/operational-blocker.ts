export type OperationalBlockerCategory =
  | "instagram_restriction"
  | "login"
  | "identity"
  | "device"
  | "operator_review"
  | "commercial"
  | "other";

export type OperationalBlocker = {
  category: OperationalBlockerCategory;
  reasonCode: string;
  severity: "warning" | "error" | "critical";
  blocking: true;
  requiresManualResolution: boolean;
  notBefore: string | null;
  sourceType: "incident" | "dashboard_action" | "commercial" | "runtime";
  sourceId: string;
  label: string;
  detail: string | null;
};

type Row = Record<string, unknown>;

type SupabaseRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value: unknown) {
  if (typeof value === "boolean") return value;
  return /^(true|1|yes)$/i.test(text(value));
}

function incidentPresentation(incidentType: string) {
  switch (incidentType) {
    case "instagram_account_restriction":
      return {
        category: "instagram_restriction" as const,
        label: "48H pause required",
        detail: "Instagram restricted",
      };
    case "active_instagram_account_mismatch":
      return {
        category: "identity" as const,
        label: "Instagram identity mismatch",
        detail: "Manual identity review required",
      };
    case "instagram_human_confirmation_required":
      return {
        category: "operator_review" as const,
        label: "Instagram confirmation required",
        detail: "Manual confirmation required",
      };
    case "account_login_required":
      return {
        category: "login" as const,
        label: "Instagram login required",
        detail: "Reconnect the assigned Instagram account",
      };
    case "assigned_instagram_package_unavailable":
      return {
        category: "device" as const,
        label: "Instagram app unavailable",
        detail: "Review the assigned app instance",
      };
    default:
      return {
        category: "other" as const,
        label: "Operational incident",
        detail: "Manual review required",
      };
  }
}

export function operationalBlockerFromCanonicalIncident(row: Row): OperationalBlocker | null {
  const sourceId = text(row.incident_id);
  const reasonCode = text(row.reason_code);
  const incidentType = text(row.incident_type).toLowerCase();
  if (!sourceId || !reasonCode || !incidentType) return null;
  const severityValue = text(row.severity).toLowerCase();
  const severity: OperationalBlocker["severity"] = severityValue === "critical"
    ? "critical"
    : severityValue === "error"
      ? "error"
      : "warning";
  const presentation = incidentPresentation(incidentType);
  return {
    ...presentation,
    reasonCode,
    severity,
    blocking: true,
    requiresManualResolution: bool(row.requires_manual_resolution),
    notBefore: text(row.not_before) || null,
    sourceType: "incident",
    sourceId,
  };
}

export function operationalBlockerFromDashboardAction(row: Row): OperationalBlocker | null {
  if (!bool(row.blocking_campaign)) return null;
  const sourceId = text(row.id);
  const reasonCode = text(row.action_type).toLowerCase() || "blocking_dashboard_action";
  if (!sourceId) return null;
  return {
    category: "operator_review",
    reasonCode,
    severity: "warning",
    blocking: true,
    requiresManualResolution: true,
    notBefore: null,
    sourceType: "dashboard_action",
    sourceId,
    label: "Operator review required",
    detail: "Review the pending account action",
  };
}

export function chooseOperationalBlocker(
  incident: OperationalBlocker | null,
  dashboardAction: OperationalBlocker | null,
) {
  if (!incident) return dashboardAction;
  if (!dashboardAction) return incident;
  const rank = { critical: 0, error: 1, warning: 2 } as const;
  return rank[incident.severity] <= rank[dashboardAction.severity] ? incident : dashboardAction;
}

export async function loadCanonicalOperationalBlockers(
  supabase: SupabaseRpcClient,
  accountIds: string[],
): Promise<Map<string, OperationalBlocker>> {
  const uniqueAccountIds = [...new Set(accountIds.map((value) => value.trim()).filter(Boolean))];
  if (!uniqueAccountIds.length) return new Map();
  const result = await supabase.rpc("canonical_active_operational_blockers_v1", {
    p_account_ids: uniqueAccountIds,
  }) as { data?: unknown; error?: { message?: string } | null };
  if (result.error) throw new Error(result.error.message || "canonical_operational_blockers_unavailable");
  const rows = Array.isArray(result.data) ? result.data as Row[] : [];
  const blockers = new Map<string, OperationalBlocker>();
  for (const row of rows) {
    const accountId = text(row.account_id);
    const sourceType = text(row.source_type).toLowerCase();
    const blocker = sourceType === "dashboard_action"
      ? operationalBlockerFromDashboardAction({
          id: row.source_id,
          action_type: row.action_type,
          blocking_campaign: true,
        })
      : operationalBlockerFromCanonicalIncident({
          ...row,
          incident_id: row.incident_id ?? row.source_id,
        });
    if (accountId && blocker) blockers.set(accountId, blocker);
  }
  return blockers;
}
