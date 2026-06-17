import { createSupabaseClient } from "@/lib/supabase";
import {
  buildDefaultTargetingAiCodeConfig,
  buildDefaultUserPromptTemplate,
  type TargetingAiStoredConfig,
} from "./target-ai-contract.ts";
import {
  validateTargetingAiNumericField,
  validateTargetingAiPromptText,
} from "./targeting-ai-config-validation.ts";
import { isSearchApiConfigured, TARGETING_AI_PROMPT_VERSION } from "./targeting-ai-settings.ts";
import { targetAiEnabled, targetAiModel } from "./target-ai-contract.ts";

export const TARGETING_AI_SETTING_KEY = "targeting_ai";

export type TargetingAiPromptSource = "code_default" | "db_custom";

export type ResolvedTargetingAiConfig = TargetingAiStoredConfig & {
  prompt_source: TargetingAiPromptSource;
  geocoding_user_agent: string;
};

export type TargetingAiConfigSnapshot = {
  active: ResolvedTargetingAiConfig;
  default: TargetingAiStoredConfig;
  prompt_source: TargetingAiPromptSource;
  editable: boolean;
  openai_key_configured: boolean;
  searchapi_key_configured: boolean;
  backend_pending: boolean;
};

type CacheEntry = {
  expiresAtMs: number;
  value: TargetingAiConfigSnapshot | null;
};

let configCache: CacheEntry | null = null;
const CACHE_TTL_MS = 15_000;

function readGeocodingUserAgent() {
  return process.env.GEOCODING_USER_AGENT?.trim() || "BoostAI-Geocoder/1.0";
}

