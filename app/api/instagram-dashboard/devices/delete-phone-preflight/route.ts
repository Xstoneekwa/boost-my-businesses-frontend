import { adminDashboardConfig } from "../admin-dashboard-config";
import { jsonError, jsonOk, readJsonBody, readString, requireRelayOrAdmin } from "../../_utils";
import { forwardDeletePhonePreflight } from "./forward";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Delete phone preflight");
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<Record<string, unknown>>(request);
    const deviceId = readString(body?.device_id ?? body?.deviceId, "").trim();
    if (!deviceId) return jsonError("device_id is required.", 400);

    const config = adminDashboardConfig();
    if (!config) return jsonError("Admin dashboard API config is missing.", 500);

    const forwarded = await forwardDeletePhonePreflight(deviceId, config);
    if (!forwarded.ok) return jsonError(forwarded.message, forwarded.status);

    return jsonOk(forwarded.data);
  } catch {
    return jsonError("Could not load delete preflight.", 500);
  }
}
