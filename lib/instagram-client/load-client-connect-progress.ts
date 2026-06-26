import { createSupabaseClient } from "@/lib/supabase";
import { readString } from "./guards";
import { projectClientConnectProgress } from "./connect-progress-projection";
import { isCanonicalVerificationPending } from "./connect-operation-state";
import { verifyConnectOperationToken } from "./connect-operation-token";
import {
  evaluateConnectChallengeChainActive,
  findActiveVerificationAction,
} from "./connect-challenge-chain";

const ACTION_REQUIRED_TYPES = new Set([
  "enter_email_verification_code",
  "complete_two_factor",
  "resolve_checkpoint",
  "review_login_challenge",
  "update_instagram_password",
  "review_account_mismatch",
]);
const ACTIVE_ACTION_STATUSES = new Set(["pending", "acknowledged", "pending_verification", "code_submitted", "open"]);
const ACTIVE_REQUEST_STATUSES = new Set(["queued", "claimed", "starting", "running"]);
const TERMINAL_REQUEST_STATUSES = new Set(["failed", "blocked", "canceled", "completed"]);
const EMAIL_CODE_ACTION = "enter_email_verification_code";
const REQUEST_SELECT = "id,account_id,status,run_id,created_at,updated_at,error_message_safe,metadata_safe,idempotency_key";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readActionMetadata(row: Record<string, unknown> | null | undefined) {
  if (isRecord(row?.metadata)) return row.metadata as Record<string, unknown>;
  if (isRecord(row?.metadata_safe)) return row.metadata_safe as Record<string, unknown>;
  return {};
}

function readConnectAttemptId(row: Record<string, unknown> | null | undefined) {
  const metadata = readActionMetadata(row);
  const fromMetadata = readString(metadata.connect_attempt_id);
  if (fromMetadata) return fromMetadata;
  const parts = readString(row?.idempotency_key).split(":");
  return parts.length >= 3 ? readString(parts[parts.length - 1]) : "";
}

function inferOverallStatus(input: {
  requestStatus: string;
  runStatus: string;
  loginStatus: string;
  provisioningStatus: string;
  actionRows: Record<string, unknown>[];
  challengeChainActive: boolean;
}) {
  const verificationPending = input.challengeChainActive && isCanonicalVerificationPending({
    loginStatus: input.loginStatus,
    provisioningStatus: input.provisioningStatus,
  });
  const activeAction = findActiveVerificationAction(input.actionRows);
  if (activeAction || verificationPending) return "action_required";
  if (readString(input.loginStatus).toLowerCase() === "connected") return "connected";
  const requestStatus = readString(input.requestStatus).toLowerCase();
  const runStatus = readString(input.runStatus).toLowerCase();
  if (requestStatus === "failed" || runStatus === "failed") return "failed";
  if (requestStatus === "blocked") return "blocked";
  if (requestStatus === "queued") return "queued";
  if (["claimed", "starting", "running"].includes(requestStatus)) return "running";
  if (["running", "started", "in_progress"].includes(runStatus)) return "running";
  return requestStatus || "unknown";
}

function buildActionRequired(input: {
  activeAction: Record<string, unknown> | null;
  loginStatus: string;
  provisioningStatus: string;
  challengeChainActive: boolean;
  lang?: "fr" | "en";
}) {
  const lang = input.lang ?? "fr";
  const verificationPending = input.challengeChainActive && isCanonicalVerificationPending({
    loginStatus: input.loginStatus,
    provisioningStatus: input.provisioningStatus,
  });
  if (!input.activeAction && !verificationPending) return null;

  const action = input.activeAction;
  const metadata = readActionMetadata(action);
  const actionType = readString(action?.action_type, EMAIL_CODE_ACTION);
  const actionStatus = readString(action?.status, verificationPending ? "pending_verification" : "");
  return {
    id: readString(action?.id),
    action_type: actionType,
    status: actionStatus,
    title: readString(action?.title, lang === "fr" ? "Vérification requise" : "Verification required"),
    message: readString(
      action?.safe_client_message,
      lang === "fr"
        ? "Instagram demande une vérification avant de terminer la connexion de votre compte."
        : "Instagram requires verification before your account connection can finish.",
    ),
    resume_status: readString(metadata.resume_status, "") || null,
  };
}

