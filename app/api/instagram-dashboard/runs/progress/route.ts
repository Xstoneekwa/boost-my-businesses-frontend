import { createSupabaseClient } from "@/lib/supabase";
import { canAccessTenantPages, getInstagramUserContext } from "@/lib/restaurant-analytics/session";
import { getAccountId, jsonError, jsonOk, readString, validateAccountId, type SupabaseRecord } from "../../_utils";
import { compassRelayAuthFailureReason, relayAuthStatus, verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

const TERMINAL_REQUEST_STATUSES = new Set(["completed", "failed", "blocked", "canceled", "cancelled"]);
const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "started", "in_progress"]);
const ACTION_REQUIRED_TYPES = new Set([
  "enter_email_verification_code",
  "complete_two_factor",
  "resolve_checkpoint",
  "review_login_challenge",
  "update_instagram_password",
  "review_account_mismatch",
]);
const ACTIVE_ACTION_STATUSES = new Set(["pending", "acknowledged", "pending_verification", "code_submitted", "open"]);

function isRecord(value: unknown): value is SupabaseRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redactText(value: unknown) {
  return readString(value, "")
    .replace(/password["'\s:=]+[^"',\s}]+/gi, "password=[redacted]")
    .replace(/verification[_-]?code["'\s:=]+[^"',\s}]+/gi, "verification_code=[redacted]")
    .replace(/token["'\s:=]+[^"',\s}]+/gi, "token=[redacted]")
    .replace(/authorization["'\s:=]+[^"',\s}]+/gi, "authorization=[redacted]")
    .replace(/secret["'\s:=]+[^"',\s}]+/gi, "secret=[redacted]")
    .replace(/service[_-]?role["'\s:=]+[^"',\s}]+/gi, "service_role=[redacted]")
    .slice(0, 500);
}

function readMetadata(row: SupabaseRecord | null | undefined) {
  return isRecord(row?.metadata_safe) ? row.metadata_safe as SupabaseRecord
    : isRecord(row?.metadata) ? row.metadata as SupabaseRecord
      : {};
}

function readPayload(row: SupabaseRecord | null | undefined) {
  return isRecord(row?.payload) ? row.payload as SupabaseRecord : {};
}

function requestIdMatches(row: SupabaseRecord, requestId: string) {
  if (!requestId) return true;
  const payload = readPayload(row);
  return readString(payload.request_id, "") === requestId;
}

function readLoginProvisionerSummary(logRows: SupabaseRecord[], requestId: string) {
  for (const row of logRows) {
    const actionType = readString(row.action_type, "");
    if (actionType !== "manual_run_completed" && actionType !== "manual_run_failed") continue;
    if (!requestIdMatches(row, requestId)) continue;
    const payload = readPayload(row);
    if (isRecord(payload.login_provisioner_summary)) return payload.login_provisioner_summary as SupabaseRecord;
  }
  return null;
}

function loginFailureClientReason(loginSummary: SupabaseRecord | null, fallback: string) {
  if (!loginSummary) return fallback;
  const finalOutcome = readString(loginSummary.final_outcome, "").toLowerCase();
  const reason = readString(loginSummary.reason, readString(loginSummary.failure_reason, ""));
  const credentialsError = readString(loginSummary.credentials_error_code, readString(loginSummary.credentials_invalid_reason, ""));
  const packageMismatch = loginSummary.package_guard_mismatch === true;
  const submitExecuted = loginSummary.submit_executed === true;
  const screenType = readString(loginSummary.screen_type, "");

  if (credentialsError) {
    if (credentialsError.includes("not_found") || credentialsError.includes("missing")) {
      return "Vault credentials could not be read.";
    }
    return "Vault credentials could not be read.";
  }
  if (packageMismatch && !submitExecuted) {
    const actualPackage = readString(loginSummary.actual_foreground_package, "");
    if (actualPackage.includes("credentialmanager")) {
      return "Android autofill interrupted login before credentials were submitted.";
    }
    return "Login form detected but credentials were not submitted.";
  }
  if (!submitExecuted && (screenType === "login_form_empty" || finalOutcome === "wrong_app_package")) {
    return "Login form detected but credentials were not submitted.";
  }
  if (reason.includes("username_field") || reason.includes("password_field") || reason.includes("login_button")) {
    return "Username/password field not found on the login form.";
  }
  if (reason) return redactText(reason).slice(0, 180);
  if (finalOutcome) return redactText(finalOutcome).slice(0, 180);
  return fallback;
}

function dedupeProcessLogs<T extends { id?: string; timestamp?: string; phase?: string; message?: string }>(logs: T[]) {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of logs) {
    const key = readString(item.id, "") || `${readString(item.timestamp, "")}:${readString(item.phase, "")}:${readString(item.message, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped.sort((left, right) => readString(left.timestamp, "").localeCompare(readString(right.timestamp, "")));
}

function joinLandingProgressLogs(loginSummary: SupabaseRecord | null) {
  if (!loginSummary?.join_instagram_landing_detected) return [];
  const logs = [
    {
      id: "join_instagram_landing_detected",
      timestamp: readString(loginSummary.created_at, "") || new Date().toISOString(),
      phase: "LOGIN",
      message: "Join Instagram landing detected",
    },
  ];
  if (loginSummary.already_have_profile_tap_sent || loginSummary.join_instagram_existing_profile_path_used) {
    logs.push({
      id: "already_have_profile_tap_sent",
      timestamp: readString(loginSummary.created_at, "") || new Date().toISOString(),
      phase: "LOGIN",
      message: "Using existing profile path",
    });
  }
  if (loginSummary.login_form_after_join_landing_detected) {
    logs.push({
      id: "login_form_after_join_landing_detected",
      timestamp: readString(loginSummary.created_at, "") || new Date().toISOString(),
      phase: "LOGIN",
      message: "Login form opened",
    });
  }
  return logs;
}

async function authorizeProgress(request: Request, accountId: string) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return { ok: true, audience: "admin" as const };
  if (!relayAuth.ok) {
    return { ok: false, response: jsonError("Run progress relay authentication failed.", relayAuthStatus(compassRelayAuthFailureReason(relayAuth)), { reason: compassRelayAuthFailureReason(relayAuth) }) };
  }

  const userContext = await getInstagramUserContext();
  if (!userContext?.userId) {
    return { ok: false, response: jsonError("Authentication required.", 401) };
  }
  if (canAccessTenantPages(userContext)) return { ok: true, audience: "admin" as const };

  const supabase = createSupabaseClient();
  const { data, error } = await supabase.rpc("client_can_manage_instagram_account", {
    p_auth_user_id: userContext.userId,
    p_account_id: accountId,
  });
  if (error) return { ok: false, response: jsonError("Account ownership check failed.", 503) };
  if (!data) return { ok: false, response: jsonError("You are not allowed to view this account progress.", 403) };
  return { ok: true, audience: "client" as const };
}

function step(id: string, label: string, subtitle: string, status: string, row?: SupabaseRecord | null) {
  return {
    id,
    label,
    subtitle,
    status,
    started_at: readString(row?.created_at, null as unknown as string) || null,
    completed_at: TERMINAL_REQUEST_STATUSES.has(readString(row?.status, "").toLowerCase())
      ? readString(row?.updated_at, null as unknown as string) || null
      : null,
    metadata_safe: {},
  };
}

function accountStatusConnected(accountRow: SupabaseRecord | null) {
  return readString(accountRow?.login_status, "").toLowerCase() === "connected";
}

function inferOverallStatus(requestRow: SupabaseRecord | null, runRow: SupabaseRecord | null, actionRows: SupabaseRecord[], logRows: SupabaseRecord[], accountRow: SupabaseRecord | null = null) {
  const activeAction = actionRows.find((row) => ACTION_REQUIRED_TYPES.has(readString(row.action_type, "")) && ACTIVE_ACTION_STATUSES.has(readString(row.status, "").toLowerCase()));
  if (activeAction) return "action_required";
  if (accountStatusConnected(accountRow)) return "connected";

  const requestId = readString(requestRow?.id, "");
  const loginSummary = readLoginProvisionerSummary(logRows, requestId);
  const loginOutcome = readString(loginSummary?.final_outcome, "").toLowerCase();
  const loginPublished = loginSummary?.published === true;
  const requestStatus = readString(requestRow?.status, "").toLowerCase();
  const runStatus = readString(runRow?.status, "").toLowerCase();
  if (["completed", "success", "connected"].includes(runStatus) && (!loginSummary || loginPublished || loginOutcome !== "connected")) return "connected";
  if (loginOutcome === "connected" && loginPublished) return "connected";
  if (loginOutcome === "connected" && !loginPublished) return "status_sync_missing";
  if (["failed", "blocked"].includes(requestStatus) || ["failed", "error"].includes(runStatus)) return "failed";
  if (["canceled", "cancelled", "stopped"].includes(requestStatus) || runStatus === "stopped") return "stopped";
  if (requestStatus === "queued") return "queued";
  if (["claimed", "starting"].includes(requestStatus)) return "claimed";
  if (ACTIVE_RUN_STATUSES.has(runStatus) || requestStatus === "running") return "running";
  if (requestStatus === "completed") return runRow ? "completed" : "run_link_missing";
  return requestRow ? "queued" : "unknown";
}

function buildSteps(requestRow: SupabaseRecord | null, runRow: SupabaseRecord | null, actionRows: SupabaseRecord[], logRows: SupabaseRecord[], accountRow: SupabaseRecord | null = null) {
  const requestStatus = readString(requestRow?.status, "").toLowerCase();
  const runStatus = readString(runRow?.status, "").toLowerCase();
  const requestId = readString(requestRow?.id, "");
  const loginSummary = readLoginProvisionerSummary(logRows, requestId);
  const appOpened = loginSummary?.app_start_ok === true;
  const joinLandingDetected = loginSummary?.join_instagram_landing_detected === true;
  const existingProfilePathUsed = loginSummary?.already_have_profile_tap_sent === true || loginSummary?.join_instagram_existing_profile_path_used === true;
  const loginFormAfterJoinDetected = loginSummary?.login_form_after_join_landing_detected === true;
  const loginFormEmptyDetected = loginSummary?.login_form_empty_detected === true || readString(loginSummary?.screen_type, "") === "login_form_empty";
  const credentialsSubmitted = loginSummary?.submit_executed === true;
  const credentialsReadFailed = Boolean(readString(loginSummary?.credentials_error_code, readString(loginSummary?.credentials_invalid_reason, "")));
  const packageInterrupted = loginSummary?.package_guard_mismatch === true && !credentialsSubmitted;
  const fieldMissingFailure = /username_field|password_field|login_button/.test(
    readString(loginSummary?.reason, readString(loginSummary?.failure_reason, "")),
  );
  const localConnected = readString(loginSummary?.final_outcome, "").toLowerCase() === "connected";
  const overall = inferOverallStatus(requestRow, runRow, actionRows, logRows, accountRow);
  const hasRequest = Boolean(requestRow);
  const hasRun = Boolean(runRow);
  const actionRequired = overall === "action_required";
  const failed = overall === "failed";
  const statusSyncMissing = overall === "status_sync_missing";
  const runLinkMissing = overall === "run_link_missing";
  const connected = overall === "connected";
  const credentialsFailureDetail = credentialsReadFailed
    ? "Vault credentials could not be read."
    : packageInterrupted
      ? "Android autofill interrupted login before credentials were submitted."
      : fieldMissingFailure
        ? "Username/password field not found on the login form."
        : failed && loginFormEmptyDetected && !credentialsSubmitted
          ? "Login form detected but credentials were not submitted."
          : loginFormAfterJoinDetected || loginFormEmptyDetected
            ? "Login form opened; credentials are handled through Vault/runtime boundaries."
            : "Credentials are handled by the worker through Vault/runtime boundaries.";
  const identityFailureDetail = actionRequired
    ? "Manual phone action required before identity can be verified."
    : statusSyncMissing
      ? "Identity verified locally; backend status publish is missing."
      : credentialsReadFailed
        ? "Vault credentials could not be read."
        : packageInterrupted || (failed && loginFormEmptyDetected && !credentialsSubmitted)
          ? "Login form detected but credentials were not submitted."
          : fieldMissingFailure
            ? "Username/password field not found on the login form."
            : "Expected account identity guard.";

  return [
    step("queue_request", "Queue request", hasRequest ? `request ${readString(requestRow?.id).slice(0, 8)} · ${requestStatus || "queued"}` : "Waiting for backend request.", hasRequest ? "done" : "pending", requestRow),
    step("dispatcher_claim", "Dispatcher claim", hasRun || ["claimed", "starting", "running", "completed"].includes(requestStatus) ? `dispatcher status ${requestStatus}` : "Waiting for dispatcher claim.", hasRun || ["claimed", "starting", "running", "completed"].includes(requestStatus) ? "done" : hasRequest ? "running" : "pending", requestRow),
    step("open_instagram", "Open Instagram", hasRun ? `run ${readString(runRow?.id).slice(0, 8)} · ${runStatus || "running"}` : appOpened ? "Instagram package opened by login worker." : "Worker has not linked a run yet.", hasRun ? (ACTIVE_RUN_STATUSES.has(runStatus) ? "running" : "done") : appOpened ? "done" : "pending", runRow),
    step("check_session", "Check current session", joinLandingDetected ? "Join Instagram landing detected." : actionRequired ? "Instagram requires manual confirmation." : runLinkMissing ? "Worker finished without run/status evidence." : "Worker checks the current Instagram session.", actionRequired ? "action_required" : connected || statusSyncMissing || localConnected || existingProfilePathUsed ? "done" : failed ? "failed" : hasRun ? "running" : "pending", runRow),
    step("enter_credentials", "Enter credentials", credentialsFailureDetail, connected || statusSyncMissing || localConnected || credentialsSubmitted ? "done" : actionRequired ? "skipped" : failed && (credentialsReadFailed || packageInterrupted || fieldMissingFailure || loginFormEmptyDetected) ? "failed" : loginFormAfterJoinDetected || loginFormEmptyDetected || hasRun ? "running" : "pending", runRow),
    step("verify_identity", "Verify identity", identityFailureDetail, actionRequired ? "action_required" : connected || statusSyncMissing || localConnected || credentialsSubmitted ? "done" : failed && !credentialsSubmitted ? "failed" : hasRun ? "running" : "pending", runRow),
    step("save_login_status", "Save login status", connected ? "Login status saved." : statusSyncMissing ? "Worker connected locally but did not publish account status." : actionRequired ? "Waiting for manual completion." : failed ? "Run failed before ready status." : "Waiting for terminal login status.", connected ? "done" : statusSyncMissing ? "failed" : actionRequired ? "action_required" : failed ? "failed" : "pending", runRow),
  ];
}

function safeLog(row: SupabaseRecord, index: number) {
  return {
    id: readString(row.id, `${index}`),
    timestamp: readString(row.created_at, ""),
    phase: readString(row.action_type, readString(row.status, "event")).slice(0, 80),
    message: redactText(row.message ?? row.status ?? "runtime event"),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const accountId = getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const auth = await authorizeProgress(request, accountId);
    if (!auth.ok) return auth.response;
    const clientView = auth.audience === "client" || url.searchParams.get("audience") === "client";

    const requestId = url.searchParams.get("request_id")?.trim() ?? "";
    const supabase = createSupabaseClient();
    let requestQuery = supabase
      .from("account_run_requests")
      .select("id,account_id,status,requested_run_type,run_id,created_at,updated_at,error_code,error_message_safe,metadata_safe")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (requestId) requestQuery = requestQuery.eq("id", requestId);

    const { data: requestRows, error: requestError } = await requestQuery;
    if (requestError) return jsonError("Run request progress unavailable.", 503);
    const requestRow = ((requestRows ?? []) as SupabaseRecord[])[0] ?? null;
    const linkedRunId = readString(requestRow?.run_id, "");

    let runRows: SupabaseRecord[] = [];
    if (linkedRunId) {
      const { data, error } = await supabase
        .from("ig_runs")
        .select("id,account_id,status,created_at,updated_at,started_at,finished_at,worker_type,error_message")
        .eq("id", linkedRunId)
        .limit(1);
      if (!error) runRows = (data ?? []) as SupabaseRecord[];
    } else {
      const { data, error } = await supabase
        .from("ig_runs")
        .select("id,account_id,status,created_at,updated_at,started_at,finished_at,worker_type,error_message")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!error) runRows = (data ?? []) as SupabaseRecord[];
    }
    const runRow = runRows[0] ?? null;
    const runId = readString(runRow?.id, linkedRunId);

    const [{ data: accountData }, { data: actionsData }, { data: logsData }] = await Promise.all([
      supabase
        .from("client_instagram_accounts")
        .select("login_status,provisioning_status,onboarding_status,updated_at")
        .eq("account_id", accountId)
        .limit(1)
        .maybeSingle<SupabaseRecord>(),
      supabase
        .from("account_dashboard_actions")
        .select("id,account_id,action_type,status,title,safe_client_message,updated_at,created_at,metadata")
        .eq("account_id", accountId)
        .in("action_type", [...ACTION_REQUIRED_TYPES])
        .order("updated_at", { ascending: false })
        .limit(5),
      supabase
        .from("ig_action_logs")
        .select("id,account_id,run_id,action_type,status,message,payload,created_at")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const accountRow = (accountData ?? null) as SupabaseRecord | null;
    const actionRows = ((actionsData ?? []) as SupabaseRecord[]);
    const logRows = ((logsData ?? []) as SupabaseRecord[])
      .filter((row) => !runId || !readString(row.run_id, "") || readString(row.run_id, "") === runId)
      .slice(0, 12);
    const activeAction = actionRows.find((row) => ACTION_REQUIRED_TYPES.has(readString(row.action_type, "")) && ACTIVE_ACTION_STATUSES.has(readString(row.status, "").toLowerCase())) ?? null;
    const overallStatus = inferOverallStatus(requestRow, runRow, actionRows, logRows, accountRow);
    const statusSyncMissing = overallStatus === "status_sync_missing";
    const runLinkMissing = overallStatus === "run_link_missing";
    const reason = statusSyncMissing
      ? "Worker connected locally but did not publish account status."
      : runLinkMissing
        ? "Worker finished but did not link a run or publish terminal login evidence."
        : loginFailureClientReason(
            readLoginProvisionerSummary(logRows, readString(requestRow?.id, "")),
            readString(activeAction?.safe_client_message, readString(requestRow?.error_message_safe, readString(runRow?.error_message, readString(requestRow?.status, overallStatus)))),
          );

    const processLog = dedupeProcessLogs([
      ...joinLandingProgressLogs(readLoginProvisionerSummary(logRows, readString(requestRow?.id, ""))),
      ...(clientView
        ? logRows.slice(0, 5).map((row, index) => safeLog(row, index))
        : logRows.map((row, index) => safeLog(row, index))),
    ]);

    return jsonOk({
      account_id: accountId,
      request_id: readString(requestRow?.id, requestId) || null,
      request_status: readString(requestRow?.status, "") || null,
      requested_run_type: readString(requestRow?.requested_run_type, "") || null,
      run_id: runId || null,
      run_status: readString(runRow?.status, "") || null,
      status: overallStatus,
      reason: clientView ? redactText(reason).slice(0, 180) : redactText(reason),
      action_required: activeAction ? {
        id: readString(activeAction.id, ""),
        action_type: readString(activeAction.action_type, ""),
        status: readString(activeAction.status, ""),
        title: readString(activeAction.title, "Action required"),
        message: readString(activeAction.safe_client_message, "Instagram requires a code or confirmation."),
      } : null,
      steps: buildSteps(requestRow, runRow, actionRows, logRows, accountRow),
      process_log: [
        ...joinLandingProgressLogs(readLoginProvisionerSummary(logRows, readString(requestRow?.id, ""))),
        ...(clientView
          ? logRows.slice(0, 5).map((row, index) => safeLog(row, index))
          : logRows.map((row, index) => safeLog(row, index))),
      ],
      generated_at: new Date().toISOString(),
      metadata_safe: {
        request_created_at: readString(requestRow?.created_at, "") || null,
        run_created_at: readString(runRow?.created_at, "") || null,
        request_metadata: clientView ? {} : readMetadata(requestRow),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load run progress.";
    return jsonError(redactText(message), 500);
  }
}
