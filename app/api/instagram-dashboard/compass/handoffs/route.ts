import { persistPreparedHandoff, loadCurrentHandoffContext } from "@/lib/instagram-dashboard/compass-v2-data";
import { jsonError, jsonOk, readJsonBody, requireRelayOrAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireRelayOrAdmin(request, "Compass Fleet handoff");
  if (unauthorized) return unauthorized;
  const body = await readJsonBody<{ cluster_id?: string }>(request);
  if (!body?.cluster_id || typeof body.cluster_id !== "string") return jsonError("Missing cluster_id.", 400);
  try {
    const now = new Date().toISOString();
    const selected = await loadCurrentHandoffContext(body.cluster_id, now);
    const handoff = await persistPreparedHandoff(selected, now);
    return jsonOk({ handoff, actionsExecutable: false, next: "OPEN_IN_FLEET" }, 201);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Compass handoff preparation failed.", 500);
  }
}
