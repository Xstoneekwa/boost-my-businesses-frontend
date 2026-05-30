import { getRunControlHealth } from "@/lib/instagram-dashboard/run-control";
import { jsonOk, requireInstagramAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const unauthorizedResponse = await requireInstagramAdmin();
  if (unauthorizedResponse) return unauthorizedResponse;

  const health = await getRunControlHealth();
  return jsonOk(health);
}
