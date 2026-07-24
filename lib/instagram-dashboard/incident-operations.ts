/** Pure, redacted read model for the BotApp/Admin incidents surface. */
export type IncidentDbRow = Record<string, unknown>;
export type NotificationDbRow = Record<string, unknown>;

export interface IncidentChannelDelivery {
  channel: string;
  status: string;
  attemptCount: number;
  deliveredAt: string | null;
  lastError: string | null;
}

export interface IncidentViewModel {
  id: string;
  status: string;
  displayState: string;
  severity: string;
  incidentType: string;
  reasonCode: string;
  operatorLabel: string;
  actionRequired: string | null;
  operatorReviewStatus: "pending" | "reviewed" | "none";
  adminMessage: string | null;
  accountId: string | null;
  accountUsername: string | null;
  runId: string | null;
  runRequestId: string | null;
  occurrenceCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  resolvedAt: string | null;
  source: string | null;
  recoveryState: string | null;
  isTest: boolean;
  deliveryState: "delivered" | "pending" | "delivery_degraded" | "none";
  deliveries: IncidentChannelDelivery[];
  accountHref: string | null;
  metadataSafe: Record<string, unknown>;
}

const LABELS: Record<string, string> = {
  run_identity_verification_failed: "Instagram identity could not be verified",
  active_instagram_account_mismatch: "Wrong active Instagram account",
  assigned_instagram_package_unavailable: "Assigned Instagram package or clone unavailable",
  account_login_required: "Instagram account signed out or challenged",
  run_device_unavailable: "Device unavailable during the run",
  run_worker_failure: "Structured run failure",
  login_package_mismatch: "Wrong package during login",
  system_test_incident: "Internal verification incident (test)",
};

const BLOCKED_KEYS = ["password", "secret", "token", "webhook", "cookie", "serial", "udid", "xml", "credential", "package", "clone"];
const ACTIVE_ACTION_STATUSES = new Set(["pending", "acknowledged", "pending_verification", "code_submitted"]);

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function isTestIncident(row: IncidentDbRow): boolean {
  const metadata = row.metadata;
  return str(row.incident_type) === "system_test_incident"
    || Boolean(metadata && typeof metadata === "object" && !Array.isArray(metadata) && (metadata as Record<string, unknown>).test === true);
}

export function redactIncidentMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (BLOCKED_KEYS.some((fragment) => lowered.includes(fragment))) continue;
    if (typeof value === "string") {
      const loweredValue = value.toLowerCase();
      if (loweredValue.includes("hooks.slack.com") || loweredValue.includes("discord.com/api/webhooks") || loweredValue.includes("service_role") || loweredValue.includes("<node") || loweredValue.startsWith("<?xml")) continue;
      safe[key] = value.slice(0, 300);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      safe[key] = value;
    }
  }
  return safe;
}

function recoveryState(row: IncidentDbRow): string {
  const metadata = row.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const recovery = (metadata as Record<string, unknown>).recovery;
  return recovery && typeof recovery === "object" && !Array.isArray(recovery)
    ? str((recovery as Record<string, unknown>).state)
    : "";
}

function displayState(row: IncidentDbRow, review: "pending" | "reviewed" | "none"): string {
  const status = str(row.status).toLowerCase();
  if (status === "resolved" || status === "ignored") return status;
  if (review === "pending") return "action_required";
  if (review === "reviewed") return "reviewed";
  const recovery = recoveryState(row);
  if (recovery === "ready_to_resume" || recovery === "resume_requested") return recovery;
  if (recovery === "reintervention_required" || recovery === "resume_authorization_expired") return "reintervention_required";
  return status === "acknowledged" ? "acknowledged" : "open";
}

function deliveryState(deliveries: IncidentChannelDelivery[]): IncidentViewModel["deliveryState"] {
  if (!deliveries.length) return "none";
  if (deliveries.some((delivery) => delivery.status === "failed")) return "delivery_degraded";
  if (deliveries.every((delivery) => delivery.status === "sent")) return "delivered";
  return "pending";
}

export function buildIncidentList(
  incidentRows: IncidentDbRow[],
  notificationRows: NotificationDbRow[],
  operatorActionRows: IncidentDbRow[] = [],
  options: { includeTest?: boolean } = {},
): IncidentViewModel[] {
  const notifications = new Map<string, IncidentChannelDelivery[]>();
  for (const row of notificationRows) {
    const incidentId = str(row.incident_id);
    if (!incidentId) continue;
    const bucket = notifications.get(incidentId) ?? [];
    const status = str(row.status).toLowerCase() || "unknown";
    bucket.push({
      channel: str(row.channel) || "unknown",
      status,
      attemptCount: count(row.attempt_count),
      deliveredAt: str(row.delivered_at) || null,
      // Provider responses can contain URLs or delivery credentials. Keep the
      // operator-facing state useful without relaying raw provider errors.
      lastError: status === "failed" ? "Delivery failed; review server logs." : null,
    });
    notifications.set(incidentId, bucket);
  }
  const actions = new Map<string, string>();
  for (const action of operatorActionRows) {
    const incidentId = str(action.incident_id);
    if (incidentId && !actions.has(incidentId)) actions.set(incidentId, str(action.status).toLowerCase());
  }
  return incidentRows.flatMap((row) => {
    const test = isTestIncident(row);
    if (test && options.includeTest !== true) return [];
    const id = str(row.id);
    if (!id) return [];
    const actionStatus = actions.get(id) ?? "";
    const review: "pending" | "reviewed" | "none" = ACTIVE_ACTION_STATUSES.has(actionStatus)
      ? "pending"
      : actionStatus === "resolved" || actionStatus === "reviewed" ? "reviewed" : "none";
    const metadataSafe = redactIncidentMetadata(row.metadata);
    const linkedDeliveries = notifications.get(id) ?? [];
    const accountId = str(row.account_id) || null;
    const incidentType = str(row.incident_type) || "unknown_incident";
    return [{
      id,
      status: str(row.status).toLowerCase() || "open",
      displayState: displayState(row, review),
      severity: str(row.severity).toLowerCase() || "warning",
      incidentType,
      reasonCode: str(row.reason) || str(row.failure_reason) || incidentType,
      operatorLabel: str(metadataSafe.operator_label) || LABELS[incidentType] || incidentType,
      actionRequired: str(row.action_required) || null,
      operatorReviewStatus: review,
      adminMessage: str(row.admin_message) || null,
      accountId,
      accountUsername: str(row.account_username) || null,
      runId: str(row.run_id) || null,
      runRequestId: str(metadataSafe.run_request_id) || null,
      occurrenceCount: Math.max(1, count(row.occurrence_count)),
      firstSeenAt: str(row.first_seen_at) || null,
      lastSeenAt: str(row.last_seen_at) || null,
      resolvedAt: str(row.resolved_at) || null,
      source: str(row.source) || null,
      recoveryState: recoveryState(row) || null,
      isTest: test,
      deliveryState: deliveryState(linkedDeliveries),
      deliveries: linkedDeliveries,
      accountHref: accountId ? `/instagram-dashboard/accounts/${encodeURIComponent(accountId)}` : null,
      metadataSafe,
    }];
  });
}