async function loadLoginProvisioningRequestById(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  requestId: string,
) {
  const { data, error } = await supabase
    .from("account_run_requests")
    .select(REQUEST_SELECT)
    .eq("account_id", accountId)
    .eq("requested_run_type", "login_provisioning")
    .eq("id", readString(requestId))
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("connect_progress_unavailable");
  return (data ?? null) as Record<string, unknown> | null;
}

async function loadLoginProvisioningRequestByAttemptId(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  connectAttemptId: string,
) {
  const { data, error } = await supabase
    .from("account_run_requests")
    .select(REQUEST_SELECT)
    .eq("account_id", accountId)
    .eq("requested_run_type", "login_provisioning")
    .contains("metadata_safe", { connect_attempt_id: connectAttemptId })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("connect_progress_unavailable");
  if (data) return data as Record<string, unknown>;

  const { data: fallbackRows, error: fallbackError } = await supabase
    .from("account_run_requests")
    .select(REQUEST_SELECT)
    .eq("account_id", accountId)
    .eq("requested_run_type", "login_provisioning")
    .order("created_at", { ascending: false })
    .limit(20);
  if (fallbackError) throw new Error("connect_progress_unavailable");
  const rows = ((fallbackRows ?? []) as Record<string, unknown>[]);
  return rows.find((row) => readConnectAttemptId(row) === connectAttemptId) ?? null;
}

async function loadLinkedRun(
  supabase: ReturnType<typeof createSupabaseClient>,
  runId: string,
) {
  const { data } = await supabase
    .from("ig_runs")
    .select("id,status,created_at,updated_at")
    .eq("id", runId)
    .limit(1)
    .maybeSingle();
  return (data ?? null) as Record<string, unknown> | null;
}

async function loadResumeRequestStatus(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  action: Record<string, unknown> | null,
) {
  const metadata = readActionMetadata(action);
  const resumeRequestId = readString(metadata.resume_request_id);
  if (!resumeRequestId) return null;

  const { data } = await supabase
    .from("account_run_requests")
    .select("id,status,requested_run_type")
    .eq("account_id", accountId)
    .eq("id", resumeRequestId)
    .eq("requested_run_type", "login_email_code_resume")
    .limit(1)
    .maybeSingle();

  return readString((data as Record<string, unknown> | null)?.status, "") || null;
}

