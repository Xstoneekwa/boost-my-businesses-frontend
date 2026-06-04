import { jsonError, jsonOk, requireInstagramAdmin } from "../../_utils";
import { adminDashboardConfig, forwardDevicesOverviewToAdminDashboard } from "../../../../instagram-dashboard/devices-live-data";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const config = adminDashboardConfig();
    if (!config) return jsonError("Admin dashboard API config is missing.", 500);

    const forwarded = await forwardDevicesOverviewToAdminDashboard(config);
    if (!forwarded.ok) return jsonError(forwarded.message, forwarded.status);

    return jsonOk(forwarded.data);
  } catch {
    return jsonError("Could not load live device inventory.", 500);
  }
}
