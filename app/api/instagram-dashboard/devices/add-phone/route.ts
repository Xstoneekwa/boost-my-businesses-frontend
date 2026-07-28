import { jsonError, jsonOk, readJsonBody, requireInstagramAdmin } from "../../_utils";
import {
  addPhoneValidationError,
  adminDashboardConfig,
  forwardAddPhysicalPhoneToAdminDashboard,
  type AddPhonePayload,
} from "./helpers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<Record<string, unknown>>(request);
    const validationError = addPhoneValidationError(body);
    if (validationError) return jsonError(validationError, 400);

    const config = adminDashboardConfig();
    if (!config) return jsonError("Admin dashboard API config is missing.", 500);

    const forwarded = await forwardAddPhysicalPhoneToAdminDashboard(body as AddPhonePayload, config);
    if (!forwarded.ok) return jsonError(forwarded.message, forwarded.status);

    return jsonOk(forwarded.data, 201);
  } catch {
    return jsonError("Could not add phone.", 500);
  }
}
