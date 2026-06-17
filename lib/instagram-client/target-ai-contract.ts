export type TargetAiSuggestedUsernames = {
  usernames: string[];
};

const usernamePattern = /^[a-z0-9._]{1,30}$/;

export function targetAiEnabled() {
  return process.env.TARGET_AI_ENABLED === "true" && (process.env.TARGET_AI_PROVIDER || "openai") === "openai";
}

export function targetAiModel() {
  return (process.env.TARGET_AI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini").trim() || "gpt-4.1-mini";
}

export function buildTargetAiDiscoveryPrompt(input: {
  niche: string;
  locationLabel?: string | null;
  maxCandidates: number;
}) {
  const locationLine = input.locationLabel
    ? `Location focus: ${input.locationLabel}.`
    : "No specific location was provided.";

  return [
    "You help an Instagram growth agency suggest public Instagram usernames to target as follower sources.",
    "Return only JSON with this exact shape: {\"usernames\":[\"username1\",\"username2\"]}.",
    "Rules:",
    `- Suggest between 6 and ${input.maxCandidates} distinct usernames.`,
    "- Usernames must be lowercase, without @, valid Instagram public profile handles.",
    "- Prefer niche-relevant local businesses, creators, or community accounts.",
    "- Do not include celebrity mega accounts, verified brands, or obviously private-looking handles.",
    "- Do not include duplicates.",
    "- Do not include explanations or markdown.",
    `Business niche / keyword: ${input.niche}.`,
    locationLine,
  ].join("\n");
}

export function sanitizeTargetAiSuggestedUsernames(value: unknown, maxCandidates: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const usernames = (value as { usernames?: unknown }).usernames;
  if (!Array.isArray(usernames)) return [];

  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of usernames) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim().replace(/^@+/, "").toLowerCase();
    if (!usernamePattern.test(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= maxCandidates) break;
  }
  return output;
}

export function readTargetAiMockUsernames() {
  const raw = process.env.TARGET_AI_MOCK_USERNAMES?.trim() ?? "";
  if (!raw) return [];
  return sanitizeTargetAiSuggestedUsernames({ usernames: raw.split(/[\s,]+/) }, 12);
}
