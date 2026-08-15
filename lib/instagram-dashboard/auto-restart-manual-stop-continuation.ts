export type CanonicalManualStopContinuationInput = {
  runId: string;
  runAccountId: string;
  runStatus: string;
  requestId: string;
  requestRunId: string;
  requestAccountId: string;
  requestStatus: string;
  cancelRequestedAt: string;
  cancelReason: string;
  attemptId: number;
  restartAllowed: boolean | null;
  restartBlockReason: string;
  unsafeMarkers: string[];
};

/**
 * Authorizes only an exact canonical BotApp Stop continuation.
 *
 * The next run always starts from a fresh business boundary; this evidence
 * never authorizes reuse of a viewport/cursor and never overrides an explicit
 * Worker safety verdict.
 */
export function canonicalManualStopContinuationAuthorized(
  input: CanonicalManualStopContinuationInput,
) {
  const normalized = (value: string) => value.trim().toLowerCase();
  return Boolean(input.runId && input.requestId)
    && input.runId === input.requestRunId
    && input.runAccountId === input.requestAccountId
    && ["stopped", "canceled"].includes(normalized(input.runStatus))
    && normalized(input.requestStatus) === "canceled"
    && Boolean(input.cancelRequestedAt.trim())
    && normalized(input.cancelReason) === "botapp_manual_stop"
    && Number.isSafeInteger(input.attemptId)
    && input.attemptId >= 1
    && input.restartAllowed === null
    && normalized(input.restartBlockReason) === "resume_plan_missing"
    && input.unsafeMarkers.length === 0;
}
