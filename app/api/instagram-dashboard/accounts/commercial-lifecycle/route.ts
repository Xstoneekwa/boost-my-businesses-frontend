import { createSupabaseClient } from "@/lib/supabase";
import { randomUUID } from "node:crypto";
import {
  executeCommercialAccountLifecycle,
  loadCommercialLifecycleState,
} from "@/lib/commercial/account-lifecycle-service.ts";
import type { CommercialLifecycleOperationType } from "@/lib/commercial/account-lifecycle-types.ts";
import {
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireInstagramAdmin,
} from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

type LifecyclePayload = {
  account_id?: unknown;
  action?: unknown;
  reason?: unknown;
  idempotency_key?: unknown;
  metadata?: unknown;
};

const commercialActions = new Set<CommercialLifecycleOperationType>(["pause", "resume", "cancel"]);

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") {
    return { mode: "relay_key" as const, userId: null };
  }
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return { mode: "unauthorized" as const, response: jsonError("Commercial lifecycle relay authentication failed.", 403) };
  }
  const unauthorizedResponse = await requireInstagramAdmin();
  if (unauthorizedResponse) return { mode: "unauthorized" as const, response: unauthorizedResponse };
  const adminContext = await getInstagramAdminUserContext();
  return { mode: "admin_session" as const, userId: adminContext?.userId ?? null };
}

function mapLegacyAction(action: string): CommercialLifecycleOperationType | null {
  if (action === "pause") return "pause";
  if (action === "cancel") return "cancel";
  if (action === "reactivate") return "resume";
  return null;
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireRelayOrAdmin(request);
    if (auth.mode === "unauthorized") return auth.response;

    const body = await readJsonBody<LifecyclePayload>(request);
    const accountId = readString(body?.account_id).trim();
    const legacyAction = readString(body?.action).trim().toLowerCase();
    const operationType = mapLegacyAction(legacyAction);

    if (!accountId) return jsonError("Missing account_id.", 400);
    if (!operationType || !commercialActions.has(operationType)) {
      return jsonError("Use mark_needs_assistance via legacy status or pause/resume/cancel for commercial lifecycle.", 400);
    }

    const idempotencyKey = readString(request.headers.get("idempotency-key"))
      || readString(body?.idempotency_key).trim()
      || `commercial:${legacyAction}:${accountId}:${randomUUID()}`;
    const reason = readString(body?.reason, `commercial_${legacyAction}`).slice(0, 500);

    const supabase = createSupabaseClient();
    const result = await executeCommercialAccountLifecycle({
      supabase,
      accountId,
      operationType,
      idempotencyKey,
      reason,
      actor: {
        actorType: auth.mode === "relay_key" ? "botapp" : "admin",
        actorId: auth.userId,
        sourceSurface: auth.mode === "relay_key" ? "botapp_client_accounts" : "admin_client_accounts",
      },
    });

    const state = await loadCommercialLifecycleState(supabase, accountId);

    return jsonOk({
      account_id: accountId,
      action: legacyAction,
      operation_type: operationType,
      commercial_state: result.commercialState,
      admin_lifecycle_status: state.adminLifecycleStatus,
      converged: result.converged,
      action_required: result.actionRequired,
      action_required_reason: result.actionRequiredReason,
      pause_expires_at: result.pauseExpiresAt,
      stripe_billing_paused: result.stripeBillingPaused,
      capacity_release_status: result.capacityReleaseStatus,
      runtime_quiesced: result.runtimeQuiesced,
      idempotency_key: result.idempotencyKey,
      operation_id: result.operationId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "commercial_lifecycle_failed";
    const status = message === "account_not_found" ? 404
      : message === "commercial_subscription_missing" ? 409
      : message === "lifecycle_operation_conflict" ? 409
      : message === "resume_not_allowed_from_state" || message === "pause_expired" ? 409
      : 500;
    return jsonError(message, status);
  }
}
