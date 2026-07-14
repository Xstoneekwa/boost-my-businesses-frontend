/**
 * P2 canonical incident operations (read model).
 *
 * Source of truth: `account_incidents` (+ `account_incident_notifications`
 * outbox). This module is pure: it maps DB rows to internal view models with
 * stable reasons, derived display states and redacted metadata. No client
 * (tenant) surface consumes these models: they are Admin/BotApp only.
 */

export type IncidentDbRow = Record<string, unknown>;
export type NotificationDbRow = Record<string, unknown>;

export type IncidentDisplayState =
  | "open"
  | "action_required"
  | "resolved"
  | "acknowledged"
  | "ignored"
  // P3 recovery display states, derived from metadata.recovery.state:
  | "ready_to_resume"
  | "resume_requested"
  | "reintervention_required";

export type IncidentDeliveryState =
  | "delivered"
  | "pending"
  | "delivery_degraded"
  | "none";

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
  displayState: IncidentDisplayState;
  severity: string;
  incidentType: string;
  reasonCode: string;
  operatorLabel: string;
  actionRequired: string | null;
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
  deliveryState: IncidentDeliveryState;
  deliveries: IncidentChannelDelivery[];
  accountHref: string | null;
  metadataSafe: Record<string, unknown>;
}

export interface IncidentCounters {
  open: number;
  actionRequired: number;
  resolved: number;
  deliveryDegraded: number;
  total: number;
}

/** Stable operator labels per canonical incident_type (fallback: type). */
const INCIDENT_TYPE_LABELS: Record<string, string> = {
  run_identity_verification_failed: "Instagram identity could not be verified",
  active_instagram_account_mismatch: "Wrong active Instagram account",
  assigned_instagram_package_unavailable: "Assigned Instagram package or clone unavailable",
  account_login_required: "Instagram account signed out or challenged",
  run_device_unavailable: "Device unavailable during the run",
  run_worker_failure: "Structured run failure",
  login_package_mismatch: "Wrong package during login",
  system_test_incident: "Internal verification incident (test)",
};

const METADATA_BLOCKED_KEY_FRAGMENTS = [
  "password",
  "secret",
  "token",
  "webhook",
  "cookie",
  "serial",
  "udid",
  "xml",
  "credential",
  "package",
  "clone",
];

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function isTestIncident(row: IncidentDbRow): boolean {
  const metadata = row.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const flag = (metadata as Record<string, unknown>).test;
    if (flag === true || flag === "true") return true;
  }
  return readString(row.incident_type) === "system_test_incident";
}

export function redactIncidentMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (METADATA_BLOCKED_KEY_FRAGMENTS.some((fragment) => lowered.includes(fragment))) {
      continue;
    }
    if (typeof value === "string") {
      const loweredValue = value.toLowerCase();
      if (
        loweredValue.includes("hooks.slack.com")
        || loweredValue.includes("discord.com/api/webhooks")
        || loweredValue.includes("service_role")
        || loweredValue.startsWith("<?xml")
        || loweredValue.includes("<node")
      ) {
        continue;
      }
      out[key] = value.slice(0, 300);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    }
    // Nested objects are dropped on purpose: flat, safe details only.
  }
  return out;
}

/** P3: recovery state carried in metadata.recovery.state (worker/backend). */
export function incidentRecoveryState(row: IncidentDbRow): string {
  const metadata = row.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const recovery = (metadata as Record<string, unknown>).recovery;
  if (!recovery || typeof recovery !== "object" || Array.isArray(recovery)) return "";
  return readString((recovery as Record<string, unknown>).state);
}

export function incidentDisplayState(row: IncidentDbRow): IncidentDisplayState {
  const status = readString(row.status).toLowerCase();
  if (status === "resolved") return "resolved";
  if (status === "ignored") return "ignored";
  // P3 recovery states take precedence over the generic action_required
  // display while the incident is still active.
  const recoveryState = incidentRecoveryState(row);
  if (recoveryState === "ready_to_resume") return "ready_to_resume";
  if (recoveryState === "resume_requested") return "resume_requested";
  if (
    recoveryState === "reintervention_required"
    || recoveryState === "resume_authorization_expired"
  ) {
    return "reintervention_required";
  }
  if (status === "acknowledged") return "acknowledged";
  // Open + explicit operator action => action_required display state.
  if (readString(row.action_required)) return "action_required";
  return "open";
}

