type DashboardActionRow = Record<string, unknown>;

export type DashboardActionBlockerOptions = {
  now?: Date;
  latestSuccessfulSessionAt?: string | null;
  activeIncidentIds?: ReadonlySet<string>;
};

const terminalActionStatuses = new Set([
  "resolved",
  "completed",
  "dismissed",
  "canceled",
  "cancelled",
]);

function normalize(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readString(row: DashboardActionRow | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function readMetadata(row: DashboardActionRow) {
  const metadata = row.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) return metadata as DashboardActionRow;
  const metadataSafe = row.metadata_safe;
  if (metadataSafe && typeof metadataSafe === "object" && !Array.isArray(metadataSafe)) return metadataSafe as DashboardActionRow;
  return null;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function schedulerWindowFromAction(row: DashboardActionRow) {
  const metadata = readMetadata(row);
  const dedupeKey = readString(row, "dedupe_key");
  const dedupeWindow = dedupeKey.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\+\d{2}:\d{2}|Z))$/)?.[1] ?? "";
  return {
    startsAt: readString(metadata, "scheduled_window_start") || readString(metadata, "scheduled_session_at") || dedupeWindow || null,
    endsAt: readString(metadata, "scheduled_window_end") || readString(metadata, "scheduled_session_ends_at") || null,
  };
}

export function isTerminalDashboardAction(row: DashboardActionRow) {
  return terminalActionStatuses.has(normalize(row.status));
}

export function isStaleHistoricalSchedulerBlocker(row: DashboardActionRow, options: DashboardActionBlockerOptions = {}) {
  if (normalize(row.action_type) !== "scheduler_launch_blocked") return false;
  const now = options.now?.getTime() ?? Date.now();
  const { startsAt, endsAt } = schedulerWindowFromAction(row);
  const windowStart = parseDate(startsAt);
  const windowEnd = parseDate(endsAt);
  const latestSuccess = parseDate(options.latestSuccessfulSessionAt ?? null);

  if (windowEnd !== null && windowEnd < now) return true;
  if (latestSuccess !== null && windowStart !== null && latestSuccess > windowStart) return true;

  const createdAt = parseDate(readString(row, "created_at"));
  return latestSuccess !== null && createdAt !== null && latestSuccess > createdAt;
}

export function isCurrentBlockingDashboardAction(row: DashboardActionRow, options: DashboardActionBlockerOptions = {}) {
  if (row.blocking_campaign !== true) return false;
  if (isTerminalDashboardAction(row)) return false;
  if (isStaleHistoricalSchedulerBlocker(row, options)) return false;
  const incidentId = readString(row, "incident_id");
  if (incidentId && options.activeIncidentIds && !options.activeIncidentIds.has(incidentId)) return false;
  return true;
}
