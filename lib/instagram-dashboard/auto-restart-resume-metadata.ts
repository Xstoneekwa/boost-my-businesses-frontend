import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";

export function buildAutoRestartResumePlanMetadata(candidate: AutoRestartCandidate) {
  const reliability = candidate.reliability;
  const operatorStopContinuation = reliability.operatorStopContinuation === true;
  return {
    resume_plan_version: 1,
    resume_plan_schema: "AUTO_RESTART_RESUME_PLAN_V1",
    prior_run_id: reliability.lastRunId || null,
    session_termination_class: reliability.sessionTerminationClass || null,
    restart_block_reason: reliability.restartBlockReason || null,
    ...(operatorStopContinuation ? {
      operator_stop_continuation: true,
      operator_stop_source_reason: reliability.operatorStopReason,
      source_request_id: reliability.sourceRequestId,
      fresh_boundary_only: true,
      exact_viewport_resume_available: false,
    } : {}),
    resume_plan: {
      schema: "AUTO_RESTART_RESUME_PLAN_V1",
      restart_allowed: reliability.restartAllowed === true,
      restart_block_reason: reliability.restartBlockReason || "",
      session_termination_class: reliability.sessionTerminationClass || "",
      ...(operatorStopContinuation ? {
        operator_stop_continuation: true,
        operator_stop_source_reason: reliability.operatorStopReason,
        source_request_id: reliability.sourceRequestId,
        fresh_boundary_only: true,
        exact_viewport_resume_available: false,
      } : {}),
      phases_to_run: inferPhasesToRun(candidate),
      quota_remaining: {
        follow: candidate.quotas.follow.remaining,
        unfollow: candidate.quotas.unfollow.remaining,
        welcome: candidate.quotas.welcome.remaining,
        outreach: candidate.quotas.outreach.remaining,
      },
      prior_run_id: reliability.lastRunId || null,
      resume_plan_version: 1,
    },
  };
}

function inferPhasesToRun(candidate: AutoRestartCandidate) {
  return {
    welcome: candidate.quotas.welcome.remaining > 0 && candidate.quotas.welcome.enabled,
    follow: candidate.quotas.follow.remaining > 0 && candidate.quotas.follow.enabled,
    unfollow: candidate.quotas.unfollow.remaining > 0 && candidate.quotas.unfollow.enabled,
  };
}
