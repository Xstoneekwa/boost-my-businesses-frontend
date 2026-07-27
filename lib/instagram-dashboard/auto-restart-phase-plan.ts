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

export function resolvePlannedAccountSession(input: {
  persistedPhases: AutoRestartAccountSessionPhases | null;
  persistedQuotaRemaining: Record<string, number>;
  quotas: { welcome: PhaseQuota; follow: PhaseQuota; unfollow: PhaseQuota };
}): PlannedAccountSession {
  const phaseNames = ["welcome", "follow", "unfollow"] as const;
  const phases = Object.fromEntries(phaseNames.map((phase) => [
    phase,
    input.persistedPhases
      ? input.persistedPhases[phase] === true && input.quotas[phase].enabled
      : input.quotas[phase].enabled && input.quotas[phase].remaining > 0,
  ])) as AutoRestartAccountSessionPhases;
  const remaining = Object.fromEntries(phaseNames.map((phase) => {
    if (!phases[phase]) return [phase, 0];
    const persisted = input.persistedQuotaRemaining[phase];
    const raw = Math.max(0, input.quotas[phase].remaining);
    return [phase, Number.isFinite(persisted) ? Math.min(raw, Math.max(0, persisted)) : raw];
  })) as PlannedAccountSession["remaining"];

  return {
    phases,
    remaining,
    totalRemaining: remaining.welcome + remaining.follow + remaining.unfollow,
  };
}
