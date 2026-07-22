import { followLimitOverrideV1Enabled } from "@/lib/instagram-dashboard/follow-limit-feature";
import { loadAccountFollowLimitProjection } from "@/lib/instagram-dashboard/follow-limit-service";
import { createSupabaseClient } from "@/lib/supabase";
import {
  getAccountId,
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  requireRelayOrAdmin,
  validateAccountId,
} from "../../_utils";

export const dynamic = "force-dynamic";

type OverridePayload = {
  account_id?: unknown;
  follow_day_cap_override?: unknown;
  follow_session_cap_override?: unknown;
  source?: unknown;
  reason?: unknown;
  idempotency_key?: unknown;
};

function featureDisabled() {
  return jsonError("Follow Limit Provenance V1 is disabled.", 503, { code: "follow_limit_override_v1_disabled" });
}

function optionalPositiveInteger(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return "invalid";
  return parsed;
}

function bodyAccountId(body: OverridePayload) {
  return typeof body.account_id === "string" ? body.account_id.trim() : "";
}

function bodyText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function guard(request: Request) {
  const unauthorized = await requireRelayOrAdmin(request, "Follow limit settings");
  if (unauthorized) return unauthorized;
  if (!followLimitOverrideV1Enabled()) return featureDisabled();
  return null;
}

export async function GET(request: Request) {
  try {
    const guarded = await guard(request);
    if (guarded) return guarded;
    const accountId = getAccountId(request);
    const invalidAccount = validateAccountId(accountId);
    if (invalidAccount) return invalidAccount;
    return jsonOk(await loadAccountFollowLimitProjection(createSupabaseClient(), accountId));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load Follow limit projection.", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const guarded = await guard(request);
    if (guarded) return guarded;
    const body = await readJsonBody<OverridePayload>(request);
    if (!body) return jsonError("Invalid Follow limit override payload.", 400);
    const accountId = bodyAccountId(body);
    const invalidAccount = validateAccountId(accountId);
    if (invalidAccount) return invalidAccount;
    const day = optionalPositiveInteger(body.follow_day_cap_override);
    const session = optionalPositiveInteger(body.follow_session_cap_override);
    if (day === "invalid" || session === "invalid" || (day === null && session === null)) {
      return jsonError("At least one positive Follow override is required.", 400);
    }
    const requestedSource = bodyText(body.source) || "admin";
    if (requestedSource !== "admin" && requestedSource !== "support") {
      return jsonError("Invalid Follow override source.", 400);
    }
    const actor = await getInstagramAdminUserContext();
    const idempotencyKey = bodyText(body.idempotency_key);
    if (!idempotencyKey) return jsonError("Missing idempotency_key.", 400);
    const supabase = createSupabaseClient();
    const { error } = await supabase.rpc("save_account_follow_limit_override_v1", {
      p_account_id: accountId,
      p_follow_day_cap_override: day,
      p_follow_session_cap_override: session,
      p_source: requestedSource,
      p_source_surface: "instagram_dashboard_backend_v1",
      p_updated_by: actor?.userId ?? null,
      p_reason: bodyText(body.reason) || null,
      p_idempotency_key: idempotencyKey,
    });
    if (error) return jsonError(`Could not save Follow limit override: ${error.message}`, 400);
    return jsonOk(await loadAccountFollowLimitProjection(supabase, accountId));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not save Follow limit override.", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const guarded = await guard(request);
    if (guarded) return guarded;
    const body = await readJsonBody<OverridePayload>(request);
    if (!body) return jsonError("Invalid Follow limit reset payload.", 400);
    const accountId = bodyAccountId(body);
    const invalidAccount = validateAccountId(accountId);
    if (invalidAccount) return invalidAccount;
    const idempotencyKey = bodyText(body.idempotency_key);
    if (!idempotencyKey) return jsonError("Missing idempotency_key.", 400);
    const actor = await getInstagramAdminUserContext();
    const supabase = createSupabaseClient();
    const { error } = await supabase.rpc("reset_account_follow_limit_override_v1", {
      p_account_id: accountId,
      p_source_surface: "instagram_dashboard_backend_v1",
      p_updated_by: actor?.userId ?? null,
      p_reason: bodyText(body.reason) || null,
      p_idempotency_key: idempotencyKey,
    });
    if (error) return jsonError(`Could not reset Follow limit override: ${error.message}`, 400);
    return jsonOk(await loadAccountFollowLimitProjection(supabase, accountId));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not reset Follow limit override.", 500);
  }
}
