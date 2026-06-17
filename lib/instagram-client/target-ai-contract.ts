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

export function buildTargetAiSystemPrompt() {
  return [
    "You are a search strategist for an Instagram growth agency.",
    "Your job is to propose candidate discovery hints for public Instagram accounts in a niche.",
    "You do NOT know which accounts exist, their follower counts, avatars, verification, or privacy status.",
    "Never invent follower counts, avatars, verification, or eligibility.",
    "Return strict JSON only. No markdown.",
    `Prompt version: ${TARGETING_AI_PROMPT_VERSION}.`,
  ].join(" ");
}

export function buildTargetAiDiscoveryPrompt(input: {
  niche: string;
  locationLabel?: string | null;
  maxCandidates: number;
  minFollowers: number;
  maxFollowers: number;
  allowVerified: boolean;
  pass: TargetAiDiscoveryPass;
}) {
  const locationLine = input.locationLabel
    ? `Location focus: ${input.locationLabel}. Prioritize local/community/business accounts tied to this area when plausible.`
    : "No specific location was provided. Focus on niche-relevant accounts broadly.";

  const passLine = input.pass === "broadened"
    ? "This is a broadened second pass: widen angles, relax location strictness, include adjacent niches and bilingual FR/EN variants."
    : "This is the primary pass: stay focused on the niche and location.";

  const verifiedLine = input.allowVerified
    ? "Verified accounts may appear but still avoid mega brands and official institutions."
    : "Avoid verified/certified accounts and official brand pages.";

  return [
    "Generate a broad Instagram target discovery strategy for follower-source accounts.",
    passLine,
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
    `- Produce between ${Math.max(24, Math.floor(input.maxCandidates * 0.6))} and ${input.maxCandidates} unique seed usernames across all fields.`,
    "- seed usernames are hypotheses to verify later; many may not exist.",
    "- Usernames must be lowercase, without @, valid Instagram handle format.",
    "- Prefer niche-relevant local businesses, creators, coaches, studios, community pages, and specialized media.",
    "- Include multiple angles: local accounts, niche practitioners, community hubs, business pages, micro/mid creators.",
    "- Use FR and EN naming patterns when relevant to the niche/location.",
    "- Include keywords and hashtag hints that operators could use manually; do not claim they were searched.",
    `- Prefer accounts likely between ${input.minFollowers} and ${input.maxFollowers} followers; avoid celebrities and mega accounts.`,
    verifiedLine,
    "- Avoid obviously private-looking handles and generic national news/media giants.",
    "- Do not include duplicates.",
    "- Do not include explanations outside JSON.",
    `Business niche / keyword: ${input.niche}.`,
    locationLine,
  ].join("\n");
}

export function buildTargetAiPromptPreview() {
  return {
    version: TARGETING_AI_PROMPT_VERSION,
    system: buildTargetAiSystemPrompt(),
    user_template: buildTargetAiDiscoveryPrompt({
      niche: "{{niche}}",
      locationLabel: "{{location_label}}",
      maxCandidates: 50,
      minFollowers: 500,
      maxFollowers: 50_000,
      allowVerified: false,
      pass: "primary",
    }),
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
