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
  liveViewTokenPayload,
} from "../../../../instagram-dashboard/live-view-data";

export const dynamic = "force-dynamic";

type TokenPayload = {
  live_view_session_id?: unknown;
};

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<TokenPayload>(request);
    const liveViewSessionId = readString(body?.live_view_session_id, "").trim();
    if (!liveViewSessionId) return jsonError("Missing live view session id.", 400);

    const config = adminDashboardConfig();
    if (!config) return jsonError("Admin dashboard API config is missing.", 500);

    const adminContext = await getInstagramAdminUserContext();
    const forwarded = await forwardLiveViewToAdminDashboard(
      liveViewTokenPayload({
        liveViewSessionId,
        actorId: adminContext?.userId ?? null,
      }),
      config,
    );

    if (!forwarded.ok) return jsonError(forwarded.message, forwarded.status, { code: forwarded.code });
    return jsonOk(forwarded);
  } catch {
    return jsonError("Could not create live view token.", 500);
  }
}
