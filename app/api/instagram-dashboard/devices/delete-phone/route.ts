import { adminDashboardConfig } from "../add-phone/helpers";
import { jsonError, jsonOk, readJsonBody, readString, requireRelayOrAdmin } from "../../_utils";
import { forwardDeletePhysicalPhone } from "./helpers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Delete phone");
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<Record<string, unknown>>(request);
    const deviceId = readString(body?.device_id ?? body?.deviceId, "").trim();
    const confirmationName = readString(body?.confirmation_name ?? body?.confirmationName, "").trim();
    if (!deviceId) return jsonError("device_id is required.", 400);
    if (!confirmationName) {
      return jsonError("Device delete confirmation is required.", 400, {
        reason: "device_delete_confirmation_required",
      });
    }

    const config = adminDashboardConfig();
    if (!config) return jsonError("Admin dashboard API config is missing.", 500);

    const forwarded = await forwardDeletePhysicalPhone(body || {}, config);
    if (!forwarded.ok) {
      return jsonError(forwarded.message, forwarded.status, { reason: forwarded.reason });
    }

    return jsonOk(forwarded.data);
  } catch {
    return jsonError("Could not delete phone.", 500);
  }
}
