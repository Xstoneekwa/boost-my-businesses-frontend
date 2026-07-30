export type AutoRestartAccountSessionPhases = {
  welcome: boolean;
  follow: boolean;
  unfollow: boolean;
};

type PhaseQuota = { enabled: boolean; remaining: number };

export type PlannedAccountSession = {
  phases: AutoRestartAccountSessionPhases;
  remaining: { welcome: number; follow: number; unfollow: number };
  totalRemaining: number;
};

export type PhaseCompletionReason =
  | "disabled"
  | "quota_reached"
  | "candidates_exhausted"
  | "technical_hold"
  | "phase_circuit_open"
  | "work_remaining";

export type PhaseCompletion = {
  terminal: boolean;
  executable: boolean;
  reason: PhaseCompletionReason;
  quotaRemaining: number;
  eligibleWorkRemaining: number | null;
  temporarilyUnavailableWork: number;
};

export type PartialUnfollowLiveResumeReason =
  | "not_partial_unfollow_lineage"
  | "resume_source_run_superseded"
  | "unfollow_auto_restart_disabled"
  | "unfollow_disabled"
  | "unfollow_quota_reached"
  | "unfollow_phase_circuit_open"
  | "partial_resumable_live_unfollow_backlog"
  | "unfollow_backlog_on_cooldown"
  | "unfollow_backlog_terminal_only"
  | "unfollow_backlog_exhausted";

export type PartialUnfollowLiveResume = {
  applies: boolean;
  authorized: boolean;
  reason: PartialUnfollowLiveResumeReason;
  backlogTotal: number;
  actionableNow: number;
  technicalHoldTotal: number;
  terminalTotal: number;
  plannedQuota: number;
  nextEvaluationAt: string | null;
};

function normalized(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function safeCount(value: number | null | undefined) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0;
}

