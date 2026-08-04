import {
  DEFAULT_ALLOWED_RUN_TYPES,
  evaluateRunStartEligibility,
  getActiveRunRequest,
  insertManualRunAudit,
  normalizeRunStartTrigger,
  runStartBlockMessage,
  sanitizeRunControlReason,
} from "@/lib/instagram-dashboard/run-control";
import {
  getAccountId,
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireInstagramAdmin,
  validateAccountId,
} from "../../_utils";
import { compassRelayAuthFailureReason, relayAuthStatus, verifyCompassRelayKey } from "../../compass/relay-auth";
import { runStartSuccessPayload } from "./helpers";
import { buildManualFollow60RequestContract } from "@/lib/instagram-dashboard/manual-follow60-control";

export const dynamic = "force-dynamic";

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return jsonError("Run start relay authentication failed.", relayAuthStatus(compassRelayAuthFailureReason(relayAuth)), { reason: compassRelayAuthFailureReason(relayAuth) });
  }
  return requireInstagramAdmin();
}

type StartBody = {
  account_id?: unknown;
  requested_run_type?: unknown;
  trigger?: unknown;
  source?: unknown;
  manual_start?: unknown;
  manual_cap_override?: unknown;
  idempotency_key?: unknown;
};

function normalizeRunStartSource(value: unknown) {
  return readString(value, "instagram_dashboard")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .slice(0, 80) || "instagram_dashboard";
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<StartBody>(request);
    const accountId = readString(body?.account_id, getAccountId(request));
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const requestedRunType = readString(body?.requested_run_type, DEFAULT_ALLOWED_RUN_TYPES[0]).toLowerCase();
    const trigger = body?.manual_start === true ? "manual" : normalizeRunStartTrigger(body?.trigger);
    const sourceSurface = normalizeRunStartSource(body?.source);
    const idempotencyKey = readString(body?.idempotency_key, "").slice(0, 200) || null;
    const eligibility = await evaluateRunStartEligibility(accountId, requestedRunType, {
      trigger,
      manualStart: body?.manual_start === true,
    });

    if (!eligibility.ok) {
      if (eligibility.reason === "already_requested") {
        const activeRequest = eligibility.activeRequest ?? await getActiveRunRequest(accountId);
        const requestId = readString(activeRequest?.id, "");
        const requestStatus = readString(activeRequest?.status, "");
        if (requestId && requestStatus) {
          return jsonOk(runStartSuccessPayload({
            accountId,
            requestId,
            requestStatus,
            requestedRunType,
            idempotent: true,
          }));
        }
      }

      await insertManualRunAudit(
        accountId,
        "manual_run_blocked",
        "blocked",
        runStartBlockMessage(eligibility.reason),
        { reason: eligibility.reason, requested_run_type: requestedRunType, trigger, source_surface: sourceSurface },
      ).catch(() => undefined);

      const status =
        eligibility.reason === "already_running" || eligibility.reason === "already_requested" ? 409 : 403;

      return jsonError(runStartBlockMessage(eligibility.reason), status);
    }

    const adminContext = await getInstagramAdminUserContext();
    const actorId = adminContext?.userId ?? null;
    const effectiveIdempotencyKey =
      idempotencyKey ??
      `dashboard:${accountId}:${requestedRunType}:${actorId ?? "admin"}:${Date.now()}`;

    const { createSupabaseClient } = await import("@/lib/supabase");
    const supabase = createSupabaseClient();
    let manualFollow60Metadata: Record<string, unknown> | null = null;
    if (sourceSurface === "botapp_manual_play") {
      const activeControlStatuses = [
        "armed",
        "running",
        "barrier_waiting_stop",
        "waiting_operator_evaluation",
        "continuation_authorized",
      ];
      const { data: activeControls, error: activeControlsError } = await supabase
        .from("follow_60s_canary_controls")
        .select("account_id,status,baseline_follow_count,evaluation_increment,target_follow_count,metadata_safe")
        .in("status", activeControlStatuses);
      if (activeControlsError) {
        return jsonError("Could not verify the Follow60 Play contract.", 500);
      }
      const controlRows = Array.isArray(activeControls) ? activeControls : [];
      const accountControl = controlRows.find(
        (row) => readString((row as Record<string, unknown>)?.account_id, "") === accountId,
      ) as Record<string, unknown> | undefined;
      if (accountControl) {
        const { getAutoRestartData } = await import("@/app/instagram-dashboard/auto-restart-data");
        const overview = await getAutoRestartData();
        const candidate = overview.candidates.find((item) => item.accountId === accountId);
        const manualContract = buildManualFollow60RequestContract({
          accountId,
          controlRow: accountControl,
          activeControlCount: controlRows.length,
          candidate,
        });
        if (!manualContract.ok || !manualContract.metadata) {
          await insertManualRunAudit(
            accountId,
            "manual_run_blocked",
            "blocked",
            "BotApp Play did not satisfy the armed Follow60 contract.",
            {
              reason: manualContract.reason || "follow60_manual_play_contract_missing",
              requested_run_type: requestedRunType,
              trigger,
              source_surface: sourceSurface,
            },
          ).catch(() => undefined);
          return jsonError(
            `BotApp Play blocked: ${manualContract.reason || "follow60_manual_play_contract_missing"}.`,
            409,
          );
        }
        manualFollow60Metadata = manualContract.metadata;
      }
    }
    const { data, error } = await supabase.rpc("create_account_run_request", {
      p_account_id: accountId,
      p_requested_by: actorId,
      p_actor_type: "admin",
      p_source_surface: sourceSurface,
      p_requested_run_type: eligibility.normalizedRunType,
      p_idempotency_key: effectiveIdempotencyKey,
      p_priority: 0,
      p_metadata_safe: {
        requested_from: sourceSurface,
        requested_run_type: eligibility.normalizedRunType,
        trigger,
        trigger_source: readString(body?.trigger, ""),
        source_surface: sourceSurface,
        manual_start: trigger === "manual",
        follow_filters: "followFiltersSummary" in eligibility ? eligibility.followFiltersSummary : undefined,
        ...(manualFollow60Metadata ?? {}),
      },
    });

    if (error) {
      const message = sanitizeRunControlReason(error.message, "Could not create run request.");
      if (/account_already_running/i.test(error.message)) {
        return jsonError("A run is already active for this account.", 409);
      }
      if (/account_run_already_requested/i.test(error.message)) {
        return jsonError("A manual run is already requested for this account.", 409);
      }
      return jsonError(message, 500);
    }

    const requestRow = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    const requestId = readString(requestRow?.id, "");
    const requestStatus = readString(requestRow?.status, "queued");
    if (!requestId) {
      return jsonError("Run request was not created.", 500);
    }

    await insertManualRunAudit(
      accountId,
      "manual_run_requested",
      "success",
      "Manual run request accepted by runtime dispatcher path.",
      {
        request_id: requestId,
        requested_run_type: eligibility.normalizedRunType,
        request_status: requestStatus,
        trigger,
        source_surface: sourceSurface,
      },
    ).catch(() => undefined);

    return jsonOk(runStartSuccessPayload({
      accountId,
      requestId,
      requestStatus,
      requestedRunType: eligibility.normalizedRunType,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the run.";
    return jsonError(sanitizeRunControlReason(message, "Could not start the run."), 500);
  }
}
