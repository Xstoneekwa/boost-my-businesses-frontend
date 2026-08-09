import { jsonError, jsonOk, resolveInstagramDashboardActor } from "../_utils";
import { getDashboardDevices } from "./helpers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await resolveInstagramDashboardActor(request, "Devices");
    if (!auth.ok) return auth.response;

    return jsonOk(await getDashboardDevices());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load devices.";
    return jsonError(message, 500);
  }
}
