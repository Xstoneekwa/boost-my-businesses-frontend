type RecordValue = Record<string, unknown>;

export type UnfollowAttemptAttribution = {
  schema: "UNFOLLOW_ATTEMPT_ATTRIBUTION_V1";
  authority: "ig_interaction_events";
  dedupeKey: "action_id";
  attributionKey: "run_id";
  attempts: { S1: number; S2: number; S3: number };
  dailyTotal: number;
  unattributed: number;
  nativeCanonicalCount: number;
  syntheticFallbackCount: number;
};

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function metadata(row: RecordValue | undefined) {
  if (!row) return {};
  return record(row.metadata_safe) ?? record(row.performance_summary) ?? {};
}

function firstText(row: RecordValue | undefined, keys: string[]) {
  const meta = metadata(row);
  for (const key of keys) {
    const value = text(row?.[key]) || text(meta[key]);
    if (value) return value;
  }
  return "";
}

function explicitAttempt(row: RecordValue | undefined) {
  const meta = metadata(row);
  for (const key of ["attempt_id", "attempt_ordinal", "current_attempt_id", "attempt"]) {
    const value = integer(row?.[key]) ?? integer(meta[key]);
    if (value && value <= 3) return value;
  }
  return null;
}

function actionId(row: RecordValue) {
  const payload = record(row.payload);
  return text(payload?.action_id) || text(row.action_id) || text(row.id);
}

function interactionRowId(row: RecordValue) {
  return text(record(row.payload)?.interaction_row_id);
}

function isSuccessfulUnfollow(row: RecordValue) {
  const eventType = text(row.event_type).toLowerCase();
  const status = text(row.event_status || row.interaction_status || "success").toLowerCase();
  return ["unfollow_verified", "unfollow_success"].includes(eventType)
    && status === "success";
}

function isSynthetic(row: RecordValue) {
  const source = text(record(row.payload)?.evidence_source).toLowerCase();
  return source === "ig_interacted_users.unfollowed_at";
}

function rootRunLinkedToLaterAttempt(
  runId: string,
  requests: RecordValue[],
  runsById: Map<string, RecordValue>,
) {
  return requests.some((request) => {
    const attempt = explicitAttempt(request)
      ?? explicitAttempt(runsById.get(text(request.run_id)));
    if (!attempt || attempt <= 1) return false;
    return firstText(request, ["prior_run_id", "source_run_id", "root_run_id"]) === runId;
  });
}

function resolveAttempt(
  runId: string,
  requestsByRun: Map<string, RecordValue>,
  requests: RecordValue[],
  runsById: Map<string, RecordValue>,
) {
  if (!runId) return null;
  const request = requestsByRun.get(runId);
  const run = runsById.get(runId);
  const authoritative = explicitAttempt(request) ?? explicitAttempt(run);
  if (authoritative) return authoritative;

  // Legacy S1 rows sometimes predate explicit attempt metadata.  Attribute S1
  // only when a later authoritative attempt points back to this immutable run.
  if (rootRunLinkedToLaterAttempt(runId, requests, runsById)) return 1;
  return null;
}

export function projectUnfollowAttemptAttribution(input: {
  events: RecordValue[];
  requests: RecordValue[];
  runs: RecordValue[];
}): UnfollowAttemptAttribution {
  const requestsByRun = new Map<string, RecordValue>();
  for (const request of input.requests) {
    const runId = text(request.run_id);
    if (runId && !requestsByRun.has(runId)) requestsByRun.set(runId, request);
  }
  const runsById = new Map<string, RecordValue>();
  for (const run of input.runs) {
    const runId = text(run.id || run.run_id);
    if (runId && !runsById.has(runId)) runsById.set(runId, run);
  }

  const nativeByAction = new Map<string, RecordValue>();
  const nativeInteractionRows = new Set<string>();
  const syntheticByAction = new Map<string, RecordValue>();
  for (const event of input.events) {
    if (!isSuccessfulUnfollow(event) || isSynthetic(event)) continue;
    const id = actionId(event);
    if (!id) continue;
    nativeByAction.set(id, event);
    const rowId = interactionRowId(event);
    if (rowId) nativeInteractionRows.add(rowId);
  }
  for (const event of input.events) {
    if (!isSuccessfulUnfollow(event) || !isSynthetic(event)) continue;
    const id = actionId(event);
    if (!id) continue;
    const rowId = interactionRowId(event);
    if ((rowId && nativeInteractionRows.has(rowId)) || nativeByAction.has(id)) continue;
    if (!nativeByAction.has(id)) syntheticByAction.set(id, event);
  }

  const attempts = { S1: 0, S2: 0, S3: 0 };
  let unattributed = 0;
  const count = (event: RecordValue) => {
    const attempt = resolveAttempt(
      text(event.run_id),
      requestsByRun,
      input.requests,
      runsById,
    );
    if (attempt === 1) attempts.S1 += 1;
    else if (attempt === 2) attempts.S2 += 1;
    else if (attempt === 3) attempts.S3 += 1;
    else unattributed += 1;
  };
  nativeByAction.forEach(count);
  syntheticByAction.forEach(count);

  return {
    schema: "UNFOLLOW_ATTEMPT_ATTRIBUTION_V1",
    authority: "ig_interaction_events",
    dedupeKey: "action_id",
    attributionKey: "run_id",
    attempts,
    dailyTotal: nativeByAction.size + syntheticByAction.size,
    unattributed,
    nativeCanonicalCount: nativeByAction.size,
    syntheticFallbackCount: syntheticByAction.size,
  };
}
