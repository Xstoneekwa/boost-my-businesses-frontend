import {
  evaluateRunStartEligibility,
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

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const accountId = getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const url = new URL(request.url);
    const requestedRunType = readString(url.searchParams.get("requested_run_type"), "account_session").toLowerCase();
    const eligibility = await evaluateRunStartEligibility(accountId, requestedRunType);

    if (eligibility.ok) {
      return jsonOk({
        ok_to_start: true,
        reason: "ready",
        message: "Manual run is ready.",
        requested_run_type: eligibility.normalizedRunType,
        health: eligibility.health,
      });
    }

    return jsonOk({
      ok_to_start: false,
      reason: eligibility.reason,
      message: runStartBlockMessage(eligibility.reason),
      requested_run_type: requestedRunType,
      health: "health" in eligibility ? eligibility.health : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not evaluate run eligibility.";
    return jsonError(sanitizeRunControlReason(message, "Could not evaluate run eligibility."), 500);
  }
}
