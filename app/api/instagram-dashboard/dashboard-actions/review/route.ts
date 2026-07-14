import { createSupabaseClient } from "@/lib/supabase";
import { deliverOperatorReviewNotifications } from "@/lib/instagram-dashboard/operator-review-notifications";
import { isIdempotentlyResolvedOperatorReview, resolveOperatorReviewActor } from "@/lib/instagram-dashboard/operator-review-auth";
import { canAccessTenantPages } from "@/lib/restaurant-analytics/session";
import { getInstagramAdminUserContext, jsonError, jsonOk, readJsonBody, readString } from "../../_utils";
import { readRelayKey, verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

type ReviewPayload = {
  action_id?: unknown;
  account_id?: unknown;
  operator_id?: unknown;
  review_status?: unknown;
  source?: unknown;
  note?: unknown;
  metadata_safe?: unknown;
};

type SupabaseRecord = Record<string, unknown>;

const reviewableStatuses = ["pending", "acknowledged", "pending_verification", "code_submitted"] as const;
const allowedReviewStatuses = ["reviewed", "acknowledged"] as const;
const forbiddenMetadataTerms = [
  "password",
  "credential_value",
  "secret",
  "token",
  "authorization",
  ["service", "role"].join("_"),
  "verification_code",
  ["raw", "xml"].join("_"),
  "xml",
  "serial",
  "udid",
  "vault",
];

function safeMetadata(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    if (forbiddenMetadataTerms.some((term) => normalizedKey.includes(term))) continue;

    if (typeof raw === "string") {
      const trimmed = raw.trim();
      const normalizedValue = trimmed.toLowerCase();
      if (!trimmed || forbiddenMetadataTerms.some((term) => normalizedValue.includes(term))) continue;
      safe[key] = trimmed.slice(0, 240);
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      safe[key] = raw;
    } else if (typeof raw === "boolean") {
      safe[key] = raw;
    }
  }
  return safe;
}

function asSafeSource(value: unknown) {
  const source = readString(value, "admin_dashboard").trim().toLowerCase();
  if (source === "botapp_relay") return "botapp_relay";
  return "admin_dashboard";
}

export async function POST(request: Request) {
  try {
    const payload = (await readJsonBody<ReviewPayload>(request)) ?? {};
    const actionId = readString(payload.action_id).trim();
    const accountId = readString(payload.account_id).trim();
    const reviewStatus = readString(payload.review_status, "reviewed").trim().toLowerCase();

    if (!actionId || !accountId) return jsonError("Missing dashboard action review payload.", 400);
    if (!allowedReviewStatuses.includes(reviewStatus as (typeof allowedReviewStatuses)[number])) {
      return jsonError("Invalid review status.", 400);
    }

    const providedRelayKey = readRelayKey(request.headers);
    const actorContext = providedRelayKey ? null : await getInstagramAdminUserContext();
    const actor = resolveOperatorReviewActor({
      relayKeyProvided: Boolean(providedRelayKey),
      relayAuth: providedRelayKey ? verifyCompassRelayKey(request.headers) : null,
      relayOperatorId: payload.operator_id,
      adminUserId: actorContext?.userId ?? null,
      adminAuthorized: actorContext ? canAccessTenantPages(actorContext) : false,
    });
    if (!actor.ok) return jsonError(actor.error, actor.status, actor.reason ? { reason: actor.reason } : undefined);
    const actorId = actor.actorId;

    const supabase = createSupabaseClient();

    const { data: existingAction, error: existingError } = await supabase
      .from("account_dashboard_actions")
      .select("id,account_id,incident_id,action_type,status,blocking_campaign,title,admin_message,metadata")
      .eq("id", actionId)
      .eq("account_id", accountId)
      .limit(1)
      .maybeSingle<SupabaseRecord>();

    if (existingError) return jsonError(existingError.message, 500);
    if (!existingAction) return jsonError("Dashboard action not found.", 404);

    const currentStatus = readString(existingAction.status, "pending");
    if (isIdempotentlyResolvedOperatorReview(existingAction)) {
      return jsonOk({
        action_id: actionId,
        account_id: accountId,
        status: "resolved",
        blocking_campaign: false,
        review_status: "reviewed",
        reviewed_at: null,
        notification_deliveries: [],
        idempotent: true,
      });
    }
    if (!reviewableStatuses.includes(currentStatus as (typeof reviewableStatuses)[number])) {
      return jsonError("Dashboard action is not reviewable.", 409);
    }

    const source = asSafeSource(payload.source);
    const terminalOperatorReview = readString(existingAction.action_type) === "operator_review_required"
      && reviewStatus === "reviewed";
    const note = readString(payload.note).trim().slice(0, 500) || null;
    const incidentId = terminalOperatorReview ? readString(existingAction.incident_id) : "";
    if (terminalOperatorReview && !incidentId) {
      return jsonError("Operator review action has no incident linkage.", 409);
    }

    let reviewedAction: SupabaseRecord | null = null;
    if (terminalOperatorReview) {
      const { data, error } = await supabase.rpc("review_operator_dashboard_action", {
        p_action_id: actionId,
        p_account_id: accountId,
        p_actor_id: actorId,
        p_source: source,
        p_note: note,
        p_metadata: safeMetadata(payload.metadata_safe),
      });
      if (error) return jsonError(error.message, 500);
      reviewedAction = (Array.isArray(data) ? data[0] : data) as SupabaseRecord | null;
    } else {
      const { data, error } = await supabase.rpc("transition_account_dashboard_action", {
        p_action_id: actionId,
        p_new_status: "acknowledged",
        p_actor_type: "admin",
        p_actor_id: actorId,
        p_reason: "credentials_action_reviewed",
        p_metadata: {
          ...safeMetadata(payload.metadata_safe),
          review_status: reviewStatus,
          review_source: source,
          reviewed_at: new Date().toISOString(),
          note,
        },
      });
      if (error) return jsonError(error.message, 500);
      reviewedAction = (Array.isArray(data) ? data[0] : data) as SupabaseRecord | null;
    }

    if (!reviewedAction) return jsonError("Dashboard action is no longer reviewable.", 409);

    let notificationDeliveries: Array<{ channel: string; status: string; deliveredAt: string | null }> = [];
    if (terminalOperatorReview) {
      const { data: account } = await supabase
        .from("ig_accounts")
        .select("username")
        .eq("id", accountId)
        .maybeSingle<SupabaseRecord>();
      notificationDeliveries = await deliverOperatorReviewNotifications({
        event: "resolved",
        actionId,
        incidentId,
        accountId,
        accountUsername: readString(account?.username, "unknown"),
        reason: readString(existingAction.admin_message, readString(existingAction.title, "operator_review_required")),
        finalStatus: "resolved",
        operatorId: actorId,
      });
    }

    return jsonOk({
      action_id: actionId,
      account_id: accountId,
      status: readString(reviewedAction.status, terminalOperatorReview ? "resolved" : "acknowledged"),
      blocking_campaign: reviewedAction.blocking_campaign === true,
      review_status: reviewStatus,
      reviewed_at: readString(reviewedAction.updated_at, new Date().toISOString()),
      notification_deliveries: notificationDeliveries,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not review dashboard action.";
    return jsonError(message, 500);
  }
}
