import {
  evaluateRunStartEligibility,
  normalizeRunStartTrigger,
  runStartBlockDescription,
  runStartBlockMessage,
  sanitizeRunControlReason,
} from "@/lib/instagram-dashboard/run-control";
import {
  getAccountId,
  jsonError,
  jsonOk,
  readString,
  requireInstagramAdmin,
  validateAccountId,
} from "../../_utils";
import { relayAuthStatus, verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return jsonError("Run eligibility relay authentication failed.", relayAuthStatus(relayAuth.reason), { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const accountId = getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const url = new URL(request.url);
    const requestedRunType = readString(url.searchParams.get("requested_run_type"), "account_session").toLowerCase();
    const trigger = normalizeRunStartTrigger(url.searchParams.get("trigger"));
    const eligibility = await evaluateRunStartEligibility(accountId, requestedRunType, { trigger });

    if (eligibility.ok) {
      const readyReason = "reason" in eligibility ? eligibility.reason : "ready";
      const technicalReady =
        readyReason === "technical_run_allowed_outside_campaign_window" ||
        readyReason === "technical_run_allowed_manual_only";
      return jsonOk({
        ok_to_start: true,
        eligibility_status: "ready",
        reason: readyReason,
        primary_block_reason: null,
        reason_label: "Ready",
        reason_description: technicalReady
          ? "Technical account run is allowed without a campaign schedule window."
          : "Account settings and run eligibility are ready for this manual run.",
        message: technicalReady
          ? "Technical account run is ready now."
          : "Manual run is ready.",
        requested_run_type: eligibility.normalizedRunType,
        trigger,
        health: eligibility.health,
      });
    }

    return jsonOk({
      ok_to_start: false,
      eligibility_status: "blocked",
      reason: eligibility.reason,
      primary_block_reason: eligibility.reason,
      reason_label: runStartBlockMessage(eligibility.reason),
      reason_description: runStartBlockDescription(eligibility.reason),
      message: runStartBlockMessage(eligibility.reason),
      requested_run_type: requestedRunType,
      trigger,
      health: "health" in eligibility ? eligibility.health : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not evaluate run eligibility.";
    return jsonError(sanitizeRunControlReason(message, "Could not evaluate run eligibility."), 500);
  }
}