export function incidentDeliveryState(
  deliveries: IncidentChannelDelivery[],
): IncidentDeliveryState {
  if (!deliveries.length) return "none";
  const sent = deliveries.filter((d) => d.status === "sent");
  const failed = deliveries.filter((d) => d.status === "failed");
  if (failed.length > 0) return "delivery_degraded";
  if (sent.length === deliveries.length) return "delivered";
  return "pending";
}

export function mapNotificationRow(row: NotificationDbRow): IncidentChannelDelivery {
  return {
    channel: readString(row.channel) || "unknown",
    status: readString(row.status).toLowerCase() || "unknown",
    attemptCount: readCount(row.attempt_count),
    deliveredAt: readString(row.delivered_at) || null,
    lastError: readString(row.last_error).slice(0, 240) || null,
  };
}

export function mapIncidentRow(
  row: IncidentDbRow,
  notifications: NotificationDbRow[] = [],
): IncidentViewModel {
  const deliveries = notifications.map(mapNotificationRow);
  const accountId = readString(row.account_id) || null;
  const incidentType = readString(row.incident_type) || "unknown_incident";
  const metadataSafe = redactIncidentMetadata(row.metadata);
  const runRequestId = readString(metadataSafe.run_request_id) || null;
  return {
    id: readString(row.id),
    status: readString(row.status).toLowerCase() || "open",
    displayState: incidentDisplayState(row),
    severity: readString(row.severity).toLowerCase() || "warning",
    incidentType,
    reasonCode: readString(row.reason) || readString(row.failure_reason) || incidentType,
    operatorLabel:
      readString(metadataSafe.operator_label)
      || INCIDENT_TYPE_LABELS[incidentType]
      || incidentType,
    actionRequired: readString(row.action_required) || null,
    adminMessage: readString(row.admin_message) || null,
    accountId,
    accountUsername: readString(row.account_username) || null,
    runId: readString(row.run_id) || null,
    runRequestId,
    occurrenceCount: Math.max(1, readCount(row.occurrence_count)),
    firstSeenAt: readString(row.first_seen_at) || null,
    lastSeenAt: readString(row.last_seen_at) || null,
    resolvedAt: readString(row.resolved_at) || null,
    source: readString(row.source) || null,
    recoveryState: incidentRecoveryState(row) || null,
    isTest: isTestIncident(row),
    deliveryState: incidentDeliveryState(deliveries),
    deliveries,
    accountHref: accountId
      ? `/instagram-dashboard/accounts/${encodeURIComponent(accountId)}`
      : null,
    metadataSafe,
  };
}

export function buildIncidentList(
  incidentRows: IncidentDbRow[],
  notificationRows: NotificationDbRow[],
  options: { includeTest?: boolean } = {},
): IncidentViewModel[] {
  const includeTest = options.includeTest === true;
  const byIncident = new Map<string, NotificationDbRow[]>();
  for (const row of notificationRows) {
    const incidentId = readString(row.incident_id);
    if (!incidentId) continue;
    const bucket = byIncident.get(incidentId) ?? [];
    bucket.push(row);
    byIncident.set(incidentId, bucket);
  }
  const models: IncidentViewModel[] = [];
  for (const row of incidentRows) {
    const model = mapIncidentRow(row, byIncident.get(readString(row.id)) ?? []);
    if (model.isTest && !includeTest) continue;
    models.push(model);
  }
  return models;
}

export function buildIncidentCounters(models: IncidentViewModel[]): IncidentCounters {
  // Test incidents are excluded from operational counters by default;
  // callers filter them before counting unless include_test is requested.
  const operational = models.filter((model) => !model.isTest);
  return {
    // Recovery states in flight (armed / requested) still count as open.
    open: operational.filter((m) =>
      m.displayState === "open"
      || m.displayState === "ready_to_resume"
      || m.displayState === "resume_requested").length,
    // A failed resume needs a human again: it is action_required-class.
    actionRequired: operational.filter((m) =>
      m.displayState === "action_required"
      || m.displayState === "reintervention_required").length,
    resolved: operational.filter((m) => m.displayState === "resolved").length,
    deliveryDegraded: operational.filter((m) => m.deliveryState === "delivery_degraded").length,
    total: operational.length,
  };
}
