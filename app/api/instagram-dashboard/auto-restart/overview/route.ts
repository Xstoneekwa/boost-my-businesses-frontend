import { getAutoRestartData } from "@/app/instagram-dashboard/auto-restart-data";
import { jsonError, jsonOk, requireInstagramAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    return jsonOk(await getAutoRestartData());
  } catch {
    return jsonError("Could not load Auto Restart overview.", 500);
  }
}
