import { createSupabaseClient } from "@/lib/supabase";
import { loadIncidentDetail } from "@/lib/instagram-dashboard/incident-detail";
import { isIncidentOnlyActionRateLimit } from "@/lib/instagram-dashboard/action-rate-limit-policy";
import { getInstagramAdminUserContext, jsonError, jsonOk, readJsonBody, readString, requireRelayOrAdmin } from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

type ActionBody = {
  incident_id?: unknown;
  action?: unknown;
  expected_version?: unknown;
  operator_id?: unknown;
  source?: unknown;
  note?: unknown;
  resolution_note?: unknown;
  resolution_reason?: unknown;
  idempotency_key?: unknown;
  channel?: unknown;
  notification_id?: unknown;
  expected_worker_sha?: unknown;
  cause_fixed_version?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["acknowledge", "add_note", "resolve", "retry_notification"]);

function mapRpcError(message: string, code?: string) {
  const normalized = `${code || ""}:${message}`.toLowerCase();
  if (normalized.includes("incident_not_found") || normalized.includes("incident_notification_not_found") || code === "P0002") {
    return jsonError("Incident or notification not found.", 404, { code: "INCIDENT_ACTION_NOT_FOUND" });
  }
  if (normalized.includes("conflict") || code === "40001") {
    return jsonError("Incident lifecycle changed; reload before retrying.", 409, { code: "INCIDENT_ACTION_CONFLICT" });
  }
  if (normalized.includes("required") || normalized.includes("invalid") || normalized.includes("too_long") || code === "22023") {
    return jsonError("Invalid incident action payload.", 400, { code: "INCIDENT_ACTION_INVALID" });
  }
  if (code === "42501") {
    return jsonError("Incident action is forbidden.", 403, { code: "INCIDENT_ACTION_FORBIDDEN" });
  }
  return jsonError("Incident action failed.", 500, { code: "INCIDENT_ACTION_FAILED" });
}

export async function POST(request: Request) {
  const unauthorized = await requireRelayOrAdmin(request, "Incident action");
  if (unauthorized) return unauthorized;

  const body = (await readJsonBody<ActionBody>(request)) ?? {};
  const incidentId = readString(body.incident_id).trim();
  const action = readString(body.action).trim().toLowerCase();
  const idempotencyKey = readString(body.idempotency_key).trim();
  const expectedVersion = Number(body.expected_version);
  if (!UUID.test(incidentId) || !ACTIONS.has(action) || !idempotencyKey || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return jsonError("Invalid incident action payload.", 400, { code: "INCIDENT_ACTION_INVALID" });
  }

  const relayAuth = verifyCompassRelayKey(request.headers);
  const adminContext = relayAuth.ok ? null : await getInstagramAdminUserContext();
  const operatorId = relayAuth.ok ? readString(body.operator_id).trim() : (adminContext?.userId ?? "");
  if (!UUID.test(operatorId)) {
    return jsonError("A valid operator identity is required.", 400, { code: "INCIDENT_OPERATOR_REQUIRED" });
  }

  const channel = readString(body.channel).trim().toLowerCase();
  const notificationId = readString(body.notification_id).trim();
  const source = relayAuth.ok ? "botapp_relay" : "admin_dashboard";
  const actorType = relayAuth.ok ? "ops" : "admin";
  const note = readString(body.note || body.resolution_note).trim() || null;
  const resolutionReason = readString(body.resolution_reason).trim() || null;
  const expectedWorkerSha = readString(body.expected_worker_sha).trim().toLowerCase();
  const causeFixedVersion = readString(body.cause_fixed_version).trim();

  const detailBeforeAction = action === "resolve" ? await loadIncidentDetail(incidentId) : null;
  const incidentOnlyActionLimit = Boolean(detailBeforeAction && isIncidentOnlyActionRateLimit({
    reason: detailBeforeAction.incident.reason,
    metadata: detailBeforeAction.incident.metadataSafe,
  }));

  if (action === "resolve" && !incidentOnlyActionLimit && (!/^[0-9a-f]{40}$/.test(expectedWorkerSha) || !causeFixedVersion || causeFixedVersion.length > 160)) {
    return jsonError("A certified corrected Worker SHA and cause-fixed version are required.", 400, {
      code: "INCIDENT_RESOLUTION_RUNTIME_PROOF_REQUIRED",
      blocked_reason: !expectedWorkerSha ? "expected_worker_sha_missing" : "cause_fixed_version_missing_or_invalid",
    });
  }

  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase.rpc("transition_account_incident_human_review_v3", {
      p_incident_id: incidentId,
      p_action: action,
      p_expected_version: expectedVersion,
      p_actor_type: actorType,
      p_actor_id: operatorId,
      p_source: source,
      p_note: note,
      p_resolution_reason: resolutionReason,
      p_idempotency_key: idempotencyKey,
      p_expected_worker_sha: action === "resolve" && !incidentOnlyActionLimit ? expectedWorkerSha : null,
      p_cause_fixed_version: action === "resolve" && !incidentOnlyActionLimit ? causeFixedVersion : null,
      p_channel: channel || null,
      p_notification_id: UUID.test(notificationId) ? notificationId : null,
    });
    if (error) return mapRpcError(error.message, error.code);

    const transition = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    let deliveries: Array<Record<string, unknown>> = [];
    const idempotent = transition.idempotent === true;
    if (!idempotent && (action === "resolve" || action === "retry_notification")) {
      deliveries = [{ status: "queued", router: "notification_router_v2" }];
    }

    const detail = await loadIncidentDetail(incidentId);
    return jsonOk({
      contractVersion: "incident_human_review_action_v2",
      action,
      eventId: transition.event_id ?? null,
      incidentId,
      status: transition.status ?? detail?.incident.status ?? null,
      version: transition.version ?? detail?.incident.version ?? expectedVersion,
      idempotent,
      incident_resolved: transition.incident_resolved === true,
      dashboard_action_resolved: transition.dashboard_action_resolved === true,
      resume_authorization_created: transition.resume_authorization_created === true,
      next_tick_eligible: transition.next_tick_eligible === true,
      resume_authorization_id: transition.resume_authorization_id ?? null,
      expires_at: transition.expires_at ?? null,
      blocked_reason: transition.blocked_reason ?? null,
      expected_worker_sha: transition.expected_worker_sha ?? null,
      cause_fixed_version: transition.cause_fixed_version ?? null,
      early_resolution_warning: incidentOnlyActionLimit
        && typeof detailBeforeAction?.incident.metadataSafe?.recommended_pause_until === "string"
        && Date.parse(detailBeforeAction.incident.metadataSafe.recommended_pause_until) > Date.now()
          ? "recommended_48h_pause_not_elapsed"
          : null,
      deliveries,
      detail,
    });
  } catch {
    return jsonError("Incident action failed.", 500, { code: "INCIDENT_ACTION_FAILED" });
  }
}
