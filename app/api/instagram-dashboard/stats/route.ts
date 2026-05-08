import { createSupabaseClient } from "@/lib/supabase";
import { getAccountId, jsonError, jsonOk, readDate, readNumber, readString, requireInstagramAdmin, validateAccountId, type SupabaseRecord } from "../_utils";

export const dynamic = "force-dynamic";

function keyForRun(row: SupabaseRecord) {
  return readString(row.id, readString(row.run_id, ""));
}

function logRunId(row: SupabaseRecord) {
  return readString(row.run_id, readString(row.ig_run_id, ""));
}

function countAction(logs: SupabaseRecord[], names: string[], excludedNames: string[] = []) {
  return logs.reduce((total, log) => {
    const type = readString(log.action_type, readString(log.action, readString(log.event_type, ""))).toLowerCase();
    if (!names.some((name) => type.includes(name))) return total;
    if (excludedNames.some((name) => type.includes(name))) return total;

    const status = readString(log.status, readString(log.result, "")).toLowerCase();
    if (["failed", "error", "skipped"].some((blocked) => status.includes(blocked))) return total;

    return total + readNumber(log.count, 1);
  }, 0);
}

function isRecord(value: unknown): value is SupabaseRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPayloadRecord(log: SupabaseRecord) {
  return isRecord(log.payload) ? log.payload : {};
}

function readPerformanceRecord(log: SupabaseRecord) {
  const payload = readPayloadRecord(log);
  return isRecord(payload.performance_summary) ? payload.performance_summary : payload;
}

const performanceKeys = [
    "total_ms",
    "typing_command_ms",
    "row_detect_ms",
    "row_tap_command_ms",
    "profile_transition_wait_ms",
    "profile_verify_ms",
    "warm_session_used",
    "force_stop_used",
    "xml_fetches",
    "recovery_used",
    "exit_code",
  ];

function hasPerformanceShape(record: SupabaseRecord) {
  return performanceKeys.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function hasPerformanceSummary(log: SupabaseRecord) {
  const payload = readPayloadRecord(log);
  const performance = readPerformanceRecord(log);
  return isRecord(payload.performance_summary) || hasPerformanceShape(performance);
}

function readPerformanceBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "enabled"].includes(normalized)) return true;
    if (["false", "no", "0", "disabled"].includes(normalized)) return false;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  return fallback;
}

function inferWorkerType(run: SupabaseRecord | null, logs: SupabaseRecord[]) {
  const runWorkerType = readString(run?.worker_type, "").toLowerCase();
  if (runWorkerType) return runWorkerType;
  if (isRecord(run?.performance_summary) || isRecord(run?.totals)) return "python_uiautomator";

  const pythonLog = logs.find((log) => {
    const payload = readPayloadRecord(log);
    const workerText = readString(payload.worker_type, readString(log.worker_type, "")).toLowerCase();
    const sourceText = [
      log.action_type,
      log.message,
      payload.worker,
      payload.source,
      payload.runtime,
    ].map((value) => readString(value, "").toLowerCase()).join(" ");
    return workerText === "python_uiautomator" || sourceText.includes("python") || sourceText.includes("uiautomator") || hasPerformanceSummary(log);
  });

  return pythonLog ? "python_uiautomator" : "";
}

function latestProcessedTarget(logs: SupabaseRecord[]) {
  const targetLog = logs.find((log) => {
    const status = readString(log.status, readString(log.result, "")).toLowerCase();
    return readString(log.target_username, readString(log.target, "")) && !["queued", "pending"].includes(status);
  }) ?? logs.find((log) => readString(log.target_username, readString(log.target, "")));

  return targetLog ? readString(targetLog.target_username, readString(targetLog.target, "")) : "";
}

function buildRow(run: SupabaseRecord | null, logs: SupabaseRecord[], index: number) {
  const follow = countAction(logs, ["follow"], ["unfollow"]);
  const unfollow = countAction(logs, ["unfollow"]);
  const like = countAction(logs, ["like"]);
  const comment = countAction(logs, ["comment"]);
  const dm = countAction(logs, ["dm", "message"]);
  const watch = countAction(logs, ["watch", "story"]);
  const performance = logs.find(hasPerformanceSummary);
  const runPerformanceSummary = isRecord(run?.performance_summary) ? run.performance_summary : {};
  const performanceSummary = hasPerformanceShape(runPerformanceSummary) || isRecord(run?.performance_summary)
    ? runPerformanceSummary
    : performance
      ? readPerformanceRecord(performance)
      : {};

  return {
    id: run ? keyForRun(run) || `run-${index}` : `logs-${index}`,
    worker_type: inferWorkerType(run, logs),
    status: readString(run?.status, readString(run?.run_status, "")),
    created_at: readDate(run?.created_at ?? logs[0]?.created_at),
    last_run_at: readDate(run?.started_at ?? run?.created_at ?? logs[0]?.created_at),
    latest_target_username: latestProcessedTarget(logs),
    session_time: readDate(run?.started_at ?? run?.created_at ?? logs[0]?.created_at),
    followers: readNumber(run?.followers, readNumber(run?.follower_count, 0)),
    followings: readNumber(run?.followings, readNumber(run?.following_count, 0)),
    follow_back_enabled: readPerformanceBoolean(run?.follow_back_enabled, false),
    like_back_enabled: readPerformanceBoolean(run?.like_back_enabled, false),
    follow,
    unfollow,
    like,
    comment,
    dm,
    watch,
    total_interactions: follow + unfollow + like + comment + dm + watch,
    total_ms: readNumber(performanceSummary.total_ms, 0),
    typing_command_ms: readNumber(performanceSummary.typing_command_ms, 0),
    row_detect_ms: readNumber(performanceSummary.row_detect_ms, 0),
    row_tap_command_ms: readNumber(performanceSummary.row_tap_command_ms, 0),
    profile_transition_wait_ms: readNumber(performanceSummary.profile_transition_wait_ms, 0),
    profile_verify_ms: readNumber(performanceSummary.profile_verify_ms, 0),
    warm_session_used: readPerformanceBoolean(performanceSummary.warm_session_used, false),
    force_stop_used: readPerformanceBoolean(performanceSummary.force_stop_used, false),
    xml_fetches: readNumber(performanceSummary.xml_fetches, 0),
    recovery_used: readPerformanceBoolean(performanceSummary.recovery_used, false),
    exit_code: readString(performanceSummary.exit_code, ""),
  };
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const accountId = getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const [runsResult, logsResult] = await Promise.all([
      supabase.from("ig_runs").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(50),
      supabase.from("ig_action_logs").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(2000),
    ]);

    const firstError = runsResult.error ?? logsResult.error;
    if (firstError) {
      return jsonError(firstError.message, 500);
    }

    const runs = (runsResult.data ?? []) as SupabaseRecord[];
    const logs = (logsResult.data ?? []) as SupabaseRecord[];
    const rows = runs.map((run, index) => {
      const runId = keyForRun(run);
      const runLogs = logs.filter((log) => runId && logRunId(log) === runId);
      return buildRow(run, runLogs, index);
    });

    if (!rows.length && logs.length) {
      rows.push(buildRow(null, logs, 0));
    }

    return jsonOk(rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load account statistics.";
    return jsonError(message, 500);
  }
}