function validIso(value: string | null | undefined) {
  if (!value) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

export function resolveBoundedSessionQuota(input: {
  doneToday: number;
  capDay: number;
  sessionCap: number;
  enabled: boolean;
}) {
  const doneToday = Math.max(0, Number.isFinite(input.doneToday) ? input.doneToday : 0);
  const capDay = Math.max(0, Number.isFinite(input.capDay) ? input.capDay : 0);
  const sessionCap = Math.max(0, Number.isFinite(input.sessionCap) ? input.sessionCap : 0);
  const remaining = Math.max(0, capDay - doneToday);
  return {
    remaining,
    plannedNextRunQuota: input.enabled
      ? Math.min(sessionCap, remaining)
      : 0,
  } as const;
}

/**
 * Reconciles a stale Worker phase snapshot with the canonical live Unfollow
 * backlog.  This override is intentionally narrow: only the latest proven
 * partial Unfollow lineage may rebuild an Unfollow-only continuation.
 */
export function resolvePartialUnfollowLiveResume(input: {
  sessionTerminationClass: string;
  unfollowPhaseStatus?: string | null;
  lineageValid: boolean;
  autoRestartEnabled: boolean;
  unfollowEnabled: boolean;
  dailyQuotaRemaining: number;
  sessionQuotaRemaining: number;
  actionableNow: number;
  technicalHoldTotal: number;
  terminalTotal: number;
  nextCandidateRetryAt?: string | null;
  phaseCircuitOpen: boolean;
  phaseCircuitNextRetryAt?: string | null;
}): PartialUnfollowLiveResume {
  const actionableNow = safeCount(input.actionableNow);
  const technicalHoldTotal = safeCount(input.technicalHoldTotal);
  const terminalTotal = safeCount(input.terminalTotal);
  const backlogTotal = actionableNow + technicalHoldTotal + terminalTotal;
  const partial = ["partial_resumable", "partial_safe_stopped"]
    .includes(normalized(input.sessionTerminationClass));
  const phaseStatus = normalized(input.unfollowPhaseStatus);
  // A planned Unfollow flag or raw quota is not proof that the phase actually
  // started. Require the terminal Unfollow outcome itself to be partial.
  const explicitUnfollowLineage = ["partial_resumable", "partial_safe_stopped"]
    .includes(phaseStatus);
  const applies = partial && explicitUnfollowLineage;
  const result = (
    reason: PartialUnfollowLiveResumeReason,
    authorized = false,
    plannedQuota = 0,
    nextEvaluationAt: string | null = null,
  ): PartialUnfollowLiveResume => ({
    applies,
    authorized,
    reason,
    backlogTotal,
    actionableNow,
    technicalHoldTotal,
    terminalTotal,
    plannedQuota,
    nextEvaluationAt,
  });

  if (!applies) return result("not_partial_unfollow_lineage");
  if (!input.lineageValid) return result("resume_source_run_superseded");
  if (!input.autoRestartEnabled) return result("unfollow_auto_restart_disabled");
  if (!input.unfollowEnabled) return result("unfollow_disabled");

  // Live backlog classification is authoritative. A stale circuit flag from
  // the previous execution must not turn an empty or terminal-only backlog
  // into a resumable circuit wait.
  if (backlogTotal === 0) return result("unfollow_backlog_exhausted");
  if (actionableNow === 0 && technicalHoldTotal === 0 && terminalTotal > 0) {
    return result("unfollow_backlog_terminal_only");
  }

  if (actionableNow === 0 && technicalHoldTotal > 0) {
    return result(
      "unfollow_backlog_on_cooldown",
      false,
      0,
      validIso(input.nextCandidateRetryAt),
    );
  }

  const dailyRemaining = safeCount(input.dailyQuotaRemaining);
  const sessionRemaining = safeCount(input.sessionQuotaRemaining);
  if (dailyRemaining < 1 || sessionRemaining < 1) {
    return result("unfollow_quota_reached");
  }

  if (input.phaseCircuitOpen) {
    return result(
      "unfollow_phase_circuit_open",
      false,
      0,
      validIso(input.phaseCircuitNextRetryAt),
    );
  }

  const plannedQuota = Math.min(
    actionableNow,
    dailyRemaining,
    sessionRemaining,
  );
  if (plannedQuota > 0) {
    return result("partial_resumable_live_unfollow_backlog", true, plannedQuota);
  }
  return result("unfollow_backlog_exhausted");
}

export function resolvePhaseCompletion(input: {
  enabled: boolean;
  quotaRemaining: number;
  eligibleWorkRemaining?: number | null;
  temporarilyUnavailableWork?: number;
  phaseCircuitOpen?: boolean;
}): PhaseCompletion {
  const quotaRemaining = Math.max(0, Number.isFinite(input.quotaRemaining) ? input.quotaRemaining : 0);
  const eligibleWorkRemaining = input.eligibleWorkRemaining === null
    || input.eligibleWorkRemaining === undefined
    ? null
    : Math.max(0, Number.isFinite(input.eligibleWorkRemaining) ? input.eligibleWorkRemaining : 0);
  const temporarilyUnavailableWork = Math.max(
    0,
    Number.isFinite(input.temporarilyUnavailableWork)
      ? Number(input.temporarilyUnavailableWork)
      : 0,
  );
  if (!input.enabled) {
    return { terminal: true, executable: false, reason: "disabled", quotaRemaining, eligibleWorkRemaining, temporarilyUnavailableWork };
  }
  if (quotaRemaining < 1) {
    return { terminal: true, executable: false, reason: "quota_reached", quotaRemaining, eligibleWorkRemaining, temporarilyUnavailableWork };
  }
  if (input.phaseCircuitOpen === true) {
    return { terminal: false, executable: false, reason: "phase_circuit_open", quotaRemaining, eligibleWorkRemaining, temporarilyUnavailableWork };
  }
  if (eligibleWorkRemaining === 0) {
    return temporarilyUnavailableWork > 0
      ? { terminal: false, executable: false, reason: "technical_hold", quotaRemaining, eligibleWorkRemaining, temporarilyUnavailableWork }
      : { terminal: true, executable: false, reason: "candidates_exhausted", quotaRemaining, eligibleWorkRemaining, temporarilyUnavailableWork };
  }
  return { terminal: false, executable: true, reason: "work_remaining", quotaRemaining, eligibleWorkRemaining, temporarilyUnavailableWork };
}

export function pruneTerminalAccountSessionPhases(
  plan: PlannedAccountSession,
  completion: Record<keyof AutoRestartAccountSessionPhases, PhaseCompletion>,
): PlannedAccountSession {
  const phases = {
    welcome: plan.phases.welcome && completion.welcome.executable,
    follow: plan.phases.follow && completion.follow.executable,
    unfollow: plan.phases.unfollow && completion.unfollow.executable,
  };
  const remaining = {
    welcome: phases.welcome ? plan.remaining.welcome : 0,
    follow: phases.follow ? plan.remaining.follow : 0,
    unfollow: phases.unfollow ? plan.remaining.unfollow : 0,
  };
  return {
    phases,
    remaining,
    totalRemaining: remaining.welcome + remaining.follow + remaining.unfollow,
  };
}

export function resolvePlannedAccountSession(input: {
  persistedPhases: AutoRestartAccountSessionPhases | null;
  persistedQuotaRemaining: Record<string, number>;
  quotas: { welcome: PhaseQuota; follow: PhaseQuota; unfollow: PhaseQuota };
  eligibleWorkRemaining?: Partial<Record<keyof AutoRestartAccountSessionPhases, number | null>>;
}): PlannedAccountSession {
  const phaseNames = ["welcome", "follow", "unfollow"] as const;
  const phases = Object.fromEntries(phaseNames.map((phase) => [
    phase,
    input.persistedPhases
      ? input.persistedPhases[phase] === true
        && input.quotas[phase].enabled
        && input.quotas[phase].remaining > 0
      : input.quotas[phase].enabled && input.quotas[phase].remaining > 0,
  ])) as AutoRestartAccountSessionPhases;
  const remaining = Object.fromEntries(phaseNames.map((phase) => {
    if (!phases[phase]) return [phase, 0];
    const persisted = input.persistedQuotaRemaining[phase];
    const raw = Math.max(0, input.quotas[phase].remaining);
    const persistedBound = Number.isFinite(persisted)
      ? Math.min(raw, Math.max(0, persisted))
      : raw;
    const eligible = input.eligibleWorkRemaining?.[phase];
    return [
      phase,
      eligible === null || eligible === undefined || !Number.isFinite(eligible)
        ? persistedBound
        : Math.min(persistedBound, Math.max(0, eligible)),
    ];
  })) as PlannedAccountSession["remaining"];

  return {
    phases,
    remaining,
    totalRemaining: remaining.welcome + remaining.follow + remaining.unfollow,
  };
}
