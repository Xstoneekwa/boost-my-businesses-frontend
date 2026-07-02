import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";

export function buildAutoRestartResumePlanMetadata(candidate: AutoRestartCandidate) {
  const reliability = candidate.reliability;
  return {
    resume_plan_version: 1,
    resume_plan_schema: "AUTO_RESTART_RESUME_PLAN_V1",
    prior_run_id: reliability.lastRunId || null,
    session_termination_class: reliability.sessionTerminationClass || null,
    restart_block_reason: reliability.restartBlockReason || null,
    resume_plan: {
      schema: "AUTO_RESTART_RESUME_PLAN_V1",
      restart_allowed: reliability.restartAllowed === true,
      restart_block_reason: reliability.restartBlockReason || "",
      session_termination_class: reliability.sessionTerminationClass || "",
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
