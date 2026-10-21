import { getCompassIntelligenceOverview, runCompassIntelligence } from "@/lib/instagram-dashboard/compass-v2-data";
import { jsonError, jsonOk, requireRelayOrAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireRelayOrAdmin(request, "Compass intelligence");
  if (unauthorized) return unauthorized;
  try {
    return jsonOk(await getCompassIntelligenceOverview());
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Compass intelligence unavailable.", 500);
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireRelayOrAdmin(request, "Compass intelligence");
  if (unauthorized) return unauthorized;
  try {
    return jsonOk(await runCompassIntelligence());
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Compass assessment failed.", 500);
  }
}