export async function loadClientConnectProgress(input: {
  accountId: string;
  requestId?: string;
  connectOperationToken?: string;
  actorUserId?: string;
  lang?: "fr" | "en";
}) {
  const supabase = createSupabaseClient();
  const accountId = readString(input.accountId);
  let correlatedAttemptId = "";
  let correlatedRequestId = readString(input.requestId);

  if (input.connectOperationToken && input.actorUserId) {
    const verified = verifyConnectOperationToken(input.connectOperationToken, {
      accountId,
      actorUserId: input.actorUserId,
    });
    if (verified.ok) {
      correlatedAttemptId = verified.payload.connect_attempt_id;
      if (!correlatedRequestId && verified.payload.request_id) {
        correlatedRequestId = verified.payload.request_id;
      }
    }
  }

  let requestRow: Record<string, unknown> | null = null;
  let runRow: Record<string, unknown> | null = null;

  if (correlatedRequestId) {
    requestRow = await loadLoginProvisioningRequestById(supabase, accountId, correlatedRequestId);
    const linkedRunId = readString(requestRow?.run_id);
    if (linkedRunId) runRow = await loadLinkedRun(supabase, linkedRunId);
  }

  if (!requestRow || ACTIVE_REQUEST_STATUSES.has(readString(requestRow.status).toLowerCase())) {
    let requestQuery = supabase
      .from("account_run_requests")
      .select(REQUEST_SELECT)
      .eq("account_id", accountId)
      .eq("requested_run_type", "login_provisioning")
      .in("status", ["queued", "claimed", "starting", "running"])
      .order("created_at", { ascending: false })
      .limit(1);
    if (correlatedRequestId) requestQuery = requestQuery.eq("id", correlatedRequestId);

    const { data: requestRows, error: requestError } = await requestQuery;
    if (requestError) throw new Error("connect_progress_unavailable");
    const activeRow = ((requestRows ?? [])[0] ?? null) as Record<string, unknown> | null;
    if (activeRow) {
      requestRow = activeRow;
      const linkedRunId = readString(requestRow?.run_id);
      if (linkedRunId) runRow = await loadLinkedRun(supabase, linkedRunId);
    }
  }

  const [{ data: accountData }, { data: actionsData }] = await Promise.all([
    supabase
      .from("client_instagram_accounts")
      .select("login_status,provisioning_status,onboarding_status")
      .eq("account_id", accountId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("account_dashboard_actions")
      .select("id,account_id,action_type,status,title,safe_client_message,updated_at,metadata")
      .eq("account_id", accountId)
      .in("action_type", [...ACTION_REQUIRED_TYPES])
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);

  const accountRow = (accountData ?? null) as Record<string, unknown> | null;
  const actionRows = ((actionsData ?? []) as Record<string, unknown>[]);
  const activeAction = findActiveVerificationAction(actionRows);

  const loginStatus = readString(accountRow?.login_status);
  const provisioningStatus = readString(accountRow?.provisioning_status);
  const staleVerificationPending = isCanonicalVerificationPending({ loginStatus, provisioningStatus });

  if (!requestRow && (activeAction || staleVerificationPending) && correlatedAttemptId) {
    requestRow = await loadLoginProvisioningRequestByAttemptId(supabase, accountId, correlatedAttemptId);
    const latestRunId = readString(requestRow?.run_id);
    if (latestRunId) runRow = await loadLinkedRun(supabase, latestRunId);
  }

  if (!requestRow && correlatedAttemptId) {
    const correlated = await loadLoginProvisioningRequestByAttemptId(supabase, accountId, correlatedAttemptId);
    const correlatedStatus = readString(correlated?.status).toLowerCase();
    if (correlated && TERMINAL_REQUEST_STATUSES.has(correlatedStatus)) {
      requestRow = correlated;
      const terminalRunId = readString(requestRow?.run_id);
      if (terminalRunId) runRow = await loadLinkedRun(supabase, terminalRunId);
    }
  }

  const resumeRequestStatus = await loadResumeRequestStatus(supabase, accountId, activeAction);
  const challengeChainActive = evaluateConnectChallengeChainActive({
    requestStatus: readString(requestRow?.status),
    runStatus: readString(runRow?.status),
    activeAction,
    resumeRequestStatus,
  });
  const verificationPending = challengeChainActive && staleVerificationPending;

  const requestStatus = readString(requestRow?.status);
  const runStatus = readString(runRow?.status);
  const overallStatus = inferOverallStatus({
    requestStatus,
    runStatus,
    loginStatus,
    provisioningStatus,
    actionRows,
    challengeChainActive,
  });
  const actionRequired = buildActionRequired({
    activeAction,
    loginStatus,
    provisioningStatus,
    challengeChainActive,
    lang: input.lang,
  });

  const hasActiveRequest = Boolean(requestRow);
  const progressSteps = [
    {
      id: "queue_request",
      label: "Queue request",
      subtitle: hasActiveRequest ? "Demande de connexion reçue." : "En attente de la demande.",
      status: hasActiveRequest ? "done" : "pending",
    },
    {
      id: "open_instagram",
      label: "Open Instagram",
      subtitle: runRow ? "Connexion en cours sur le téléphone assigné." : "Préparation du téléphone assigné.",
      status: runRow ? "running" : hasActiveRequest ? "running" : "pending",
    },
    {
      id: "verify_identity",
      label: "Verify identity",
      subtitle: actionRequired
        ? actionRequired.message
        : loginStatus === "connected"
          ? "Session validée."
          : "Validation de la session.",
      status: actionRequired || verificationPending
        ? "action_required"
        : loginStatus === "connected"
          ? "done"
          : runRow
            ? "running"
            : "pending",
    },
    {
      id: "save_login_status",
      label: "Save login status",
      subtitle: loginStatus === "connected" ? "Compte connecté." : "Finalisation de la connexion.",
      status: loginStatus === "connected"
        ? "done"
        : actionRequired || verificationPending
          ? "action_required"
          : runRow
            ? "running"
            : "pending",
    },
  ];

  return projectClientConnectProgress({
    accountId,
    overallStatus,
    requestStatus,
    runStatus,
    requestId: readString(requestRow?.id, "") || null,
    resumeRequestStatus,
    reason: readString(requestRow?.error_message_safe, "") || null,
    loginStatus,
    provisioningStatus,
    actionRequired,
    steps: progressSteps,
    challengeChainActive,
    lang: input.lang,
  });
}