function invalidateTargetingAiConfigCache() {
  configCache = null;
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function readFloat(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export function normalizeTargetingAiStoredConfig(
  value: Record<string, unknown> | null | undefined,
  fallback?: TargetingAiStoredConfig,
): TargetingAiStoredConfig {
  const base = fallback ?? buildDefaultTargetingAiCodeConfig();
  return {
    enabled: readBoolean(value?.enabled, base.enabled),
    provider: "openai",
    model: readString(value?.model, base.model) || base.model,
    prompt_version: readString(value?.prompt_version, base.prompt_version) || base.prompt_version,
    system_prompt: readString(value?.system_prompt, base.system_prompt) || base.system_prompt,
    user_prompt_template: readString(value?.user_prompt_template, base.user_prompt_template) || base.user_prompt_template,
    max_gpt_candidates: readInt(value?.max_gpt_candidates, base.max_gpt_candidates, 12, 80),
    max_displayed_results: readInt(value?.max_displayed_results, base.max_displayed_results, 8, 40),
    min_followers: readInt(value?.min_followers, base.min_followers, 100, 10_000),
    max_followers: readInt(value?.max_followers, base.max_followers, 1_000, 500_000),
    allow_verified: readBoolean(value?.allow_verified, base.allow_verified),
    min_eligible_target: readInt(value?.min_eligible_target, base.min_eligible_target, 3, 20),
    searchapi_concurrency: readInt(value?.searchapi_concurrency, base.searchapi_concurrency, 1, 6),
    max_searchapi_checks: readInt(value?.max_searchapi_checks, base.max_searchapi_checks, 10, 80),
    second_pass_enabled: readBoolean(value?.second_pass_enabled, base.second_pass_enabled),
    temperature: readFloat(value?.temperature, base.temperature, 0, 1),
    updated_at: readString(value?.updated_at) || null,
    updated_by: readString(value?.updated_by) || null,
  };
}

function resolveFromCodeDefault(): ResolvedTargetingAiConfig {
  const defaults = buildDefaultTargetingAiCodeConfig();
  return {
    ...defaults,
    enabled: targetAiEnabled(),
    model: targetAiModel(),
    prompt_source: "code_default",
    geocoding_user_agent: readGeocodingUserAgent(),
  };
}

function resolveFromDbRow(row: Record<string, unknown>): ResolvedTargetingAiConfig {
  const defaults = buildDefaultTargetingAiCodeConfig();
  const stored = normalizeTargetingAiStoredConfig(row, defaults);
  return {
    ...stored,
    enabled: targetAiEnabled(),
    model: stored.model || targetAiModel(),
    prompt_source: "db_custom",
    geocoding_user_agent: readGeocodingUserAgent(),
  };
}

async function readDbRow() {
  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("ig_system_settings")
      .select("value, updated_at, updated_by")
      .eq("setting_key", TARGETING_AI_SETTING_KEY)
      .maybeSingle();

    if (error) {
      if (error.message.toLowerCase().includes("ig_system_settings")) {
        return { row: null, backend_pending: true, error: error.message };
      }
      return { row: null, backend_pending: false, error: error.message };
    }

    if (!data?.value || typeof data.value !== "object" || Array.isArray(data.value)) {
      return { row: null, backend_pending: false, error: null };
    }

    return {
      row: {
        ...(data.value as Record<string, unknown>),
        updated_at: typeof data.updated_at === "string" ? data.updated_at : null,
        updated_by: typeof data.updated_by === "string" ? data.updated_by : null,
      },
      backend_pending: false,
      error: null,
    };
  } catch (error) {
    return {
      row: null,
      backend_pending: true,
      error: error instanceof Error ? error.message : "targeting_ai_config_unavailable",
    };
  }
}

export async function loadTargetingAiConfigSnapshot(options?: { bypassCache?: boolean }) {
  if (!options?.bypassCache && configCache && configCache.expiresAtMs > Date.now() && configCache.value) {
    return configCache.value;
  }

  const defaults = buildDefaultTargetingAiCodeConfig();
  const db = await readDbRow();
  const active = db.row ? resolveFromDbRow(db.row) : resolveFromCodeDefault();
  const snapshot: TargetingAiConfigSnapshot = {
    active,
    default: defaults,
    prompt_source: active.prompt_source,
    editable: !db.backend_pending,
    openai_key_configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    searchapi_key_configured: isSearchApiConfigured(),
    backend_pending: db.backend_pending,
  };

  configCache = { expiresAtMs: Date.now() + CACHE_TTL_MS, value: snapshot };
  return snapshot;
}

export async function resolveActiveTargetingAiConfig(options?: { bypassCache?: boolean }) {
  const snapshot = await loadTargetingAiConfigSnapshot(options);
  return snapshot.active;
}

export function validateTargetingAiConfigPatch(input: Record<string, unknown>) {
  const normalized = normalizeTargetingAiStoredConfig(input);
  const promptValidation = validateTargetingAiPromptText({
    systemPrompt: normalized.system_prompt,
    userPromptTemplate: normalized.user_prompt_template,
  });
  if (!promptValidation.ok) return promptValidation;

  for (const [field, value, min, max] of [
    ["max_gpt_candidates", normalized.max_gpt_candidates, 12, 80],
    ["max_displayed_results", normalized.max_displayed_results, 8, 40],
    ["min_followers", normalized.min_followers, 100, 10_000],
    ["max_followers", normalized.max_followers, 1_000, 500_000],
    ["min_eligible_target", normalized.min_eligible_target, 3, 20],
    ["searchapi_concurrency", normalized.searchapi_concurrency, 1, 6],
    ["max_searchapi_checks", normalized.max_searchapi_checks, 10, 80],
  ] as const) {
    const result = validateTargetingAiNumericField(field, value, min, max);
    if (!result.ok) return result;
  }

  if (normalized.min_followers >= normalized.max_followers) {
    return { ok: false as const, reason: "min_followers must be lower than max_followers.", field: "min_followers" };
  }

  const forbiddenSecretFields = [
    "openai_api_key",
    "searchapi_key",
    "api_key",
    "OPENAI_API_KEY",
    "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY",
  ];
  for (const key of forbiddenSecretFields) {
    if (key in input) {
      return { ok: false as const, reason: "Secret fields cannot be saved in targeting AI config.", field: key };
    }
  }

  return { ok: true as const, config: normalized };
}

export async function saveTargetingAiConfig(input: {
  patch: Record<string, unknown>;
  updatedBy?: string | null;
}) {
  const validation = validateTargetingAiConfigPatch(input.patch);
  if (!validation.ok) return { ok: false as const, reason: validation.reason, field: validation.field };

  const now = new Date().toISOString();
  const current = await resolveActiveTargetingAiConfig({ bypassCache: true });
  const merged = normalizeTargetingAiStoredConfig({
    ...current,
    ...validation.config,
    prompt_version: readString(input.patch.prompt_version)
      || `targeting_ai_custom_${now.slice(0, 10).replaceAll("-", "")}`,
    updated_at: now,
    updated_by: input.updatedBy ?? null,
  }, buildDefaultTargetingAiCodeConfig());

  const promptChanged = merged.system_prompt !== current.system_prompt
    || merged.user_prompt_template !== current.user_prompt_template;
  if (promptChanged && !readString(input.patch.prompt_version)) {
    merged.prompt_version = `targeting_ai_custom_${now.slice(0, 10).replaceAll("-", "")}`;
  }

  try {
    const supabase = createSupabaseClient();
    const { error } = await supabase
      .from("ig_system_settings")
      .upsert({
        setting_key: TARGETING_AI_SETTING_KEY,
        value: merged,
        updated_at: now,
        updated_by: input.updatedBy ?? null,
      });

    if (error) {
      invalidateTargetingAiConfigCache();
      return {
        ok: false as const,
        reason: error.message,
        backend_pending: error.message.toLowerCase().includes("ig_system_settings"),
      };
    }

    invalidateTargetingAiConfigCache();
    const snapshot = await loadTargetingAiConfigSnapshot({ bypassCache: true });
    return { ok: true as const, snapshot, saved_at: now };
  } catch (error) {
    invalidateTargetingAiConfigCache();
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : "targeting_ai_save_failed",
      backend_pending: true,
    };
  }
}

