import { CT_MANUAL_FOLLOWERS_MAX_GUARD, CT_QUALITY_MIN_FOLLOWERS } from "../instagram-target-quality.ts";
import { targetAiEnabled, targetAiModel } from "./target-ai-contract.ts";
import type { ResolvedTargetingAiConfig } from "./targeting-ai-config-store.ts";

export const TARGETING_AI_PROMPT_VERSION = "targeting_ai_v1";

export type TargetingAiSettings = {
  promptVersion: string;
  promptSource: "code_default" | "db_custom";
  enabled: boolean;
  provider: "openai";
  model: string;
  systemPrompt: string;
  userPromptTemplate: string;
  maxGptCandidates: number;
  maxDisplayedResults: number;
  minEligibleTarget: number;
  minFollowers: number;
  maxFollowers: number;
  allowVerified: boolean;
  searchApiConcurrency: number;
  maxSearchApiChecks: number;
  temperature: number;
  secondPassEnabled: boolean;
  geocodingUserAgent: string;
};

function readIntEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function readFloatEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function resolvedConfigToSettings(config: ResolvedTargetingAiConfig): TargetingAiSettings {
  return {
    promptVersion: config.prompt_version,
    promptSource: config.prompt_source,
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    systemPrompt: config.system_prompt,
    userPromptTemplate: config.user_prompt_template,
    maxGptCandidates: config.max_gpt_candidates,
    maxDisplayedResults: config.max_displayed_results,
    minEligibleTarget: config.min_eligible_target,
    minFollowers: config.min_followers,
    maxFollowers: config.max_followers,
    allowVerified: config.allow_verified,
    searchApiConcurrency: config.searchapi_concurrency,
    maxSearchApiChecks: config.max_searchapi_checks,
    temperature: config.temperature,
    secondPassEnabled: config.second_pass_enabled,
    geocodingUserAgent: config.geocoding_user_agent,
  };
}

/** Env-only fallback for legacy synchronous callers/tests. */
export function readTargetingAiSettings(overrides?: Partial<Pick<TargetingAiSettings, "maxGptCandidates">>): TargetingAiSettings {
  return {
    promptVersion: TARGETING_AI_PROMPT_VERSION,
    promptSource: "code_default",
    enabled: targetAiEnabled(),
    provider: "openai",
    model: targetAiModel(),
    systemPrompt: "",
    userPromptTemplate: "",
    maxGptCandidates: overrides?.maxGptCandidates
      ?? readIntEnv("TARGET_AI_MAX_GPT_CANDIDATES", 50, 12, 80),
    maxDisplayedResults: readIntEnv("TARGET_AI_MAX_DISPLAYED_RESULTS", 20, 8, 40),
    minEligibleTarget: readIntEnv("TARGET_AI_MIN_ELIGIBLE_TARGET", 8, 3, 20),
    minFollowers: readIntEnv("TARGET_AI_MIN_FOLLOWERS", CT_QUALITY_MIN_FOLLOWERS, 100, 10_000),
    maxFollowers: readIntEnv("TARGET_AI_MAX_FOLLOWERS", CT_MANUAL_FOLLOWERS_MAX_GUARD, 1_000, 500_000),
    allowVerified: process.env.TARGET_AI_ALLOW_VERIFIED === "true",
    searchApiConcurrency: readIntEnv("TARGET_AI_SEARCHAPI_CONCURRENCY", 4, 1, 6),
    maxSearchApiChecks: readIntEnv("TARGET_AI_MAX_SEARCHAPI_CHECKS", 55, 10, 80),
    temperature: readFloatEnv("TARGET_AI_TEMPERATURE", 0.5, 0, 1),
    secondPassEnabled: process.env.TARGET_AI_SECOND_PASS_ENABLED !== "false",
    geocodingUserAgent: process.env.GEOCODING_USER_AGENT?.trim() || "BoostAI-Geocoder/1.0",
  };
}

export function isSearchApiConfigured() {
  return Boolean(process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY?.trim());
}
