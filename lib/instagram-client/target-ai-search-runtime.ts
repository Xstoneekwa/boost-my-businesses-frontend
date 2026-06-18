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
  minDisplayedBeforeStop: number;
  thirdPassDisplayThreshold: number;
  broadenedDisplayThreshold: number;
  thirdPassEnabled: boolean;
  maxDiscoveredUsernames: number;
  maxProfileChecks: number;
};

export function readTargetAiSearchRuntimeLimits(config: ResolvedTargetingAiConfig): TargetAiSearchRuntimeLimits {
  return {
    maxLatencyMs: readIntEnv("TARGET_AI_MAX_LATENCY_MS", 120_000, 60_000, 180_000),
    primaryQueryLimit: readIntEnv("TARGET_AI_PRIMARY_DISCOVERY_QUERY_LIMIT", 14, 10, 18),
    broadenedQueryLimit: readIntEnv("TARGET_AI_BROADENED_DISCOVERY_QUERY_LIMIT", 12, 8, 16),
    complementaryQueryLimit: readIntEnv("TARGET_AI_COMPLEMENTARY_DISCOVERY_QUERY_LIMIT", 8, 4, 12),
    rateLimitCooldownMs: readIntEnv("TARGET_AI_RATE_LIMIT_COOLDOWN_MS", 1_800, 800, 5_000),
    minCandidateScore: readIntEnv("TARGET_AI_MIN_CANDIDATE_SCORE_BEFORE_LOOKUP", -20, -30, 10),
    targetEligibleCount: config.min_eligible_target,
    minDisplayedBeforeStop: readIntEnv("TARGET_AI_MIN_DISPLAYED_BEFORE_STOP", 15, 10, 30),
    thirdPassDisplayThreshold: readIntEnv("TARGET_AI_THIRD_PASS_DISPLAY_THRESHOLD", 10, 6, 20),
    broadenedDisplayThreshold: readIntEnv("TARGET_AI_BROADENED_DISPLAY_THRESHOLD", 15, 10, 25),
    thirdPassEnabled: process.env.TARGET_AI_THIRD_PASS_ENABLED !== "false",
    maxDiscoveredUsernames: readIntEnv("TARGET_AI_MAX_DISCOVERED_USERNAMES", 100, 40, 120),
    maxProfileChecks: Math.min(Math.max(config.max_searchapi_checks, 60), 100),
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

  /** Soft throttle: slow down but keep checking extracted candidates. */
  shouldSlowDownProfileLookups() {
    return this.rateLimitHits >= 10;
  }

  /** Hard stop: only when throttling is extreme and we already tried enough. */
  isRateLimitHardStop() {
    return this.rateLimitHits >= 24;
  }

  /** Discovery can pause new queries under pressure, but profile queue should continue. */
  shouldPauseDiscovery() {
    return this.rateLimitHits >= 18;
  }

  recordRateLimit(now = Date.now()) {
    this.rateLimitHits += 1;
    const backoff = this.shouldSlowDownProfileLookups()
      ? this.limits.rateLimitCooldownMs * 1.5
      : this.limits.rateLimitCooldownMs;
    this.cooldownUntilMs = Math.max(this.cooldownUntilMs, now + backoff);
  }

  async waitForCooldown(now = Date.now()) {
    const waitMs = this.cooldownUntilMs - now;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  canRetryProfileLookup() {
    return !this.isRateLimitHardStop() && this.retriesUsed < 16;
  }

  recordRetry() {
    this.retriesUsed += 1;
  }

  profileConcurrency(configured: number) {
    if (this.isRateLimitHardStop()) return 1;
    if (this.shouldSlowDownProfileLookups()) return 1;
    return Math.min(Math.max(configured, 1), 2);
  }

  markStopped(reason: string) {
    if (!this.stoppedReason) this.stoppedReason = reason;
  }
}