export async function resetTargetingAiConfig(updatedBy?: string | null) {
  try {
    const supabase = createSupabaseClient();
    const { error } = await supabase
      .from("ig_system_settings")
      .delete()
      .eq("setting_key", TARGETING_AI_SETTING_KEY);

    if (error) {
      return {
        ok: false as const,
        reason: error.message,
        backend_pending: error.message.toLowerCase().includes("ig_system_settings"),
      };
    }

    invalidateTargetingAiConfigCache();
    const snapshot = await loadTargetingAiConfigSnapshot({ bypassCache: true });
    return {
      ok: true as const,
      snapshot,
      reset_to: TARGETING_AI_PROMPT_VERSION,
      updated_by: updatedBy ?? null,
    };
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : "targeting_ai_reset_failed",
      backend_pending: true,
    };
  }
}

export function serializeTargetingAiPublicConfig(snapshot: TargetingAiConfigSnapshot) {
  const { active, default: defaults } = snapshot;
  return {
    service: "targeting_ai",
    schema_version: "v1",
    prompt_source: snapshot.prompt_source,
    prompt_version: active.prompt_version,
    enabled: active.enabled,
    provider: active.provider,
    model: active.model,
    system_prompt: active.system_prompt,
    user_prompt_template: active.user_prompt_template,
    max_gpt_candidates: active.max_gpt_candidates,
    max_displayed_results: active.max_displayed_results,
    min_eligible_target: active.min_eligible_target,
    min_followers: active.min_followers,
    max_followers: active.max_followers,
    allow_verified: active.allow_verified,
    searchapi_concurrency: active.searchapi_concurrency,
    max_searchapi_checks: active.max_searchapi_checks,
    temperature: active.temperature,
    second_pass_enabled: active.second_pass_enabled,
    geocoding_user_agent: active.geocoding_user_agent,
    updated_at: active.updated_at,
    updated_by: active.updated_by,
    openai_key_configured: snapshot.openai_key_configured,
    searchapi_key_configured: snapshot.searchapi_key_configured,
    prompt_editable: snapshot.editable,
    prompt_storage: snapshot.prompt_source === "db_custom" ? "db_custom" : "code_default",
    default_prompt_version: defaults.prompt_version,
    default_system_prompt: defaults.system_prompt,
    default_user_prompt_template: defaults.user_prompt_template,
    backend_pending: snapshot.backend_pending,
  };
}

export function buildDefaultUserPromptTemplateExport() {
  return buildDefaultUserPromptTemplate();
}
