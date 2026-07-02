export type AutoRestartOperationalState = "disabled" | "blocked" | "ready" | "active";

export function computeAutoRestartOperationalState(input: {
  enabled: boolean;
  mode: string;
  foundationReady: boolean;
  tickTokenConfigured: boolean;
  activationBlockReasons?: string[];
}): { state: AutoRestartOperationalState; blockReasons: string[] } {
  const blockReasons = [...(input.activationBlockReasons || [])];

  if (!input.foundationReady) blockReasons.push("auto_restart_foundation_not_deployed");
  if (input.enabled && input.mode === "active" && !input.tickTokenConfigured) {
    blockReasons.push("active_mode_tick_token_not_configured");
  }

  const unique = [...new Set(blockReasons.filter(Boolean))];
  if (!input.enabled || input.mode === "disabled") {
    return { state: "disabled", blockReasons: unique };
  }
  if (input.mode === "active" && unique.length === 0) {
    return { state: "active", blockReasons: [] };
  }
  if (unique.length > 0) {
    return { state: "blocked", blockReasons: unique };
  }
  return { state: "ready", blockReasons: [] };
}

export function restartDelayBlockReason(nextRestartAt: string | null, now: Date) {
  if (!nextRestartAt) return null;
  const next = new Date(nextRestartAt);
  if (Number.isNaN(next.getTime())) return null;
  if (next.getTime() > now.getTime()) return "restart_delay_not_elapsed";
  return null;
}

export function maxAttemptsBlockReason(currentAttempt: string, maxAttemptsPerSession: number) {
  if (maxAttemptsPerSession <= 0) return null;
  const parsed = Number.parseInt(String(currentAttempt || "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed >= maxAttemptsPerSession) return "max_attempts_per_session";
  return null;
}
