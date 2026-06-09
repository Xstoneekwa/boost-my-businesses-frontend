import { buildRunEligibilityOverview } from "@/lib/instagram-dashboard/run-eligibility-overview";
import {
  jsonError,
  jsonOk,
  readString,
  requireInstagramAdmin,
} from "../../../_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const url = new URL(request.url);
    const requestedRunType = readString(url.searchParams.get("requested_run_type"), "account_session").toLowerCase();
    const overview = await buildRunEligibilityOverview(requestedRunType);
    return jsonOk(overview);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build run eligibility overview.";
    return jsonError(message, 500);
  }
}
