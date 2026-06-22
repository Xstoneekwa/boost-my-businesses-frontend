import { createSupabaseClient } from "@/lib/supabase";
import { readString } from "./guards";
import { projectClientConnectProgress } from "./connect-progress-projection";

const ACTION_REQUIRED_TYPES = new Set([
  "enter_email_verification_code",
  "complete_two_factor",
  "resolve_checkpoint",
  "review_login_challenge",
  "update_instagram_password",
  "review_account_mismatch",
]);
const ACTIVE_ACTION_STATUSES = new Set(["pending", "acknowledged", "pending_verification", "code_submitted", "open"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readMetadata(row: Record<string, unknown> | null | undefined) {
  return isRecord(row?.metadata) ? row.metadata as Record<string, unknown> : {};
}

function inferOverallStatus(input: {
  requestStatus: string;
  runStatus: string;
  loginStatus: string;
  actionRows: Record<string, unknown>[];
}) {
  const activeAction = input.actionRows.find((row) => {
    const actionType = readString(row.action_type);
    const status = readString(row.status).toLowerCase();
    return ACTION_REQUIRED_TYPES.has(actionType) && ACTIVE_ACTION_STATUSES.has(status);
  });
  if (activeAction) return "action_required";
  if (readString(input.loginStatus).toLowerCase() === "connected") return "connected";
  const requestStatus = readString(input.requestStatus).toLowerCase();
  const runStatus = readString(input.runStatus).toLowerCase();
  if (["failed", "blocked"].includes(requestStatus) || runStatus === "failed") return "failed";
  if (requestStatus === "queued") return "queued";
  if (["claimed", "starting", "running"].includes(requestStatus)) return "running";
  if (["running", "started", "in_progress"].includes(runStatus)) return "running";
  return requestStatus || "unknown";
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
    .order("created_at", { ascending: false })
    .limit(1);
  if (input.requestId) requestQuery = requestQuery.eq("id", readString(input.requestId));

  const { data: requestRows, error: requestError } = await requestQuery;
  if (requestError) throw new Error("connect_progress_unavailable");
  const requestRow = ((requestRows ?? [])[0] ?? null) as Record<string, unknown> | null;
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
  const activeAction = actionRows.find((row) => {
    const actionType = readString(row.action_type);
    const status = readString(row.status).toLowerCase();
    return ACTION_REQUIRED_TYPES.has(actionType) && ACTIVE_ACTION_STATUSES.has(status);
  }) ?? null;

  const loginStatus = readString(accountRow?.login_status);
  const requestStatus = readString(requestRow?.status);
  const runStatus = readString(runRow?.status);
  const overallStatus = inferOverallStatus({ requestStatus, runStatus, loginStatus, actionRows });

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
      subtitle: activeAction
        ? readString(activeAction.safe_client_message, "Vérification Instagram requise.")
        : loginStatus === "connected"
          ? "Session validée."
          : "Validation de la session.",
      status: activeAction ? "action_required" : loginStatus === "connected" ? "done" : runRow ? "running" : "pending",
    },
    {
      id: "save_login_status",
      label: "Save login status",
      subtitle: loginStatus === "connected" ? "Compte connecté." : "Finalisation de la connexion.",
      status: loginStatus === "connected" ? "done" : activeAction ? "action_required" : runRow ? "running" : "pending",
    },
  ];

  const metadata = readMetadata(activeAction);
  return projectClientConnectProgress({
    accountId,
    overallStatus,
    requestStatus,
    runStatus,
    requestId: readString(requestRow?.id, "") || null,
    reason: readString(requestRow?.error_message_safe, "") || null,
    loginStatus,
    actionRequired: activeAction ? {
      id: readString(activeAction.id),
      action_type: readString(activeAction.action_type),
      status: readString(activeAction.status),
      title: readString(activeAction.title, "Vérification requise"),
      message: readString(activeAction.safe_client_message, ""),
      resume_status: readString(metadata.resume_status, "") || null,
    } : null,
    steps: progressSteps,
    lang: input.lang,
  });
}
