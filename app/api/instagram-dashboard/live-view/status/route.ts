import {
  getAccountId,
  jsonError,
  jsonOk,
  requireInstagramAdmin,
  validateAccountId,
} from "../../_utils";
import {
  adminDashboardConfig,
  forwardLiveViewToAdminDashboard,
  liveViewStatusPayload,
} from "../../../../instagram-dashboard/live-view-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const accountId = getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const config = adminDashboardConfig();
    if (!config) return jsonError("Admin dashboard API config is missing.", 500);

    const forwarded = await forwardLiveViewToAdminDashboard(
      liveViewStatusPayload(accountId),
      config,
    );

    if (!forwarded.ok) return jsonError(forwarded.message, forwarded.status, { code: forwarded.code });
    return jsonOk(forwarded);
  } catch {
    return jsonError("Could not load live view status.", 500);
  }
}
