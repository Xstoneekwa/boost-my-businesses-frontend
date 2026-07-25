export type IncidentAutomationBlockReason =
  | "blocking_incident_active"
  | "operator_review_required"
  | "pending_verification_action"
  | "login_block_active"
  | "social_block_active";

type Row = Record<string, unknown>;

const ACTIVE_INCIDENT_STATUSES = new Set(["open", "acknowledged", "investigating"]);
const ACTIVE_ACTION_STATUSES = new Set(["pending", "acknowledged", "pending_verification", "code_submitted"]);
const OPERATOR_ACTION_TYPES = new Set(["operator_review_required", "review_auto_restart_hard_stop"]);
const BLOCKING_RECOVERY_STATES = new Set(["reintervention_required", "resume_authorization_expired"]);

function normalize(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function objectValue(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function rowTime(row: Row) {
  const value = String(row.updated_at || row.created_at || "");
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function actionMatchesIncident(incident: Row, action: Row) {
  const incidentId = normalize(incident.id);
  const actionIncidentId = normalize(action.incident_id);
  if (incidentId && actionIncidentId !== incidentId) return false;
  const accountId = normalize(incident.account_id);
  const actionAccountId = normalize(action.account_id);
  return !accountId || !actionAccountId || accountId === actionAccountId;
}

/** Keep only the latest lifecycle row for each action type. */
export function latestIncidentActions(incident: Row, actions: Row[] = []) {
  const latest = new Map<string, Row>();
  for (const action of actions.filter((row) => actionMatchesIncident(incident, row))) {
    const actionType = normalize(action.action_type) || "unknown_action";
    const current = latest.get(actionType);
    if (!current || rowTime(action) > rowTime(current)) latest.set(actionType, action);
  }
  return [...latest.values()];
}

export function incidentRequiresOperatorAction(incident: Row, actions: Row[] = []) {
  if (!ACTIVE_INCIDENT_STATUSES.has(normalize(incident.status))) return false;
  const latest = latestIncidentActions(incident, actions);
  if (latest.some((action) => (
    OPERATOR_ACTION_TYPES.has(normalize(action.action_type))
    && ACTIVE_ACTION_STATUSES.has(normalize(action.status))
  ))) return true;

  const recovery = objectValue(objectValue(incident.metadata).recovery);
  return BLOCKING_RECOVERY_STATES.has(normalize(recovery.state));
}

/**
 * Canonical incident gate for automation.
 *
 * An open lifecycle row is historical/observable by default. It blocks only
 * when a current linked action or an explicit active runtime marker says that
 * automation is still unsafe. Notification delivery state never participates.
 */
export function incidentAutomationBlockReason(
  incident: Row,
  actions: Row[] = [],
): IncidentAutomationBlockReason | null {
  if (!ACTIVE_INCIDENT_STATUSES.has(normalize(incident.status))) return null;
  if (incident.archived_at || incident.resolved_at) return null;

  const latest = latestIncidentActions(incident, actions);
  const activeActions = latest.filter((action) => ACTIVE_ACTION_STATUSES.has(normalize(action.status)));
  const metadata = objectValue(incident.metadata);

  if (activeActions.some((action) => normalize(action.status) === "pending_verification")) {
    return "pending_verification_action";
  }
  if (
    incident.blocking_campaign === true
    || metadata.blocking_campaign === true
    || activeActions.some((action) => action.blocking_campaign === true)
  ) {
    return "blocking_incident_active";
  }
  if (
    incident.operator_review_required === true
    || metadata.operator_review_required === true
    || incidentRequiresOperatorAction(incident, latest)
  ) {
    return "operator_review_required";
  }

  if (metadata.login_block_active === true) return "login_block_active";
  if (metadata.social_block_active === true) return "social_block_active";

  return null;
}

export function firstAutomationBlockingIncident(
  incidents: Row[],
  actions: Row[] = [],
): { incident: Row; reason: IncidentAutomationBlockReason } | null {
  for (const incident of incidents) {
    const reason = incidentAutomationBlockReason(incident, actions);
    if (reason) return { incident, reason };
  }
  return null;
}
