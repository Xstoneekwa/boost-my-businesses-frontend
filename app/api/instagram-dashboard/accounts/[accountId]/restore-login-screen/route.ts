import {
  evaluateLoginChallengeRunEligibility,
  getActiveRunRequest,
  insertManualRunAudit,
  runStartBlockMessage,
  sanitizeRunControlReason,
} from "@/lib/instagram-dashboard/run-control";
import {
  ORPHAN_RECOVERY_RUN_TYPE,
  hasActiveLoginProvisioningRequest,
  resolveOrphanLoginRecoveryProjection,
} from "@/lib/instagram-dashboard/orphan-login-recovery";
import {
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  validateAccountId,
} from "../../../_utils";
import { relayAuthStatus, verifyCompassRelayKey } from "../../../compass/relay-auth";

export const dynamic = "force-dynamic";

type RestoreBody = {
  account_id?: unknown;
  source?: unknown;
  idempotency_key?: unknown;
};

async function requireRelayOnly(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  return jsonError(
    "Restore login screen is only available through the BotApp relay.",
    relayAuthStatus(relayAuth.reason),
    { reason: relayAuth.reason },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    const unauthorized = await requireRelayOnly(request);
    if (unauthorized) return unauthorized;

    const params = await context.params;
    const body = await readJsonBody<RestoreBody>(request);
    const accountId = readString(body?.account_id, params.accountId);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const recovery = await resolveOrphanLoginRecoveryProjection(accountId);
    if (!recovery.botappActionAvailable) {
      const reason = recovery.hasActiveLoginProvisioning
        ? "active_login_provisioning"
        : recovery.state === "login_surface_restored"
          ? "login_surface_already_restored"
          : "orphan_recovery_not_available";
      await insertManualRunAudit(
        accountId,
        "login_orphan_recovery_blocked",
        "blocked",
        "Restore login screen refused by orphan recovery preconditions.",
        { reason, recovery_state: recovery.state },
      ).catch(() => undefined);
      return jsonError(runStartBlockMessage("invalid_run_type"), 403, { reason });
    }

    if (await hasActiveLoginProvisioningRequest(accountId)) {
      return jsonError("A login provisioning request is already active for this account.", 409);
    }

    const eligibility = await evaluateLoginChallengeRunEligibility(
      accountId,
      ORPHAN_RECOVERY_RUN_TYPE,
      "manual",
    );
    if (!eligibility.ok) {
      await insertManualRunAudit(
        accountId,
        "login_orphan_recovery_blocked",
        "blocked",
        runStartBlockMessage(eligibility.reason),
        { reason: eligibility.reason, requested_run_type: ORPHAN_RECOVERY_RUN_TYPE },
      ).catch(() => undefined);
      return jsonError(runStartBlockMessage(eligibility.reason), 403, { reason: eligibility.reason });
    }

    const activeRequest = await getActiveRunRequest(accountId);
    if (activeRequest) {
      return jsonError("A manual run is already requested for this account.", 409);
    }

    const idempotencyKey = readString(body?.idempotency_key, "").slice(0, 200)
      || `botapp:restore-login-screen:${accountId}:${Date.now()}`;
    const sourceSurface = readString(body?.source, "botapp_restore_login_screen")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.:-]+/g, "_")
      .slice(0, 80) || "botapp_restore_login_screen";

    const { createSupabaseClient } = await import("@/lib/supabase");
    const supabase = createSupabaseClient();
    const { data, error } = await supabase.rpc("create_account_run_request", {
      p_account_id: accountId,
      p_requested_by: null,
      p_actor_type: "admin",
      p_source_surface: sourceSurface,
      p_requested_run_type: ORPHAN_RECOVERY_RUN_TYPE,
      p_idempotency_key: idempotencyKey,
      p_priority: 0,
      p_metadata_safe: {
        requested_from: sourceSurface,
        requested_run_type: ORPHAN_RECOVERY_RUN_TYPE,
        trigger: "manual",
        source_surface: sourceSurface,
        manual_start: true,
        orphan_recovery_state: recovery.state,
      },
    });

    if (error) {
      const message = sanitizeRunControlReason(error.message, "Could not create orphan recovery request.");
      if (/account_run_already_requested/i.test(error.message)) {
        return jsonError("A manual run is already requested for this account.", 409);
      }
      return jsonError(message, 500);
    }

    const requestRow = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    const requestId = readString(requestRow?.id, "");
    const requestStatus = readString(requestRow?.status, "queued");
    if (!requestId) {
      return jsonError("Orphan recovery request was not created.", 500);
    }

    await insertManualRunAudit(
      accountId,
      "login_orphan_recovery_requested",
      "success",
      "Bounded orphan login challenge recovery requested through BotApp relay.",
      {
        request_id: requestId,
        requested_run_type: ORPHAN_RECOVERY_RUN_TYPE,
        recovery_state: recovery.state,
      },
    ).catch(() => undefined);

    return jsonOk({
      started: true,
      idempotent: false,
      message: `Orphan recovery request ${requestId.slice(0, 8)} queued (${requestStatus}).`,
      account_id: accountId,
      request_id: requestId,
      status: requestStatus,
      requested_run_type: ORPHAN_RECOVERY_RUN_TYPE,
      recovery_state: recovery.state,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not request orphan login recovery.";
    return jsonError(message, 500);
  }
}
