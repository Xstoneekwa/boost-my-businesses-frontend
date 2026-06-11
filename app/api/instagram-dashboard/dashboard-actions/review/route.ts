import { createSupabaseClient } from "@/lib/supabase";
import { getInstagramAdminUserContext, jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

type ReviewPayload = {
  action_id?: unknown;
  account_id?: unknown;
  review_status?: unknown;
  source?: unknown;
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
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const payload = (await readJsonBody<ReviewPayload>(request)) ?? {};
    const actionId = readString(payload.action_id).trim();
    const accountId = readString(payload.account_id).trim();
    const reviewStatus = readString(payload.review_status, "reviewed").trim().toLowerCase();

    if (!actionId || !accountId) return jsonError("Missing dashboard action review payload.", 400);
    if (!allowedReviewStatuses.includes(reviewStatus as (typeof allowedReviewStatuses)[number])) {
      return jsonError("Invalid review status.", 400);
    }

    const supabase = createSupabaseClient();
    const actorContext = await getInstagramAdminUserContext();
    const now = new Date().toISOString();

    const { data: existingAction, error: existingError } = await supabase
      .from("account_dashboard_actions")
      .select("id,account_id,action_type,status,metadata")
      .eq("id", actionId)
      .eq("account_id", accountId)
      .limit(1)
      .maybeSingle<SupabaseRecord>();

    if (existingError) return jsonError(existingError.message, 500);
    if (!existingAction) return jsonError("Dashboard action not found.", 404);

    const currentStatus = readString(existingAction.status, "pending");
    if (!reviewableStatuses.includes(currentStatus as (typeof reviewableStatuses)[number])) {
      return jsonError("Dashboard action is not reviewable.", 409);
    }

    const previousMetadata = existingAction.metadata && typeof existingAction.metadata === "object" && !Array.isArray(existingAction.metadata)
      ? existingAction.metadata as SupabaseRecord
      : {};
    const source = asSafeSource(payload.source);
    const metadata = {
      ...previousMetadata,
      ...safeMetadata(payload.metadata_safe),
      review_status: reviewStatus,
      reviewed_by: actorContext?.userId ?? "unknown",
      reviewed_at: now,
      review_source: source,
      keep_action_active_until_readiness_ok: true,
    };

    const { data: reviewedAction, error: updateError } = await supabase
      .from("account_dashboard_actions")
      .update({
        status: "acknowledged",
        metadata,
        updated_at: now,
      })
      .eq("id", actionId)
      .eq("account_id", accountId)
      .in("status", [...reviewableStatuses])
      .select("id,account_id,action_type,status,updated_at")
      .maybeSingle<SupabaseRecord>();

    if (updateError) return jsonError(updateError.message, 500);
    if (!reviewedAction) return jsonError("Dashboard action is no longer reviewable.", 409);

    try {
      await supabase.from("ig_action_logs").insert({
        account_id: accountId,
        run_id: null,
        target_username: null,
        action_type: "dashboard_action_reviewed",
        status: "success",
        message: "credentials_action_reviewed",
        payload: {
          actor_type: "admin",
          actor_id: actorContext?.userId ?? null,
          source,
          dashboard_action_id: actionId,
          dashboard_action_type: readString(existingAction.action_type, "unknown"),
          review_status: reviewStatus,
        },
        created_at: now,
      });
    } catch {
      // The dashboard action update is authoritative; audit can be reconciled later.
    }

    return jsonOk({
      action_id: actionId,
      account_id: accountId,
      status: readString(reviewedAction.status, "acknowledged"),
      review_status: reviewStatus,
      reviewed_at: now,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not review dashboard action.";
    return jsonError(message, 500);
  }
}
