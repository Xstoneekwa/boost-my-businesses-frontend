import { createSupabaseClient } from "@/lib/supabase";
import { getAccountId, jsonError, jsonOk, readDate, readString, requireInstagramAdmin, validateAccountId, type SupabaseRecord } from "../_utils";

export const dynamic = "force-dynamic";

type LogScope = "visible" | "all" | "latest-run" | "latest-python-run";

function getLogScope(request: Request): LogScope {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  return scope === "all" || scope === "latest-run" || scope === "latest-python-run" ? scope : "visible";
}

function rowDateMs(row: SupabaseRecord) {
  const date = new Date(readString(row.created_at, ""));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function rawRunId(row: SupabaseRecord) {
  const runId = readString(row.run_id, readString(row.ig_run_id, "")).trim();
  return runId && runId !== "—" ? runId : "";
}

function normalizedRowText(row: SupabaseRecord) {
  return [
    row.action_type,
    row.action,
    row.status,
    row.result,
    row.message,
    row.error_message,
  ].map((value) => readString(value, "").toLowerCase()).join(" ");
}

function isRunStarted(row: SupabaseRecord) {
  const text = normalizedRowText(row);
  return /\brun[_\s-]*started\b/.test(text) || /\bstarted[_\s-]*run\b/.test(text);
}

function isRunCompleted(row: SupabaseRecord) {
  const text = normalizedRowText(row);
  return /\brun[_\s-]*(completed|complete|finished|ended|stopped)\b/.test(text) || /\b(completed|finished|ended|stopped)[_\s-]*run\b/.test(text);
}

function latestFallbackRunGroup(rows: SupabaseRecord[]) {
  const chronologicalRows = [...rows].sort((a, b) => rowDateMs(a) - rowDateMs(b));
  const groups: SupabaseRecord[][] = [];
  let currentGroup: SupabaseRecord[] = [];

  for (const row of chronologicalRows) {
    if (isRunStarted(row)) {
      if (currentGroup.length) groups.push(currentGroup);
      currentGroup = [row];
    } else if (currentGroup.length) {
      currentGroup.push(row);
    }

    if (currentGroup.length && isRunCompleted(row)) {
      groups.push(currentGroup);
      currentGroup = [];
    }
  }

  if (currentGroup.length) groups.push(currentGroup);
  if (!groups.length) return rows;

  const latestGroup = groups.reduce((latest, group) => {
    const latestGroupDate = Math.max(...latest.map(rowDateMs));
    const groupDate = Math.max(...group.map(rowDateMs));
    return groupDate > latestGroupDate ? group : latest;
  });

  return latestGroup.sort((a, b) => rowDateMs(b) - rowDateMs(a));
}

function filterLatestRun(rows: SupabaseRecord[]) {
  const latestRunId = rows.map(rawRunId).find(Boolean) ?? "";
  if (latestRunId) {
    return rows.filter((row) => rawRunId(row) === latestRunId);
  }

  return latestFallbackRunGroup(rows);
}

function isRecord(value: unknown): value is SupabaseRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const sensitiveTextPatterns = [
  /password["'\s:=]+[^"',\s}]+/gi,
  /token["'\s:=]+[^"',\s}]+/gi,
  /authorization["'\s:=]+[^"',\s}]+/gi,
  /secret[_-]?ref["'\s:=]+[^"',\s}]+/gi,
  /vault[_-]?id["'\s:=]+[^"',\s}]+/gi,
  /device[_-]?udid["'\s:=]+[^"',\s}]+/gi,
  /adb[_-]?serial["'\s:=]+[^"',\s}]+/gi,
  /usb[_-]?port["'\s:=]+[^"',\s}]+/gi,
  /hub[_-]?port["'\s:=]+[^"',\s}]+/gi,
  /screenshot[_-]?path["'\s:=]+[^"',\s}]+/gi,
];

function redactText(value: string) {
  return sensitiveTextPatterns.reduce((text, pattern) => text.replace(pattern, "[redacted]"), value);
}

function safePerformanceSummary(value: unknown) {
  if (!isRecord(value)) return null;
  const allowedKeys = [
    "total_ms",
    "typing_command_ms",
    "row_detect_ms",
    "row_tap_command_ms",
    "profile_transition_wait_ms",
    "profile_verify_ms",
    "warm_session_used",
    "xml_fetches",
    "recovery_used",
    "exit_code",
  ];

  return Object.fromEntries(
    allowedKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
      .map((key) => [key, value[key]]),
  );
}

function readPayloadRecord(row: SupabaseRecord) {
  return isRecord(row.payload) ? row.payload : {};
}

function hasPythonPerformanceShape(payload: SupabaseRecord) {
  const performanceSummary = payload.performance_summary;
  return (
    isRecord(performanceSummary) ||
    [
      "total_ms",
      "typing_command_ms",
      "row_detect_ms",
      "row_tap_command_ms",
      "profile_transition_wait_ms",
      "profile_verify_ms",
      "warm_session_used",
      "xml_fetches",
    ].some((key) => Object.prototype.hasOwnProperty.call(payload, key))
  );
}

function inferWorkerType(row: SupabaseRecord) {
  const payload = readPayloadRecord(row);
  const explicitWorkerType = readString(row.worker_type, readString(payload.worker_type, ""));
  if (explicitWorkerType) return explicitWorkerType;

  const sourceText = [
    row.action_type,
    row.message,
    payload.worker,
    payload.source,
    payload.runtime,
  ].map((value) => readString(value, "").toLowerCase()).join(" ");

  if (sourceText.includes("python") || sourceText.includes("uiautomator") || hasPythonPerformanceShape(payload)) {
    return "python_uiautomator";
  }

  return "";
}

function runIdFromRun(row: SupabaseRecord) {
  return readString(row.id, readString(row.run_id, "")).trim();
}

function isPythonRun(run: SupabaseRecord) {
  const workerType = readString(run.worker_type, "").toLowerCase();
  return workerType === "python_uiautomator" || isRecord(run.performance_summary) || isRecord(run.totals);
}

function filterLatestPythonRun(rows: SupabaseRecord[], runsById: Map<string, SupabaseRecord>) {
  const pythonRows = rows.filter((row) => {
    const run = runsById.get(rawRunId(row));
    return (run && isPythonRun(run)) || inferWorkerType(row) === "python_uiautomator";
  });
  const latestRunId = pythonRows.map(rawRunId).find(Boolean) ?? "";
  if (latestRunId) {
    return rows.filter((row) => rawRunId(row) === latestRunId);
  }

  return latestFallbackRunGroup(pythonRows);
}

function mapLogRow(row: SupabaseRecord, index: number, runsById: Map<string, SupabaseRecord>) {
  const payload = row.payload ?? null;
  const payloadRecord = isRecord(payload) ? payload : {};
  const run = runsById.get(rawRunId(row));
  const runPerformanceSummary = isRecord(run?.performance_summary) ? run.performance_summary : null;
  const workerType = readString(run?.worker_type, inferWorkerType(row));

  return {
    id: readString(row.id, `${index}`),
    run_id: rawRunId(row) || "—",
    account_id: readString(row.account_id, readString(row.ig_account_id, "")),
    target_username: readString(row.target_username, readString(row.username, readString(row.target, "—"))) || "—",
    action_type: readString(row.action_type, readString(row.action, "—")) || "—",
    status: readString(row.status, readString(row.result, "—")) || "—",
    message: redactText(readString(row.message, readString(row.error_message, "—")) || "—"),
    worker_type: workerType,
    payload: null,
    performance_summary: safePerformanceSummary(payloadRecord.performance_summary ?? runPerformanceSummary),
    metadata: null,
    created_at: readDate(row.created_at),
  };
}

async function fetchLogRows(accountId: string, scope: LogScope) {
  const supabase = createSupabaseClient();
  const pageSize = scope === "visible" ? 100 : 1000;
  const rows: SupabaseRecord[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("ig_action_logs")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);

    const pageRows = (data ?? []) as SupabaseRecord[];
    rows.push(...pageRows);

    if (scope === "visible" || pageRows.length < pageSize) break;
  }

  return rows;
}

async function fetchRunRows(accountId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_runs")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) throw new Error(error.message);
  return (data ?? []) as SupabaseRecord[];
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const accountId = getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const scope = getLogScope(request);
    const [rows, runRows] = await Promise.all([fetchLogRows(accountId, scope), fetchRunRows(accountId)]);
    const runEntries: Array<[string, SupabaseRecord]> = [];
    for (const run of runRows) {
      const runId = runIdFromRun(run);
      if (runId) runEntries.push([runId, run]);
    }
    const runsById = new Map(runEntries);
    const scopedRows = scope === "latest-run" ? filterLatestRun(rows) : scope === "latest-python-run" ? filterLatestPythonRun(rows, runsById) : rows;
    const logs = scopedRows.map((row, index) => mapLogRow(row, index, runsById));

    return jsonOk(logs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load account logs.";
    return jsonError(message, 500);
  }
}
