import { CT_MANUAL_FOLLOWERS_MAX_GUARD, CT_QUALITY_MIN_FOLLOWERS } from "../instagram-target-quality.ts";
import { targetAiEnabled, targetAiModel } from "./target-ai-contract.ts";

export const TARGETING_AI_PROMPT_VERSION = "targeting_ai_v1";

export type TargetingAiSettings = {
  promptVersion: string;
  enabled: boolean;
  provider: "openai";
  model: string;
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

export function readTargetingAiSettings(overrides?: Partial<Pick<TargetingAiSettings, "maxGptCandidates">>): TargetingAiSettings {
  return {
    promptVersion: TARGETING_AI_PROMPT_VERSION,
    enabled: targetAiEnabled(),
    provider: "openai",
    model: targetAiModel(),
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

export function buildTargetingAiPublicConfig() {
  const settings = readTargetingAiSettings();
  return {
    service: "targeting_ai",
    schema_version: "v1",
    prompt_version: settings.promptVersion,
    enabled: settings.enabled,
    provider: settings.provider,
    model: settings.model,
    max_gpt_candidates: settings.maxGptCandidates,
    max_displayed_results: settings.maxDisplayedResults,
    min_eligible_target: settings.minEligibleTarget,
    min_followers: settings.minFollowers,
    max_followers: settings.maxFollowers,
    allow_verified: settings.allowVerified,
    searchapi_concurrency: settings.searchApiConcurrency,
    max_searchapi_checks: settings.maxSearchApiChecks,
    temperature: settings.temperature,
    second_pass_enabled: settings.secondPassEnabled,
    geocoding_user_agent: settings.geocodingUserAgent,
    openai_key_configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    searchapi_key_configured: isSearchApiConfigured(),
    prompt_editable: false,
    prompt_storage: "code_versioned",
    last_updated: "2026-06-15",
  };
}
