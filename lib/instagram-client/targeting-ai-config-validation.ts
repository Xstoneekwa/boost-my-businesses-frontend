export type TargetingAiValidationResult =
  | { ok: true }
  | { ok: false; reason: string; field?: string };

const forbiddenPromptPatterns = [
  /\bsk-[a-z0-9]{8,}\b/i,
  /\bopenai_api_key\b/i,
  /\bapi[_-]?key\b/i,
  /\bbearer\s+[a-z0-9._-]{8,}\b/i,
  /\bservice_role\b/i,
  /\binstagram_public_profile_lookup_api_key\b/i,
  /\bsearchapi[_-]?key\b/i,
];

const forbiddenFactClaims = [
  /you know which accounts exist/i,
  /provide exact follower counts/i,
  /guarantee.{0,40}exist/i,
  /all accounts exist/i,
];

function stripPromptGuardrailNegations(text: string) {
  return text
    .replace(/never invent follower counts/gi, "")
    .replace(/do not invent follower counts/gi, "")
    .replace(/must not invent follower counts/gi, "");
}

function hasForbiddenFactClaim(text: string) {
  const sanitized = stripPromptGuardrailNegations(text);
  return forbiddenFactClaims.some((pattern) => pattern.test(sanitized))
    || /(?:^|[^\w])invent follower counts/i.test(sanitized);
}

const requiredTemplateTokens = ["{{niche}}", "{{max_candidates}}", "{{min_followers}}"];

export function validateTargetingAiPromptText(input: {
  systemPrompt: string;
  userPromptTemplate: string;
}) {
  const systemPrompt = input.systemPrompt.trim();
  const userPromptTemplate = input.userPromptTemplate.trim();

  if (systemPrompt.length < 20) {
    return { ok: false as const, reason: "System prompt is too short.", field: "system_prompt" };
  }
  if (systemPrompt.length > 8_000) {
    return { ok: false as const, reason: "System prompt exceeds max length.", field: "system_prompt" };
  }
  if (userPromptTemplate.length < 80) {
    return { ok: false as const, reason: "User prompt template is too short.", field: "user_prompt_template" };
  }
  if (userPromptTemplate.length > 12_000) {
    return { ok: false as const, reason: "User prompt template exceeds max length.", field: "user_prompt_template" };
  }

  for (const token of requiredTemplateTokens) {
    if (!userPromptTemplate.includes(token)) {
      return {
        ok: false as const,
        reason: `User prompt template must include ${token}.`,
        field: "user_prompt_template",
      };
    }
  }

  const combined = `${systemPrompt}\n${userPromptTemplate}`;
  for (const pattern of forbiddenPromptPatterns) {
    if (pattern.test(combined)) {
      return { ok: false as const, reason: "Prompt must not contain API key material.", field: "user_prompt_template" };
    }
  }
  if (hasForbiddenFactClaim(combined)) {
    return {
      ok: false as const,
      reason: "Prompt must not ask GPT to invent final Instagram account facts.",
      field: "user_prompt_template",
    };
  }

  return { ok: true as const };
}

export function validateTargetingAiNumericField(
  name: string,
  value: number,
  min: number,
  max: number,
): TargetingAiValidationResult {
  if (!Number.isFinite(value)) {
    return { ok: false, reason: `${name} must be a number.`, field: name };
  }
  if (value < min || value > max) {
    return { ok: false, reason: `${name} must be between ${min} and ${max}.`, field: name };
  }
  return { ok: true };
}
