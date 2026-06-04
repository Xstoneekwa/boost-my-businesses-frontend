import {
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireInstagramAdmin,
} from "../../_utils";
import {
  adminDashboardConfig,
  forwardLiveViewToAdminDashboard,
  liveViewStopPayload,
} from "../../../../instagram-dashboard/live-view-data";

export const dynamic = "force-dynamic";

type StopPayload = {
  account_id?: unknown;
  live_view_session_id?: unknown;
};

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<StopPayload>(request);
    const accountId = readString(body?.account_id, "").trim();
    const liveViewSessionId = readString(body?.live_view_session_id, "").trim();
    if (!accountId && !liveViewSessionId) {
      return jsonError("Missing live view session id.", 400);
    }

    const config = adminDashboardConfig();
    if (!config) return jsonError("Admin dashboard API config is missing.", 500);

    const adminContext = await getInstagramAdminUserContext();
    const forwarded = await forwardLiveViewToAdminDashboard(
      liveViewStopPayload({
        accountId,
        liveViewSessionId,
        actorId: adminContext?.userId ?? null,
      }),
      config,
    );

    if (!forwarded.ok) return jsonError(forwarded.message, forwarded.status, { code: forwarded.code });
    return jsonOk(forwarded);
  } catch {
    return jsonError("Could not stop live view.", 500);
  }
}
