import { getDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, readJsonBody, readString } from "../../_utils";

export const dynamic = "force-dynamic";

type SubmitPayload = {
  action_id?: unknown;
  account_id?: unknown;
  verification_code?: unknown;
};

const CODE_RE = /^[A-Za-z0-9-]{4,32}$/;

export async function POST(request: Request) {
  const userContext = await getDashboardUserContext();
  if (!userContext?.userId) {
    return jsonError("Authentication required.", 401);
  }

  const payload = (await readJsonBody<SubmitPayload>(request)) ?? {};
  const actionId = readString(payload.action_id);
  const accountId = readString(payload.account_id);
  const verificationCode = readString(payload.verification_code);

  if (!actionId || !accountId || !verificationCode || !CODE_RE.test(verificationCode)) {
    return jsonError("Invalid verification payload.", 400);
  }

  const supabase = createSupabaseClient();
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

  const { data, error } = await supabase.rpc("submit_account_verification_code", {
    p_action_id: actionId,
    p_account_id: accountId,
    p_verification_code: verificationCode,
    p_actor_type: "client",
    p_actor_id: userContext.userId,
    p_metadata: {
      source: "frontend_credentials_actions",
    },
  });

  if (error) {
    const message = error.message.includes("verification_code_invalid")
      ? "Invalid verification code."
      : error.message.includes("dashboard_action_not_found")
      ? "Dashboard action not found."
      : error.message.includes("dashboard_action_type_invalid")
      ? "This dashboard action does not accept a verification code."
      : "Verification code submission failed.";
    const status = message.includes("Invalid") ? 400
      : message.includes("not found") ? 404
      : message.includes("does not accept") ? 409
      : 500;
    return jsonError(message, status);
  }

  return jsonOk({
    action_id: actionId,
    account_id: accountId,
    status: readString((data as Record<string, unknown> | null)?.status, "code_submitted"),
    message: "Verification code stored securely and ready for worker resume.",
  });
}
