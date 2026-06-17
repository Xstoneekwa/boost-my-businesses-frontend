import { CT_MANUAL_FOLLOWERS_MAX_GUARD, CT_QUALITY_MIN_FOLLOWERS } from "../instagram-target-quality.ts";
import { TARGETING_AI_PROMPT_VERSION } from "./targeting-ai-settings.ts";

export type TargetAiDiscoveryPass = "primary" | "broadened";

export type TargetAiDiscoveryResponse = {
  search_strategy_summary?: string;
  search_angles?: Array<{
    label?: string;
    keywords?: string[];
    hashtag_hints?: string[];
    seed_usernames?: string[];
  }>;
  seed_usernames?: string[];
  niche_variants?: string[];
  usernames?: string[];
};

export type TargetingAiStoredConfig = {
  enabled: boolean;
  provider: "openai";
  model: string;
  prompt_version: string;
  system_prompt: string;
  user_prompt_template: string;
  max_gpt_candidates: number;
  max_displayed_results: number;
  min_followers: number;
  max_followers: number;
  allow_verified: boolean;
  min_eligible_target: number;
  searchapi_concurrency: number;
  max_searchapi_checks: number;
  second_pass_enabled: boolean;
  temperature: number;
  updated_at: string | null;
  updated_by: string | null;
};

const usernamePattern = /^[a-z0-9._]{1,30}$/;

export function targetAiEnabled() {
  return process.env.TARGET_AI_ENABLED === "true" && (process.env.TARGET_AI_PROVIDER || "openai") === "openai";
}

export function targetAiModel() {
  return (process.env.TARGET_AI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini").trim() || "gpt-4.1-mini";
}

export function targetingAiPromptVersion() {
  return TARGETING_AI_PROMPT_VERSION;
}

export function buildTargetAiSystemPrompt(version = TARGETING_AI_PROMPT_VERSION) {
  return [
    "You are a search strategist for an Instagram growth agency.",
    "Your job is to propose candidate discovery hints for public Instagram accounts in a niche.",
    "You do NOT know which accounts exist, their follower counts, avatars, verification, or privacy status.",
    "Never invent follower counts, avatars, verification, or eligibility.",
    "Return strict JSON only. No markdown.",
    `Prompt version: ${version}.`,
  ].join(" ");
}

export function buildDefaultUserPromptTemplate() {
  return [
    "Generate a broad Instagram target discovery strategy for follower-source accounts.",
    "{{pass_instruction}}",
    "Return JSON with this shape:",
    "{",
    '  "search_strategy_summary": "short strategy",',
    '  "search_angles": [',
    "    {",
    '      "label": "angle name",',
    '      "keywords": ["keyword1", "keyword2"],',
    '      "hashtag_hints": ["#example"],',
    '      "seed_usernames": ["plausible_handle"]',
    "    }",
    "  ],",
    '  "seed_usernames": ["extra_plausible_handle"],',
    '  "niche_variants": ["adjacent niche phrase"]',
    "}",
    "Rules:",
    "- Produce between {{min_seed_count}} and {{max_candidates}} unique seed usernames across all fields.",
    "- seed usernames are hypotheses to verify later; many may not exist.",
    "- Usernames must be lowercase, without @, valid Instagram handle format.",
    "- Prefer niche-relevant local businesses, creators, coaches, studios, community pages, and specialized media.",
    "- Prioritize accounts with clear local business or practitioner relevance when a location is provided.",
    "- Include multiple angles: local accounts, niche practitioners, community hubs, business pages, micro/mid creators.",
    "- Generate diverse handle patterns (business name, practitioner name, neighborhood, FR/EN variants, niche keyword combos).",
    "- Use FR and EN naming patterns when relevant to the niche/location.",
    "- Include keywords and hashtag hints that operators could use manually; do not claim they were searched.",
    "- Prefer accounts likely between {{min_followers}} and {{max_followers}} followers; avoid celebrities, mega accounts, and generic national media.",
    "- Avoid certified/verified-looking official brands, institutions, and celebrity-adjacent names.",
    "{{verified_rule}}",
    "- Avoid obviously private-looking handles and generic national news/media giants.",
    "- Do not include duplicates.",
    "- Do not include explanations outside JSON.",
    "Business niche / keyword: {{niche}}.",
    "{{location_line}}",
  ].join("\n");
}

function buildPassInstruction(pass: TargetAiDiscoveryPass) {
  return pass === "broadened"
    ? "This is a broadened second pass: widen angles, relax location strictness, include adjacent niches and bilingual FR/EN variants."
    : "This is the primary pass: stay focused on the niche and location.";
}

function buildLocationLine(locationLabel?: string | null) {
  return locationLabel
    ? `Location focus: ${locationLabel}. Prioritize local/community/business accounts tied to this area when plausible.`
    : "No specific location was provided. Focus on niche-relevant accounts broadly.";
}

function buildVerifiedRule(allowVerified: boolean) {
  return allowVerified
    ? "Verified accounts may appear but still avoid mega brands and official institutions."
    : "Avoid verified/certified accounts and official brand pages.";
}

export function renderTargetAiUserPrompt(
  template: string,
  input: {
    niche: string;
    locationLabel?: string | null;
    maxCandidates: number;
    minFollowers: number;
    maxFollowers: number;
    allowVerified: boolean;
    pass: TargetAiDiscoveryPass;
    language?: string | null;
  },
) {
  const replacements: Record<string, string> = {
    "{{pass_instruction}}": buildPassInstruction(input.pass),
    "{{niche}}": input.niche,
    "{{location_label}}": input.locationLabel ?? "",
    "{{location_line}}": buildLocationLine(input.locationLabel),
    "{{language}}": input.language?.trim() || "auto",
    "{{max_candidates}}": String(input.maxCandidates),
    "{{min_seed_count}}": String(Math.max(24, Math.floor(input.maxCandidates * 0.6))),
    "{{min_followers}}": String(input.minFollowers),
    "{{max_followers}}": String(input.maxFollowers),
    "{{verified_rule}}": buildVerifiedRule(input.allowVerified),
  };

  let rendered = template;
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.split(token).join(value);
  }
  return rendered;
}

