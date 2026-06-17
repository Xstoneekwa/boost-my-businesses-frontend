import {
  buildTargetAiDiscoveryPrompt,
  parseTargetAiDiscoveryPayload,
  readTargetAiMockUsernames,
  type ParsedTargetAiDiscoveryPayload,
  type TargetAiDiscoveryPass,
} from "./target-ai-contract.ts";
import type { ResolvedTargetingAiConfig } from "./targeting-ai-config-store.ts";

export type TargetAiOpenAiDiscoveryResult = {
  ok: boolean;
  usernames: string[];
  discovery: ParsedTargetAiDiscoveryPayload;
  provider: "openai" | "mock";
  error_code: string | null;
  model: string;
  prompt_version: string;
  prompt_source: "code_default" | "db_custom";
};

export async function callTargetAiOpenAiDiscovery(input: {
  config: ResolvedTargetingAiConfig;
  niche: string;
  locationLabel?: string | null;
  pass: TargetAiDiscoveryPass;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const maxCandidates = input.config.max_gpt_candidates;

  if (!input.config.enabled || !apiKey) {
    const mockUsernames = readTargetAiMockUsernames(maxCandidates);
    return {
      ok: false as const,
      usernames: mockUsernames,
      discovery: parseTargetAiDiscoveryPayload({ usernames: mockUsernames }, maxCandidates),
      provider: "mock" as const,
      error_code: "target_ai_disabled" as const,
      model: input.config.model,
      prompt_version: input.config.prompt_version,
      prompt_source: input.config.prompt_source,
    } satisfies TargetAiOpenAiDiscoveryResult;
  }

  const userPrompt = buildTargetAiDiscoveryPrompt({
    niche: input.niche,
    locationLabel: input.locationLabel,
    maxCandidates,
    minFollowers: input.config.min_followers,
    maxFollowers: input.config.max_followers,
    allowVerified: input.config.allow_verified,
    pass: input.pass,
    userPromptTemplate: input.config.user_prompt_template,
  });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.config.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.config.system_prompt },
        { role: "user", content: userPrompt },
      ],
      temperature: input.config.temperature,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      ok: false as const,
      usernames: [],
      discovery: parseTargetAiDiscoveryPayload(null, maxCandidates),
      provider: "openai" as const,
      error_code: "target_ai_provider_error" as const,
      model: input.config.model,
      prompt_version: input.config.prompt_version,
      prompt_source: input.config.prompt_source,
    } satisfies TargetAiOpenAiDiscoveryResult;
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";

  try {
    const parsed = JSON.parse(content) as unknown;
    const discovery = parseTargetAiDiscoveryPayload(parsed, maxCandidates);
    const usernames = discovery.usernames;
    if (usernames.length === 0 && discovery.searchQueries.length === 0) {
      return {
        ok: false as const,
        usernames: [],
        discovery,
        provider: "openai" as const,
        error_code: "no_candidates_found" as const,
        model: input.config.model,
        prompt_version: input.config.prompt_version,
        prompt_source: input.config.prompt_source,
      } satisfies TargetAiOpenAiDiscoveryResult;
    }
    return {
      ok: true as const,
      usernames,
      discovery,
      provider: "openai" as const,
      error_code: null,
      model: input.config.model,
      prompt_version: input.config.prompt_version,
      prompt_source: input.config.prompt_source,
    } satisfies TargetAiOpenAiDiscoveryResult;
  } catch {
    return {
      ok: false as const,
      usernames: [],
      discovery: parseTargetAiDiscoveryPayload(null, maxCandidates),
      provider: "openai" as const,
      error_code: "target_ai_provider_error" as const,
      model: input.config.model,
      prompt_version: input.config.prompt_version,
      prompt_source: input.config.prompt_source,
    } satisfies TargetAiOpenAiDiscoveryResult;
  }
}
