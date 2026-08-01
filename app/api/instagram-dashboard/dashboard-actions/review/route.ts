import { createSupabaseClient } from "@/lib/supabase";
import { getInstagramAdminUserContext, jsonError, jsonOk, readJsonBody, readString, requireRelayOrAdmin } from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

type ReviewPayload = {
  action_id?: unknown;
  account_id?: unknown;
  operator_id?: unknown;
  source?: unknown;
  note?: unknown;
  metadata_safe?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const forbiddenMetadataTerms = [
  "password", "credential", "secret", "token", "authorization", "service_role",
  "verification_code", "raw_xml", "xml", "serial", "udid", "vault", "webhook", "cookie",
];

function safeMetadata(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const loweredKey = key.toLowerCase();
    if (forbiddenMetadataTerms.some((term) => loweredKey.includes(term))) continue;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed || forbiddenMetadataTerms.some((term) => trimmed.toLowerCase().includes(term))) continue;
      safe[key] = trimmed.slice(0, 240);
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      safe[key] = raw;
    } else if (typeof raw === "boolean") {
      safe[key] = raw;
    }
  }
  return safe;
}

export async function POST(request: Request) {
  const unauthorized = await requireRelayOrAdmin(request, "Dashboard action review");
  if (unauthorized) return unauthorized;

  const payload = (await readJsonBody<ReviewPayload>(request)) ?? {};
  const actionId = readString(payload.action_id).trim();
  const accountId = readString(payload.account_id).trim();
  const relayAuth = verifyCompassRelayKey(request.headers);
  const adminContext = relayAuth.ok ? null : await getInstagramAdminUserContext();
  const operatorId = relayAuth.ok ? readString(payload.operator_id).trim() : (adminContext?.userId ?? "");
  const note = readString(payload.note).trim() || null;
  if (!UUID.test(actionId) || !UUID.test(accountId) || !UUID.test(operatorId)) {
    return jsonError("Invalid dashboard action review payload.", 400, { code: "DASHBOARD_ACTION_REVIEW_INVALID" });
  }
  if (note && note.length > 500) {
    return jsonError("Review note is too long.", 400, { code: "DASHBOARD_ACTION_REVIEW_NOTE_TOO_LONG" });
  }

  try {
    const supabase = createSupabaseClient();
    const source = relayAuth.ok ? "botapp_relay" : "admin_dashboard";
    const { data, error } = await supabase.rpc("review_operator_dashboard_action", {
      p_action_id: actionId,
      p_account_id: accountId,
      p_actor_id: operatorId,
      p_source: source,
      p_note: note,
      p_metadata: {
        ...safeMetadata(payload.metadata_safe),
        review_surface: "incident_detail_v1",
        operator_review_completed: true,
      },
    });
    if (error) {
      const normalized = `${error.code || ""}:${error.message}`.toLowerCase();
      if (normalized.includes("not_found") || error.code === "P0002") {
        return jsonError("Dashboard action not found.", 404, { code: "DASHBOARD_ACTION_NOT_FOUND" });
      }
      if (normalized.includes("not_reviewable") || normalized.includes("transition")) {
        return jsonError("This action can no longer be marked reviewed because it is already terminal.", 409, {
          code: "DASHBOARD_ACTION_REVIEW_CONFLICT",
          reason: "not_reviewable",
        });
      }
      if (error.code === "27000" || normalized.includes("tuple to be updated")) {
        return jsonError("Review could not be recorded because the linked incident transition conflicted.", 409, {
          code: "DASHBOARD_ACTION_REVIEW_CONFLICT",
          reason: "incident_transition_conflict",
        });
      }
      return jsonError("The review service is temporarily unavailable.", 503, {
        code: "DASHBOARD_ACTION_REVIEW_FAILED",
        reason: "backend_unavailable",
      });
    }

    const row = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
    return jsonOk({
      contractVersion: "dashboard_action_review_v1",
      actionId,
      accountId,
      status: readString(row.status, "acknowledged"),
      reviewedAt: readString(row.updated_at, new Date().toISOString()),
      source,
      reason: "success",
      message: "Review recorded. The linked incident requires separate resolution.",
      incidentResolutionSeparate: true,
    });
  } catch {
    return jsonError("The review service is temporarily unavailable.", 503, {
      code: "DASHBOARD_ACTION_REVIEW_FAILED",
      reason: "backend_unavailable",
    });
  }
}
