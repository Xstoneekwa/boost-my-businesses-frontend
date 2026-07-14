type Row = Record<string, unknown>;

const reviewableStatuses = new Set(["pending", "acknowledged", "pending_verification", "code_submitted"]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function linkedIncidentId(row: Row) {
  const metadata = object(row.metadata);
  const metadataSafe = object(row.metadata_safe);
  return text(row.incident_id) || text(metadata.incident_id) || text(metadataSafe.incident_id);
}

function linkedRunId(row: Row) {
  const metadata = object(row.metadata);
  const metadataSafe = object(row.metadata_safe);
  return text(metadata.run_id) || text(metadataSafe.run_id);
}

function linkedRequestId(row: Row) {
  const metadata = object(row.metadata);
  const metadataSafe = object(row.metadata_safe);
  return text(row.request_id)
    || text(metadata.request_id)
    || text(metadata.run_request_id)
    || text(metadataSafe.request_id)
    || text(metadataSafe.run_request_id);
}

export function findReviewableOperatorAction(
  rows: Row[],
  incident: { id: string; accountId: string; runId?: string | null; requestId?: string | null },
) {
  const candidates = rows.filter((row) => (
    text(row.action_type) === "operator_review_required"
    && reviewableStatuses.has(text(row.status).toLowerCase())
    && text(row.account_id) === incident.accountId
  ));

  const exact = candidates.find((row) => linkedIncidentId(row) === incident.id);
  if (exact) return exact;

  const runId = text(incident.runId);
  if (runId) {
    const byRun = candidates.find((row) => (
      linkedRunId(row) === runId
      || text(row.dedupe_key).includes(`:run:${runId}:`)
    ));
    if (byRun) return byRun;
  }

  const requestId = text(incident.requestId);
  if (!requestId) return null;
  return candidates.find((row) => (
    linkedRequestId(row) === requestId
    || text(row.dedupe_key).includes(`:run:${requestId}:`)
    || text(row.dedupe_key).includes(`:request:${requestId}:`)
  )) ?? null;
}
