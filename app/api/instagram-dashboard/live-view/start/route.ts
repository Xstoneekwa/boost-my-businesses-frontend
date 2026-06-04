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
  liveViewStartPayload,
} from "../../../../instagram-dashboard/live-view-data";

export const dynamic = "force-dynamic";

type StartPayload = {
  account_id?: unknown;
  mode?: unknown;
  source?: unknown;
};

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<StartPayload>(request);
    const accountId = readString(body?.account_id, "").trim();
    if (!accountId) return jsonError("Missing account_id.", 400);

    const config = adminDashboardConfig();
    if (!config) return jsonError("Admin dashboard API config is missing.", 500);

    const adminContext = await getInstagramAdminUserContext();
    const actorId = adminContext?.userId ?? null;
    const forwarded = await forwardLiveViewToAdminDashboard(
      liveViewStartPayload({
        accountId,
        mode: readString(body?.mode, "view_only") === "interactive" ? "interactive" : "view_only",
        source: readString(body?.source, "manager_row_eye") || "manager_row_eye",
        actorId,
      }),
      config,
    );

    if (!forwarded.ok) return jsonError(forwarded.message, forwarded.status, { code: forwarded.code });
    return jsonOk(forwarded);
  } catch {
    return jsonError("Could not start live view.", 500);
  }
}
