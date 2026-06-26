import { createSupabaseClient } from "@/lib/supabase";
import {
  clearNeedsMoreTargetAccountsManual,
  markNeedsMoreTargetAccountsManual,
  reevaluateNeedsMoreTargetAccountsAutomatic,
} from "@/lib/instagram-dashboard/needs-more-target-accounts";
import { jsonError, jsonOk, readJsonBody, readString } from "../../_utils";
import { compassRelayAuthFailureReason, relayAuthStatus, verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

type NeedsMoreTargetsAction = "mark" | "clear" | "reevaluate";

type NeedsMoreTargetsPayload = {
  account_id?: unknown;
  action?: unknown;
  reason?: unknown;
};

const allowedActions = new Set<NeedsMoreTargetsAction>(["mark", "clear", "reevaluate"]);

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") {
    return { mode: "relay_key" as const };
  }
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return {
      mode: "unauthorized" as const,
      response: jsonError("Needs more targets relay authentication failed.", 403, { reason: compassRelayAuthFailureReason(relayAuth) }),
    };
  }
  if (!relayAuth.ok) {
    return {
      mode: "unauthorized" as const,
      response: jsonError("Needs more targets relay authentication failed.", relayAuthStatus(compassRelayAuthFailureReason(relayAuth)), { reason: compassRelayAuthFailureReason(relayAuth) }),
    };
  }
  return { mode: "admin_session" as const };
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireRelayOrAdmin(request);
    if (auth.mode === "unauthorized") return auth.response;

    const body = await readJsonBody<NeedsMoreTargetsPayload>(request);
    if (!body) return jsonError("Invalid needs more targets payload.", 400);

    const accountId = readString(body.account_id, "").trim();
    const action = readString(body.action, "").trim() as NeedsMoreTargetsAction;
    const reason = readString(body.reason, "").trim().slice(0, 240) || null;

    if (!accountId) return jsonError("Missing account_id.", 400);
    if (!allowedActions.has(action)) return jsonError("Invalid needs more targets action.", 400);

    const supabase = createSupabaseClient();
    const actorType = auth.mode === "relay_key" ? "botapp" as const : "admin" as const;

    const result = action === "mark"
      ? await markNeedsMoreTargetAccountsManual(supabase, {
        accountId,
        actorType,
        evaluationReason: reason || "manual_operator_request",
      })
      : action === "clear"
        ? await clearNeedsMoreTargetAccountsManual(supabase, {
          accountId,
          actorType,
          evaluationReason: reason || "manual_operator_clear",
        })
        : await reevaluateNeedsMoreTargetAccountsAutomatic(supabase, {
          accountId,
          evaluationReason: reason || "manual_reevaluate",
          actorType,
        });

    return jsonOk({
      account_id: accountId,
      action,
      needs_more_targets: result.needs_more_targets,
      needsMoreTargets: result.needs_more_targets,
      eligible_target_count: result.eligible_target_count,
      eligibleTargetCount: result.eligible_target_count,
      threshold: result.threshold,
      changed: result.changed,
      action_id: result.action_id,
      run_started: false,
      provisioning_started: false,
      login_started: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update needs more targets signal.";
    return jsonError(message, 500);
  }
}
