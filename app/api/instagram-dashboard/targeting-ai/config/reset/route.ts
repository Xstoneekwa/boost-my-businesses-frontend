import {
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  requireRelayOrAdmin,
} from "../../../_utils";
import {
  resetTargetingAiConfig,
  serializeTargetingAiPublicConfig,
} from "@/lib/instagram-client/targeting-ai-config-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Targeting AI config reset");
  if (unauthorizedResponse) return unauthorizedResponse;

  const userContext = await getInstagramAdminUserContext();
  const updatedBy = request.headers.get("x-external-user-id")?.trim()
    || userContext?.userId
    || "botapp_relay";

  const result = await resetTargetingAiConfig(updatedBy);
  if (!result.ok) {
    return jsonError(result.reason, result.backend_pending ? 503 : 500, {
      backend_pending: result.backend_pending ?? false,
    });
  }

  return jsonOk({
    ...serializeTargetingAiPublicConfig(result.snapshot),
    reset_to: result.reset_to,
    updated_by: result.updated_by,
    log_event: "targeting_ai_config_reset",
  });
}
