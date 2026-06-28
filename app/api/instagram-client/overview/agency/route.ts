import { jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { loadClientAgencyOverview } from "@/lib/instagram-client/load-agency-overview";
import type { AgencyAccountFilter } from "@/lib/instagram-client/client-agency-overview-projection";
import { readString, requireClientInstagramSession } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

function parseFilter(value: string): AgencyAccountFilter {
  if (value === "connected" || value === "preparing" || value === "action_required") return value;
  return "all";
}

function parsePage(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function parsePageSize(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(Math.floor(parsed), 50);
}

export async function GET(request: Request) {
  const session = await requireClientInstagramSession();
  if (!session.ok) return jsonError(session.error, session.status);

  const url = new URL(request.url);
  const overview = await loadClientAgencyOverview({
    clientId: session.clientId,
    page: parsePage(url.searchParams.get("page") ?? "1"),
    pageSize: parsePageSize(url.searchParams.get("page_size") ?? "20"),
    search: readString(url.searchParams.get("q")),
    filter: parseFilter(readString(url.searchParams.get("filter"), "all")),
  });

  if (!overview) {
    return jsonError("Agency overview is not available for this workspace.", 404, {
      code: "agency_overview_unavailable",
    });
  }

  return jsonOk(overview);
}
