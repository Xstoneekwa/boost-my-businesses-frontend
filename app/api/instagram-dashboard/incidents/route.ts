import { createSupabaseClient } from "@/lib/supabase";
import { buildIncidentList } from "@/lib/instagram-dashboard/incident-operations";
import {
  clampIncidentPageSize,
  decodeIncidentCursor,
  encodeIncidentCursor,
  normalizeIncidentFilter,
  type IncidentFilter,
} from "@/lib/instagram-dashboard/incident-pagination";
import { jsonError, jsonOk, readInteger, readString, requireRelayOrAdmin } from "../_utils";

export const dynamic = "force-dynamic";

type OverviewRpc = {
  rows?: Array<Record<string, unknown>>;
  filtered_total?: number;
  has_more?: boolean;
  next_cursor?: { last_seen_at?: string; id?: string } | null;
  counters?: {
    open?: number;
    actionRequired?: number;
    resolved?: number;
    deliveryDegraded?: number;
    total?: number;
  };
};

function legacyFilter(status: string): IncidentFilter {
  const statuses = status.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!statuses.length) return "open";
  if (statuses.every((value) => value === "resolved" || value === "ignored")) return "resolved";
  if (statuses.every((value) => value === "open" || value === "acknowledged")) return "open";
  return "all";
}

function safeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export async function GET(request: Request) {
  const unauthorized = await requireRelayOrAdmin(request, "Incidents");
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const requestedFilter = readString(url.searchParams.get("filter")).trim();
  const filter = requestedFilter
    ? normalizeIncidentFilter(requestedFilter)
    : legacyFilter(readString(url.searchParams.get("status")));
  const pageSize = clampIncidentPageSize(readInteger(url.searchParams.get("limit"), 50));
  const cursorValue = readString(url.searchParams.get("cursor")).trim();
  const cursor = decodeIncidentCursor(cursorValue);
  if (cursorValue && !cursor) {
    return jsonError("Invalid incident pagination cursor.", 400, { code: "INCIDENTS_CURSOR_INVALID" });
  }
  const search = readString(url.searchParams.get("search")).trim().slice(0, 120) || null;
  const includeTest = readString(url.searchParams.get("include_test")).trim() === "1";

  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase.rpc("get_account_incidents_overview_v1", {
      p_filter: filter,
      p_limit: pageSize,
      p_cursor_last_seen_at: cursor?.lastSeenAt ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_search: search,
      p_include_test: includeTest,
    });
    if (error) {
      const missing = error.code === "42883" || error.code === "PGRST202";
      return jsonError(
        missing ? "Incident overview storage is not installed." : "Incident overview storage is unavailable.",
        503,
        { code: missing ? "INCIDENTS_RPC_MISSING" : "INCIDENTS_RPC_ERROR" },
      );
    }

    const payload = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as OverviewRpc;
    if (!Array.isArray(payload.rows) || !payload.counters || typeof payload.has_more !== "boolean") {
      return jsonError("Incident overview returned an invalid contract.", 502, { code: "INCIDENTS_PAYLOAD_INVALID" });
    }

    const incidentIds = payload.rows.map((row) => String(row.id ?? "").trim()).filter(Boolean);
    let deliveries: Array<Record<string, unknown>> = [];
    if (incidentIds.length) {
      const result = await supabase
        .from("account_incident_notifications")
        .select("incident_id,channel,status,attempt_count,delivered_at")
        .in("incident_id", incidentIds);
      if (result.error) {
        return jsonError("Incident delivery status is unavailable.", 503, { code: "INCIDENTS_DELIVERY_QUERY_ERROR" });
      }
      deliveries = result.data ?? [];
    }

    const actions = payload.rows.flatMap((row) => {
      const incidentId = String(row.id ?? "").trim();
      const status = String(row.operator_action_status ?? "").trim();
      return incidentId && status ? [{ incident_id: incidentId, status }] : [];
    });
    const incidents = buildIncidentList(payload.rows, deliveries, actions, { includeTest: true });
    const counters = {
      open: safeCount(payload.counters.open),
      actionRequired: safeCount(payload.counters.actionRequired),
      resolved: safeCount(payload.counters.resolved),
      deliveryDegraded: safeCount(payload.counters.deliveryDegraded),
      total: safeCount(payload.counters.total),
    };
    const next = payload.next_cursor;
    const nextCursor = payload.has_more && next?.last_seen_at && next?.id
      ? encodeIncidentCursor({ lastSeenAt: String(next.last_seen_at), id: String(next.id) })
      : null;

    return jsonOk({
      contractVersion: "incidents_overview_v2",
      incidents,
      counters,
      summary: {
        openCount: counters.open + counters.actionRequired,
        incidentCount: counters.total,
        actionRequiredCount: counters.actionRequired,
        deliveryDegradedCount: counters.deliveryDegraded,
      },
      page: {
        filter,
        search,
        pageSize,
        returned: incidents.length,
        filteredTotal: safeCount(payload.filtered_total),
        hasMore: payload.has_more,
        nextCursor,
      },
      scope: { mode: "relay_global_admin", authorizedHostMachine: null },
      includeTest,
      generatedAt: new Date().toISOString(),
    });
  } catch {
    return jsonError("Could not load incident overview.", 500, { code: "INCIDENTS_ROUTE_ERROR" });
  }
}
