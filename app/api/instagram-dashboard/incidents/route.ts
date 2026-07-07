import { createSupabaseClient } from "@/lib/supabase";
import {
  buildIncidentCounters,
  buildIncidentList,
} from "@/lib/instagram-dashboard/incident-operations";
import { jsonError, jsonOk, readInteger, readString, requireRelayOrAdmin } from "../_utils";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["open", "acknowledged", "resolved", "ignored"]);
const VALID_SEVERITIES = new Set(["info", "warning", "error", "critical"]);

function parseStatuses(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => VALID_STATUSES.has(item));
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Incidents");
    if (unauthorizedResponse) return unauthorizedResponse;

    const url = new URL(request.url);
    const statuses = parseStatuses(readString(url.searchParams.get("status")));
    const severity = readString(url.searchParams.get("severity")).trim().toLowerCase();
    const accountId = readString(url.searchParams.get("account_id")).trim();
    const includeTest = readString(url.searchParams.get("include_test")).trim() === "1";
    const limit = Math.min(200, Math.max(1, readInteger(url.searchParams.get("limit"), 50)));
    const offset = Math.max(0, readInteger(url.searchParams.get("offset"), 0));

    const supabase = createSupabaseClient();
    let query = supabase
      .from("account_incidents")
      .select(
        "id,status,severity,incident_type,reason,failure_reason,action_required,admin_message,account_id,account_username,run_id,occurrence_count,first_seen_at,last_seen_at,resolved_at,source,metadata",
        { count: "exact" },
      )
      .order("last_seen_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (statuses.length) query = query.in("status", statuses);
    if (VALID_SEVERITIES.has(severity)) query = query.eq("severity", severity);
    if (accountId) query = query.eq("account_id", accountId);

    const { data: incidentRows, error, count } = await query;
    if (error) return jsonError(error.message, 500);

    const incidentIds = (incidentRows ?? [])
      .map((row) => String(row.id ?? "").trim())
      .filter(Boolean);
    let notificationRows: Record<string, unknown>[] = [];
    if (incidentIds.length) {
      const { data: outboxRows, error: outboxError } = await supabase
        .from("account_incident_notifications")
        .select("incident_id,channel,status,attempt_count,delivered_at,last_error")
        .in("incident_id", incidentIds);
      if (outboxError) return jsonError(outboxError.message, 500);
      notificationRows = outboxRows ?? [];
    }

    const models = buildIncidentList(incidentRows ?? [], notificationRows, { includeTest });
    const counters = buildIncidentCounters(
      buildIncidentList(incidentRows ?? [], notificationRows, { includeTest: true }),
    );

    return jsonOk({
      incidents: models,
      counters,
      summary: {
        // BotApp bridge contract: openCount counts everything still active.
        openCount: counters.open + counters.actionRequired,
        incidentCount: counters.total,
        actionRequiredCount: counters.actionRequired,
        deliveryDegradedCount: counters.deliveryDegraded,
      },
      scope: { mode: "relay_global_admin", authorizedHostMachine: null },
      total: count ?? models.length,
      includeTest,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load incidents.";
    return jsonError(message, 500);
  }
}
