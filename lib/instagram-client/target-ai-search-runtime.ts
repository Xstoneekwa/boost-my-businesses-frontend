import type { ResolvedTargetingAiConfig } from "./targeting-ai-config-store.ts";

function readIntEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export type TargetAiSearchRuntimeLimits = {
  maxLatencyMs: number;
  primaryQueryLimit: number;
  broadenedQueryLimit: number;
  complementaryQueryLimit: number;
  rateLimitCooldownMs: number;
  minCandidateScore: number;
  targetEligibleCount: number;
  thirdPassEnabled: boolean;
  maxDiscoveredUsernames: number;
  maxProfileChecks: number;
};

export function readTargetAiSearchRuntimeLimits(config: ResolvedTargetingAiConfig): TargetAiSearchRuntimeLimits {
  return {
    maxLatencyMs: readIntEnv("TARGET_AI_MAX_LATENCY_MS", 120_000, 45_000, 180_000),
    primaryQueryLimit: readIntEnv("TARGET_AI_PRIMARY_DISCOVERY_QUERY_LIMIT", 10, 6, 14),
    broadenedQueryLimit: readIntEnv("TARGET_AI_BROADENED_DISCOVERY_QUERY_LIMIT", 8, 4, 12),
    complementaryQueryLimit: readIntEnv("TARGET_AI_COMPLEMENTARY_DISCOVERY_QUERY_LIMIT", 6, 3, 10),
    rateLimitCooldownMs: readIntEnv("TARGET_AI_RATE_LIMIT_COOLDOWN_MS", 2_200, 1_000, 6_000),
    minCandidateScore: readIntEnv("TARGET_AI_MIN_CANDIDATE_SCORE_BEFORE_LOOKUP", 0, -5, 10),
    targetEligibleCount: config.min_eligible_target,
    thirdPassEnabled: process.env.TARGET_AI_THIRD_PASS_ENABLED !== "false",
    maxDiscoveredUsernames: readIntEnv("TARGET_AI_MAX_DISCOVERED_USERNAMES", 70, 30, 100),
    maxProfileChecks: Math.min(Math.max(config.max_searchapi_checks, 50), 80),
  };
}

export class TargetAiSearchRuntime {
  readonly startedAtMs: number;
  readonly limits: TargetAiSearchRuntimeLimits;
  rateLimitHits = 0;
  cooldownUntilMs = 0;
  retriesUsed = 0;
  stoppedReason: string | null = null;

  constructor(limits: TargetAiSearchRuntimeLimits, now = Date.now()) {
    this.startedAtMs = now;
    this.limits = limits;
  }

  elapsedMs(now = Date.now()) {
    return now - this.startedAtMs;
  }

  isTimeExceeded(now = Date.now()) {
    return this.elapsedMs(now) >= this.limits.maxLatencyMs;
  }

  isRateLimitSevere() {
    return this.rateLimitHits >= 8;
  }

  shouldThrottleDiscovery() {
    return this.rateLimitHits >= 6;
  }

  recordRateLimit(now = Date.now()) {
    this.rateLimitHits += 1;
    this.cooldownUntilMs = Math.max(this.cooldownUntilMs, now + this.limits.rateLimitCooldownMs);
  }

  async waitForCooldown(now = Date.now()) {
    const waitMs = this.cooldownUntilMs - now;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  canRetryProfileLookup() {
    return this.rateLimitHits < 5 && this.retriesUsed < 8;
  }

  recordRetry() {
    this.retriesUsed += 1;
  }

  profileConcurrency(configured: number) {
    if (this.isRateLimitSevere()) return 1;
    if (this.rateLimitHits >= 4) return 1;
    return Math.min(Math.max(configured, 1), 2);
  }

  markStopped(reason: string) {
    if (!this.stoppedReason) this.stoppedReason = reason;
  }
}
