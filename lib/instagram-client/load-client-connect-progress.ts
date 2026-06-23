import { createSupabaseClient } from "@/lib/supabase";
import { readString } from "./guards";
import { projectClientConnectProgress } from "./connect-progress-projection";
import { isCanonicalVerificationPending } from "./connect-operation-state";

const ACTION_REQUIRED_TYPES = new Set([
  "enter_email_verification_code",
  "complete_two_factor",
  "resolve_checkpoint",
  "review_login_challenge",
  "update_instagram_password",
  "review_account_mismatch",
]);
const ACTIVE_ACTION_STATUSES = new Set(["pending", "acknowledged", "pending_verification", "code_submitted", "open"]);
const EMAIL_CODE_ACTION = "enter_email_verification_code";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readMetadata(row: Record<string, unknown> | null | undefined) {
  return isRecord(row?.metadata) ? row.metadata as Record<string, unknown> : {};
}

function findActiveVerificationAction(actionRows: Record<string, unknown>[]) {
  const active = actionRows.find((row) => {
    const actionType = readString(row.action_type);
    const status = readString(row.status).toLowerCase();
    return ACTION_REQUIRED_TYPES.has(actionType) && ACTIVE_ACTION_STATUSES.has(status);
  });
  if (active) return active;
  return actionRows.find((row) => readString(row.action_type) === EMAIL_CODE_ACTION) ?? null;
}

function inferOverallStatus(input: {
  requestStatus: string;
  runStatus: string;
  loginStatus: string;
  provisioningStatus: string;
  actionRows: Record<string, unknown>[];
}) {
  const verificationPending = isCanonicalVerificationPending({
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
  lang?: "fr" | "en";
}) {
  const lang = input.lang ?? "fr";
  const verificationPending = isCanonicalVerificationPending({
    loginStatus: input.loginStatus,
    provisioningStatus: input.provisioningStatus,
  });
  if (!input.activeAction && !verificationPending) return null;

  const action = input.activeAction;
  const metadata = readMetadata(action);
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

export async function loadClientConnectProgress(input: {
  accountId: string;
  requestId?: string;
  lang?: "fr" | "en";
}) {
  const supabase = createSupabaseClient();
  const accountId = readString(input.accountId);
  let requestQuery = supabase
    .from("account_run_requests")
    .select("id,account_id,status,run_id,created_at,updated_at,error_message_safe")
    .eq("account_id", accountId)
    .eq("requested_run_type", "login_provisioning")
    .in("status", ["queued", "claimed", "starting", "running"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (input.requestId) requestQuery = requestQuery.eq("id", readString(input.requestId));

  let { data: requestRows, error: requestError } = await requestQuery;
  if (requestError) throw new Error("connect_progress_unavailable");
  let requestRow = ((requestRows ?? [])[0] ?? null) as Record<string, unknown> | null;

  if (!requestRow && !input.requestId) {
    const fallback = await supabase
      .from("account_run_requests")
      .select("id,account_id,status,run_id,created_at,updated_at,error_message_safe")
      .eq("account_id", accountId)
      .eq("requested_run_type", "login_provisioning")
      .order("created_at", { ascending: false })
      .limit(1);
    if (fallback.error) throw new Error("connect_progress_unavailable");
    requestRow = ((fallback.data ?? [])[0] ?? null) as Record<string, unknown> | null;
  }
  const linkedRunId = readString(requestRow?.run_id);

  let runRow: Record<string, unknown> | null = null;
  if (linkedRunId) {
    const { data } = await supabase
      .from("ig_runs")
      .select("id,status,created_at,updated_at")
      .eq("id", linkedRunId)
      .limit(1)
      .maybeSingle();
    runRow = (data ?? null) as Record<string, unknown> | null;
  } else {
    const { data } = await supabase
      .from("ig_runs")
      .select("id,status,created_at,updated_at")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    runRow = (data ?? null) as Record<string, unknown> | null;
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
  const requestStatus = readString(requestRow?.status);
  const runStatus = readString(runRow?.status);
  const verificationPending = isCanonicalVerificationPending({ loginStatus, provisioningStatus });
  const overallStatus = inferOverallStatus({
    requestStatus,
    runStatus,
    loginStatus,
    provisioningStatus,
    actionRows,
  });
  const actionRequired = buildActionRequired({
    activeAction,
    loginStatus,
    provisioningStatus,
    lang: input.lang,
  });

  const progressSteps = [
    {
      id: "queue_request",
      label: "Queue request",
      subtitle: requestRow ? "Demande de connexion reçue." : "En attente de la demande.",
      status: requestRow ? "done" : "pending",
    },
    {
      id: "open_instagram",
      label: "Open Instagram",
      subtitle: runRow ? "Connexion en cours sur le téléphone assigné." : "Préparation du téléphone assigné.",
      status: runRow ? "running" : requestRow ? "running" : "pending",
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
    reason: readString(requestRow?.error_message_safe, "") || null,
    loginStatus,
    provisioningStatus,
    actionRequired,
    steps: progressSteps,
    lang: input.lang,
  });
}
