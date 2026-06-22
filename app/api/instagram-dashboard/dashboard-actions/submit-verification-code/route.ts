import { canAccessTenantPages, getInstagramUserContext } from "@/lib/restaurant-analytics/session";
import { createSupabaseClient } from "@/lib/supabase";
import { submitAccountVerificationCode } from "@/lib/instagram-dashboard/submit-verification-code-service";
import { jsonError, jsonOk, readJsonBody, readString } from "../../_utils";

export const dynamic = "force-dynamic";

type SubmitPayload = {
  action_id?: unknown;
  account_id?: unknown;
  verification_code?: unknown;
};

export async function POST(request: Request) {
  const userContext = await getInstagramUserContext();
  if (!userContext?.userId) {
    return jsonError("Authentication required.", 401);
  }

  const payload = (await readJsonBody<SubmitPayload>(request)) ?? {};
  const actionId = readString(payload.action_id);
  const accountId = readString(payload.account_id);
  const verificationCode = readString(payload.verification_code);

  const supabase = createSupabaseClient();
  const isInstagramAdmin = canAccessTenantPages(userContext);

  if (!isInstagramAdmin) {
    const { data: canManage, error: accessError } = await supabase.rpc("client_can_manage_instagram_account", {
      p_auth_user_id: userContext.userId,
      p_account_id: accountId,
    });

    if (accessError) {
      return jsonError("Account ownership check failed.", 503);
    }
    if (!canManage) {
      return jsonError("You are not allowed to submit a verification code for this account.", 403);
    }
  }

  const result = await submitAccountVerificationCode({
    actionId,
    accountId,
    verificationCode,
    actorId: userContext.userId,
    actorType: isInstagramAdmin ? "admin" : "client",
    metadataSource: isInstagramAdmin ? "frontend_credentials_actions" : "client_connect_verification",
    resumeActorType: isInstagramAdmin ? "admin" : "system",
  });

  if (!result.ok) {
    return jsonError(result.message, result.status, result.code ? { code: result.code } : undefined);
  }

  return jsonOk({
    action_id: result.action_id,
    account_id: result.account_id,
    status: result.status,
    submission_id: result.submission_id,
    resume_queued: result.resume_queued,
    resume_already_queued: result.resume_already_queued,
    resume_request_id: result.resume_request_id,
    resume_request_status: result.resume_request_status,
    resume_queue_reason: result.resume_queue_reason,
    message: result.message,
  });
}