export function buildDefaultTargetingAiCodeConfig(): TargetingAiStoredConfig {
  return {
    enabled: targetAiEnabled(),
    provider: "openai",
    model: targetAiModel(),
    prompt_version: TARGETING_AI_PROMPT_VERSION,
    system_prompt: buildTargetAiSystemPrompt(),
    user_prompt_template: buildDefaultUserPromptTemplate(),
    max_gpt_candidates: 50,
    max_displayed_results: 20,
    min_followers: CT_QUALITY_MIN_FOLLOWERS,
    max_followers: CT_MANUAL_FOLLOWERS_MAX_GUARD,
    allow_verified: false,
    min_eligible_target: 8,
    searchapi_concurrency: 4,
    max_searchapi_checks: 55,
    second_pass_enabled: true,
    temperature: 0.5,
    updated_at: null,
    updated_by: null,
  };
}

export function buildTargetAiDiscoveryPrompt(input: {
  niche: string;
  locationLabel?: string | null;
  maxCandidates: number;
  minFollowers: number;
  maxFollowers: number;
  allowVerified: boolean;
  pass: TargetAiDiscoveryPass;
  userPromptTemplate?: string;
}) {
  const template = input.userPromptTemplate?.trim() || buildDefaultUserPromptTemplate();
  return renderTargetAiUserPrompt(template, input);
}

export function buildTargetAiPromptPreview() {
  return {
    version: TARGETING_AI_PROMPT_VERSION,
    system: buildTargetAiSystemPrompt(),
    user_template: buildDefaultUserPromptTemplate(),
  };
}

function normalizeUsername(entry: unknown) {
  if (typeof entry !== "string") return null;
  const normalized = entry.trim().replace(/^@+/, "").toLowerCase();
  if (!usernamePattern.test(normalized)) return null;
  return normalized;
}

export function sanitizeTargetAiSuggestedUsernames(value: unknown, maxCandidates: number) {
  return sanitizeTargetAiDiscoveryResponse(value, maxCandidates);
}

export function sanitizeTargetAiDiscoveryResponse(value: unknown, maxCandidates: number) {
  const seen = new Set<string>();
  const output: string[] = [];

  function pushUsername(entry: unknown) {
    const normalized = normalizeUsername(entry);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  const payload = value as TargetAiDiscoveryResponse;

  for (const entry of payload.usernames ?? []) pushUsername(entry);
  for (const entry of payload.seed_usernames ?? []) pushUsername(entry);
  for (const angle of payload.search_angles ?? []) {
    if (!angle || typeof angle !== "object") continue;
    for (const entry of angle.seed_usernames ?? []) pushUsername(entry);
  }

  return output.slice(0, maxCandidates);
}

export function readTargetAiMockUsernames(maxCandidates = 50) {
  const raw = process.env.TARGET_AI_MOCK_USERNAMES?.trim() ?? "";
  if (!raw) return [];
  return sanitizeTargetAiDiscoveryResponse({ usernames: raw.split(/[\s,]+/) }, maxCandidates);
}
