type Row = Record<string, unknown>;

const ACTIVE_ACTION_STATUSES = new Set(["pending", "acknowledged", "pending_verification"]);
const ACTIVE_INCIDENT_STATUSES = new Set(["open", "acknowledged", "investigating"]);
const CANONICAL_REASON = "instagram_credentials_rejected";
const CANONICAL_ACTION = "update_instagram_password";
const CANONICAL_PHASE = "submit_credentials";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function objectValue(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function metadata(row: Row) {
  return {
    ...objectValue(row.metadata_safe),
    ...objectValue(row.metadata),
  };
}

function canonicalReason(row: Row) {
  const meta = metadata(row);
  return text(row.failure_reason || row.reason || meta.reason_code || meta.reason).toLowerCase();
}

function requestId(row: Row) {
  const meta = metadata(row);
  return text(meta.request_id || meta.run_request_id);
}

function runId(row: Row) {
  const meta = metadata(row);
  return text(row.run_id || meta.run_id);
}

function phase(row: Row) {
  const meta = metadata(row);
  return text(meta.phase).toLowerCase();
}

function timestamp(row: Row) {
  const value = Date.parse(text(row.created_at || row.updated_at));
  return Number.isFinite(value) ? value : 0;
}

export type PasswordUpdateOperationalState = {
  actionId: string;
  incidentId: string;
  accountId: string;
  requestId: string;
  runId: string;
  reason: "instagram_credentials_rejected";
  action: "update_instagram_password";
  phase: "submit_credentials";
  status: string;
  label: "Mettre à jour le mot de passe";
  canSubmitCode: false;
  source: "same_event_wrong_password_v1";
  createdAt: string | null;
};

export function projectCurrentPasswordUpdateActions(
  actionRows: Row[],
  incidentRows: Row[],
): Map<string, PasswordUpdateOperationalState> {
  const incidentsById = new Map(
    incidentRows
      .filter((incident) => ACTIVE_INCIDENT_STATUSES.has(text(incident.status).toLowerCase()))
      .map((incident) => [text(incident.id), incident] as const)
      .filter(([id]) => Boolean(id)),
  );
  const result = new Map<string, PasswordUpdateOperationalState>();

  for (const action of [...actionRows].sort((left, right) => timestamp(right) - timestamp(left))) {
    if (text(action.action_type).toLowerCase() !== CANONICAL_ACTION) continue;
    if (!ACTIVE_ACTION_STATUSES.has(text(action.status).toLowerCase())) continue;
    if (action.requires_client_action !== true || action.blocking_campaign !== true) continue;

    const accountId = text(action.account_id);
    const incidentId = text(action.incident_id);
    const incident = incidentsById.get(incidentId);
    if (!accountId || !incident || text(incident.account_id) !== accountId) continue;
    if (canonicalReason(action) !== CANONICAL_REASON || canonicalReason(incident) !== CANONICAL_REASON) continue;
    if (phase(action) !== CANONICAL_PHASE || phase(incident) !== CANONICAL_PHASE) continue;

    const actionRequestId = requestId(action);
    const incidentRequestId = requestId(incident);
    const actionRunId = runId(action);
    const incidentRunId = runId(incident);
    if (!actionRequestId || actionRequestId !== incidentRequestId) continue;
    if (!actionRunId || actionRunId !== incidentRunId) continue;
    if (result.has(accountId)) continue;

    result.set(accountId, {
      actionId: text(action.id),
      incidentId,
      accountId,
      requestId: actionRequestId,
      runId: actionRunId,
      reason: CANONICAL_REASON,
      action: CANONICAL_ACTION,
      phase: CANONICAL_PHASE,
      status: text(action.status).toLowerCase(),
      label: "Mettre à jour le mot de passe",
      canSubmitCode: false,
      source: "same_event_wrong_password_v1",
      createdAt: text(action.created_at) || null,
    });
  }

  return result;
}
