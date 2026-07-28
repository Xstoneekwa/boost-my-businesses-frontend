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
  | "work_remaining";

export type PhaseCompletion = {
  terminal: boolean;
  executable: boolean;
  reason: PhaseCompletionReason;
  quotaRemaining: number;
  eligibleWorkRemaining: number | null;
};

export function resolvePhaseCompletion(input: {
  enabled: boolean;
  quotaRemaining: number;
  eligibleWorkRemaining?: number | null;
}): PhaseCompletion {
  const quotaRemaining = Math.max(0, Number.isFinite(input.quotaRemaining) ? input.quotaRemaining : 0);
  const eligibleWorkRemaining = input.eligibleWorkRemaining === null
    || input.eligibleWorkRemaining === undefined
    ? null
    : Math.max(0, Number.isFinite(input.eligibleWorkRemaining) ? input.eligibleWorkRemaining : 0);
  if (!input.enabled) {
    return { terminal: true, executable: false, reason: "disabled", quotaRemaining, eligibleWorkRemaining };
  }
  if (quotaRemaining < 1) {
    return { terminal: true, executable: false, reason: "quota_reached", quotaRemaining, eligibleWorkRemaining };
  }
  if (eligibleWorkRemaining === 0) {
    return { terminal: true, executable: false, reason: "candidates_exhausted", quotaRemaining, eligibleWorkRemaining };
  }
  return { terminal: false, executable: true, reason: "work_remaining", quotaRemaining, eligibleWorkRemaining };
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
