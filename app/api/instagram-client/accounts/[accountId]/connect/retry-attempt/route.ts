import { readString } from "@/app/api/instagram-dashboard/_utils";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { cancelClientConnectAttempt } from "@/lib/instagram-client/cancel-client-connect-attempt";
import { connectClientInstagramAccount } from "@/lib/instagram-client/connect-account";
import { createSupabaseClient } from "@/lib/supabase";
import { clientConnectError, clientConnectOk } from "../connect-response";

export const dynamic = "force-dynamic";

const ACTIVE_LOGIN_REQUEST_STATUSES = ["queued", "claimed", "starting", "running"];

export async function POST(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return clientConnectError({
      status: "blocked",
      code: session.status === 401 ? "authentication_required" : "forbidden",
      message: session.error,
      httpStatus: session.status,
    });
  }

  const { accountId } = await context.params;
  const normalizedAccountId = readString(accountId);
  if (!normalizedAccountId) {
    return clientConnectError({
      status: "not_created",
      code: "missing_account_id",
      message: "Missing account id.",
      httpStatus: 400,
    });
  }

  const authorized = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
  if (!authorized.ok) {
    return clientConnectError({
      status: "blocked",
      code: "forbidden",
      message: authorized.error,
      httpStatus: authorized.status,
    });
  }

  try {
    const supabase = createSupabaseClient();
    const { data: activeRequest, error: activeRequestError } = await supabase
      .from("account_run_requests")
      .select("id,status,requested_run_type")
      .eq("account_id", normalizedAccountId)
      .in("requested_run_type", ["login_provisioning", "login_email_code_resume"])
      .in("status", ACTIVE_LOGIN_REQUEST_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeRequestError) throw new Error("active_login_request_unavailable");

    if (activeRequest) {
      return clientConnectOk({
        connectStatus: "already_queued",
        status: "checking_connection",
        message: "La connexion est déjà en cours.",
        request_queued: true,
        connected: false,
        retry_started: false,
        retry_reason: "active_login_request",
        request_id: readString(activeRequest.id) || null,
      });
    }

    const canceled = await cancelClientConnectAttempt({
      accountId: normalizedAccountId,
      reason: "client_refresh_retry_login",
      actorUserId: session.userId,
      dismissRetryableLoginReview: true,
    });
    const result = await connectClientInstagramAccount({
      accountId: normalizedAccountId,
      userId: session.userId,
      clientId: session.clientId,
    });

    if (result.passive_blocked) {
      return clientConnectError({
        status: "blocked",
        code: "connect_readiness_not_satisfied",
        message: result.message,
        httpStatus: 409,
        reason: result.reason,
        client_readiness_status: result.client_readiness_status,
        data: { account: result.account, canceled },
      });
    }

    if (result.connectStatus === "not_created" || result.connectStatus === "failed") {
      return clientConnectError({
        status: result.connectStatus,
        code: result.connectStatus === "not_created" ? "connect_request_rejected" : "connect_failed",
        message: result.message,
        httpStatus: result.connectStatus === "not_created" ? 409 : 500,
        reason: result.reason,
        data: { account: result.account, canceled },
      });
    }

    return clientConnectOk({
      ...result,
      retry_started: result.request_queued,
      retry_reason: "client_refresh_retry_login",
      canceled,
    });
  } catch {
    return clientConnectError({
      status: "failed",
      code: "connect_retry_failed",
      message: "Impossible de relancer la connexion pour le moment.",
      httpStatus: 503,
    });
  }
}
