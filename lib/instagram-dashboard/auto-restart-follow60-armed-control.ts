import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";

export type Follow60ControlRow = {
  account_id?: unknown;
  status?: unknown;
  baseline_follow_count?: unknown;
  evaluation_increment?: unknown;
  target_follow_count?: unknown;
  metadata_safe?: unknown;
};

export type ArmedFollow60Control = {
  accountId: string;
  controlId: string;
  expectedWorkerSha: string;
  expiresAt: string;
  followQuota: number;
  baselineFollowCount: number;
  targetFollowCount: number;
};

export type ArmedFollow60Resolution =
  | { matched: false; ok: true; reason: ""; control: null }
  | { matched: true; ok: false; reason: string; control: null }
  | { matched: true; ok: true; reason: ""; control: ArmedFollow60Control };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function bool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.trim().toLowerCase() === "true") return true;
  if (typeof value === "string" && value.trim().toLowerCase() === "false") return false;
  return null;
}

/**
 * Resolve the account-neutral Follow60 authority before generic resume-plan
 * runtime validation. Any present-but-invalid armed control fails closed; it
 * can never silently fall back to the account's broader Golden phase plan.
 */
export function resolveArmedFollow60Control(input: {
  row: Follow60ControlRow | null | undefined;
  candidate: AutoRestartCandidate;
  now: Date;
  globalActiveControlCount: number;
}): ArmedFollow60Resolution {
  if (!input.row) return { matched: false, ok: true, reason: "", control: null };

  const row = input.row;
  const metadata = record(row.metadata_safe);
  const accountId = text(row.account_id);
  const controlId = text(metadata.control_id);
  const expectedWorkerSha = text(metadata.expected_worker_sha).toLowerCase();
  const baselineReleaseSha = text(metadata.baseline_release_sha).toLowerCase();
  const expiresAt = text(metadata.expires_at);
  const baseline = integer(row.baseline_follow_count);
  const increment = integer(row.evaluation_increment);
  const target = integer(row.target_follow_count);
  const expectedUsername = text(metadata.expected_username).replace(/^@/, "").toLowerCase();
  const candidateUsername = input.candidate.username.trim().replace(/^@/, "").toLowerCase();
  const expiresAtMs = Date.parse(expiresAt);

  const invalid = (
    text(row.status) !== "armed"
    || input.globalActiveControlCount !== 1
    || accountId !== input.candidate.accountId
    || text(metadata.schema) !== "FOLLOW_60S_CANARY_CONTROL_V3"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(controlId)
    || !/^[0-9a-f]{40}$/.test(expectedWorkerSha)
    || baselineReleaseSha !== expectedWorkerSha
    || text(metadata.baseline_account_id) !== accountId
    || expectedUsername !== candidateUsername
    || text(metadata.expected_run_type) !== "account_session"
    || text(metadata.binding_version) !== "FOLLOW_60S_CANARY_BINDING_V2"
    || bool(metadata.runtime_binding_consumed) !== false
    || integer(metadata.active_control_count) !== 1
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs <= input.now.getTime()
    || baseline === null
    || increment === null
    || target === null
    || baseline < 0
    || increment < 1
    || increment > 50
    || target > 50
    || target !== baseline + increment
  );
  if (invalid) {
    return { matched: true, ok: false, reason: "follow60_armed_control_invalid", control: null };
  }

  const followQuota = Math.min(increment!, target! - baseline!);
  const liveFollow = input.candidate.quotas.follow;
  if (
    liveFollow.enabled !== true
    || followQuota > liveFollow.remaining
    || followQuota > liveFollow.plannedNextRunQuota
  ) {
    return {
      matched: true,
      ok: false,
      reason: "follow60_armed_control_live_quota_insufficient",
      control: null,
    };
  }

  return {
    matched: true,
    ok: true,
    reason: "",
    control: {
      accountId,
      controlId,
      expectedWorkerSha,
      expiresAt,
      followQuota,
      baselineFollowCount: baseline!,
      targetFollowCount: target!,
    },
  };
}

export function projectArmedFollow60Candidate(
  candidate: AutoRestartCandidate,
  control: ArmedFollow60Control,
): AutoRestartCandidate {
  // A valid armed Follow60 control is itself the immutable authorization for
  // a fresh-boundary Follow-only run. It may bootstrap the candidate when the
  // only missing legacy artifact is a resume plan. No other account, device,
  // restriction, quota, window, or safety rejection is overridden here.
  const bootstrapFromControl = candidate.accountEligible === true
    && candidate.restartEligible === false
    && candidate.blockReason === "resume_plan_missing";
  return {
    ...candidate,
    ...(bootstrapFromControl
      ? {
        restartNeeded: true,
        restartNeedReason: "follow60_armed_control_fresh_start",
        exactViewportResumeAvailable: false,
        safeRestartStrategy: "rebuilt_safe_target_plan" as const,
        safeRestartReason: "follow60_armed_control_fresh_boundary",
        historicalSafeBoundaryFallback: false,
        operatorStopContinuation: false,
        freshBoundaryOnly: true,
        enqueueAllowed: true,
        decisionOutcome: "eligible" as const,
        restartEligible: true,
        blockReason: "",
        sourceBusinessSessionId: `follow60:${control.controlId}`,
        nextRetryIndex: 0,
      }
      : {}),
    remainingFollowQuota: control.followQuota,
    plannedRunType: "account_session",
    plannedPhasesToRun: { welcome: false, follow: true, unfollow: false },
    plannedQuotaRemaining: {
      welcome: 0,
      follow: control.followQuota,
      unfollow: 0,
      outreach: 0,
    },
    reliability: {
      ...candidate.reliability,
      phasesToRun: { welcome: false, follow: true, unfollow: false },
      quotaRemaining: {
        welcome: 0,
        follow: control.followQuota,
        unfollow: 0,
        outreach: 0,
        total: control.followQuota,
      },
    },
  };
}

export function attachArmedFollow60Contract<T extends {
  remaining_follow_quota: number;
  resume_plan: Record<string, unknown> & {
    phases_to_run: { welcome: boolean; follow: boolean; unfollow: boolean };
    quota_remaining: { welcome: number; follow: number; unfollow: number; outreach: number };
  };
}>(
  metadata: T,
  control: ArmedFollow60Control,
  sourceRunId: string,
  preservedBacklog: { welcome: number; unfollow: number; outreach: number },
): T {
  return {
    ...metadata,
    remaining_follow_quota: control.followQuota,
    resume_plan: {
      ...metadata.resume_plan,
      phases_to_run: { welcome: false, follow: true, unfollow: false },
      quota_remaining: { welcome: 0, follow: control.followQuota, unfollow: 0, outreach: 0 },
      phase_plan_source: "follow60_armed_control",
      follow_60s_canary_contract: {
        schema: "FOLLOW_60S_ONE_SHOT_V2",
        control_id: control.controlId,
        source_run_id: sourceRunId,
        expected_worker_sha: control.expectedWorkerSha,
        expires_at: control.expiresAt,
        follow_quota: control.followQuota,
        baseline_follow_count: control.baselineFollowCount,
        target_follow_count: control.targetFollowCount,
        golden_fallback_policy: "proof_rejection_only",
      },
      preserved_business_backlog: {
        welcome: Math.max(0, preservedBacklog.welcome),
        unfollow: Math.max(0, preservedBacklog.unfollow),
        outreach: Math.max(0, preservedBacklog.outreach),
      },
    },
  };
}
