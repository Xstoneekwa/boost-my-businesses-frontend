import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PROFILE_INTELLIGENCE_AI_VERSION,
  PROFILE_INTELLIGENCE_FORMAT_NAME,
  PROFILE_INTELLIGENCE_PROMPT_VERSION,
  PROFILE_INTELLIGENCE_PROMPT_VERSION_EN,
  PROFILE_INTELLIGENCE_PROMPT_VERSION_FR,
  PROFILE_INTELLIGENCE_SYSTEM_PROMPT,
  PROFILE_INTELLIGENCE_SYSTEM_PROMPT_EN,
  PROFILE_INTELLIGENCE_SYSTEM_PROMPT_FR,
  PROFILE_INTELLIGENCE_STRUCTURED_OUTPUT_SCHEMA,
  buildProfileIntelligencePromptSnapshot,
  buildProfileIntelligenceUserPrompt,
  callProfileIntelligenceOpenAi,
  confirmedTargetingLocation,
  containsAiGeographicKey,
  emptyProfileAiAnalysis,
  profileIntelligenceStructuredOutputSchema,
  profileIntelligencePromptVersion,
  profileIntelligenceSystemPrompt,
  readStoredProfileAiAnalysis,
  resolveProfileAiOutputLanguage,
  validateProfileAiOutputLanguage,
  validateProfileAiStructuredOutput,
} from "./profile-intelligence-ai.ts";
import { evaluateProfileAiAnalysis } from "./profile-intelligence-ai-policy.ts";
import {
  applyClientPublicAnalysisConfirmation,
  buildStoredPublicAnalysis,
  projectClientPublicAnalysis,
  readStoredPublicAnalysis,
  withProfileAiAnalysis,
} from "./profile-intelligence.ts";

function output(overrides = {}, outputLanguage = "fr") {
  return {
    analysis_version: PROFILE_INTELLIGENCE_AI_VERSION,
    output_language: outputLanguage,
    suggestions: {
      suggested_category: { value: "Marketing digital", confidence: "high", evidence_fields: ["biography"] },
      niche: { value: "Automatisation Instagram", confidence: "high", evidence_fields: ["biography", "caption_samples"] },
      probable_audience: { value: "Entrepreneurs francophones", confidence: "medium", evidence_fields: ["biography"] },
      themes: { value: ["Instagram", "automatisation", "croissance"], confidence: "high", evidence_fields: ["biography", "caption_samples"] },
      business_description: { value: "Aide les entrepreneurs à automatiser Instagram.", confidence: "medium", evidence_fields: ["biography"] },
      keywords: { value: ["Instagram", "automatisation"], confidence: "high", evidence_fields: ["biography"] },
      exclusions: { value: [], confidence: "low", evidence_fields: [] },
      ...overrides,
    },
  };
}

function englishOutput() {
  return output({
    suggested_category: { value: "Instagram Marketing Consultant", confidence: "high", evidence_fields: ["biography"] },
    niche: { value: "Instagram automation for business growth", confidence: "high", evidence_fields: ["biography", "caption_samples"] },
    probable_audience: { value: "Small business owners and online entrepreneurs", confidence: "medium", evidence_fields: ["biography"] },
    themes: { value: ["Instagram automation", "business growth", "content strategy", "performance marketing"], confidence: "high", evidence_fields: ["biography", "caption_samples"] },
    business_description: { value: "Helps small businesses grow with Instagram automation and content strategy.", confidence: "medium", evidence_fields: ["biography"] },
    keywords: { value: ["business growth", "content strategy", "digital marketing", "lead generation"], confidence: "high", evidence_fields: ["biography"] },
    exclusions: { value: ["personal lifestyle accounts"], confidence: "medium", evidence_fields: ["biography"] },
  }, "en");
}

function snapshot() {
  return buildProfileIntelligencePromptSnapshot({
    username: "public_profile",
    displayName: "Public Profile",
    biography: "Nous aidons les entrepreneurs à automatiser Instagram. Contact: login@example.test +33 6 12 34 56 78",
    category: null,
    isBusiness: null,
    followersCount: 53,
    followingCount: 128,
    postsCount: 24,
    language: "fr",
    location: null,
    externalUrl: "https://www.example.test/private/path?token=secret",
    recentCaptionSamples: Array.from({ length: 7 }, (_, index) => `${index} ${"caption ".repeat(80)} https://cdn.example.test/media.jpg`),
  });
}

function profile() {
  return {
    lookupStatus: "found",
    providerProfileId: null,
    username: "public_profile",
    displayName: "Public Profile",
    biography: "Nous aidons les entrepreneurs à automatiser Instagram.",
    avatarUrl: null,
    avatarHdUrl: null,
    followersCount: 53,
    followingCount: 128,
    postsCount: 24,
    isPrivate: null,
    isVerified: null,
    isBusiness: null,
    officialCategory: null,
    externalUrl: "https://example.test/path",
    bioLinks: [],
    recentCaptionSamples: ["Conseils simples pour automatiser votre stratégie Instagram."],
    checkedAt: "2026-07-21T18:00:00.000Z",
  };
}

test("structured output schema is strict, complete and versioned", () => {
  assert.equal(PROFILE_INTELLIGENCE_PROMPT_VERSION, "profile_intelligence_v2_prompt_v4_no_geo_fr");
  assert.equal(PROFILE_INTELLIGENCE_PROMPT_VERSION_FR, "profile_intelligence_v2_prompt_v4_no_geo_fr");
  assert.equal(PROFILE_INTELLIGENCE_PROMPT_VERSION_EN, "profile_intelligence_v2_prompt_v4_no_geo_en");
  assert.equal(PROFILE_INTELLIGENCE_SYSTEM_PROMPT, PROFILE_INTELLIGENCE_SYSTEM_PROMPT_FR);
  assert.doesNotMatch(PROFILE_INTELLIGENCE_SYSTEM_PROMPT, /profile or client language where appropriate/i);
  assert.ok(PROFILE_INTELLIGENCE_FORMAT_NAME.length <= 64);
  const audit = (schema, path = "$") => {
    assert.equal("const" in schema, false, `${path} uses unsupported const`);
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false, `${path} must reject additional properties`);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), `${path} must require every property`);
      for (const [key, child] of Object.entries(schema.properties)) audit(child, `${path}.${key}`);
    }
    if (schema.type === "array") {
      assert.ok(Number.isInteger(schema.maxItems) && schema.maxItems > 0, `${path} must have maxItems`);
      audit(schema.items, `${path}[]`);
    }
    if (Array.isArray(schema.anyOf)) schema.anyOf.forEach((child, index) => audit(child, `${path}.anyOf[${index}]`));
  };
  audit(PROFILE_INTELLIGENCE_STRUCTURED_OUTPUT_SCHEMA);
  const properties = PROFILE_INTELLIGENCE_STRUCTURED_OUTPUT_SCHEMA.properties.suggestions.properties;
  for (const forbidden of ["suggested_activity_area", "suggested_location", "city", "country", "region", "geographic_area"]) {
    assert.equal(forbidden in properties, false, `${forbidden} must not exist in the schema`);
  }
  assert.deepEqual(profileIntelligenceStructuredOutputSchema("en").properties.output_language.enum, ["en"]);
  assert.deepEqual(validateProfileAiStructuredOutput(output())?.themes.value, ["Instagram", "automatisation", "croissance"]);
});

test("minimized prompt snapshot excludes URLs, identifiers, credentials and caps captions", () => {
  const safe = snapshot();
  const serialized = JSON.stringify(safe);
  assert.equal(safe.external_domain, "example.test");
  assert.equal(safe.caption_samples?.length, 5);
  assert.ok(safe.caption_samples?.every((caption) => caption.length <= 280));
  assert.doesNotMatch(serialized, /token=|https?:|login@example|\+33|password|email|phone|tenant|entitlement|account_uuid|device|clone|vault/i);
  assert.deepEqual(Object.keys(safe), [
    "output_language", "profile_language", "username", "display_name", "biography",
    "followers_count", "following_count", "posts_count", "external_domain", "caption_samples",
  ]);
  assert.equal("official_category" in safe, false);
  assert.equal("is_business" in safe, false);
  assert.equal("public_location" in safe, false);
  assert.equal(buildProfileIntelligenceUserPrompt(safe).includes("profile_intelligence_v2_prompt_v1"), false);
});

test("localized V4 no-geo prompts are selected deterministically and remain semantically equivalent", () => {
  const frenchPrompt = profileIntelligenceSystemPrompt("fr");
  const englishPrompt = profileIntelligenceSystemPrompt("en");
  assert.equal(frenchPrompt, PROFILE_INTELLIGENCE_SYSTEM_PROMPT_FR);
  assert.equal(englishPrompt, PROFILE_INTELLIGENCE_SYSTEM_PROMPT_EN);
  assert.equal(profileIntelligencePromptVersion("fr"), PROFILE_INTELLIGENCE_PROMPT_VERSION_FR);
  assert.equal(profileIntelligencePromptVersion("en"), PROFILE_INTELLIGENCE_PROMPT_VERSION_EN);
  for (const contract of ["uniquement les données publiques", "sans recherche externe", "français naturel", "Localisation hors analyse", "aucune ville", "chaîne de raisonnement"]) {
    assert.ok(frenchPrompt.includes(contract), `French prompt misses: ${contract}`);
  }
  assert.doesNotMatch(frenchPrompt, /Analyze only|client-facing|Never invent|chain of thought/);
  for (const contract of ["supplied public Instagram data", "external research", "natural English", "Location outside this analysis", "no city", "chain of thought"]) {
    assert.ok(englishPrompt.includes(contract), `English prompt misses: ${contract}`);
  }
  const englishSnapshot = { ...snapshot(), output_language: "en", profile_language: "en" };
  assert.match(buildProfileIntelligenceUserPrompt(snapshot()), /prompt_version=profile_intelligence_v2_prompt_v4_no_geo_fr/);
  assert.match(buildProfileIntelligenceUserPrompt(englishSnapshot), /prompt_version=profile_intelligence_v2_prompt_v4_no_geo_en/);
});

test("default gpt-4o-mini call uses the exact minimal Responses allowlist", async () => {
  let calls = 0;
  let body = null;
  let endpoint = null;
  const result = await callProfileIntelligenceOpenAi({
    snapshot: snapshot(),
    apiKey: "test-key-never-logged",
    fetchImpl: async (url, init) => {
      calls += 1;
      endpoint = String(url);
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output()) }] }],
        usage: { input_tokens: 800, output_tokens: 200 },
      }), { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "req_test" } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(endpoint, "https://api.openai.com/v1/responses");
  assert.deepEqual(Object.keys(body), ["model", "input", "text", "max_output_tokens", "store"]);
  assert.deepEqual(Object.keys(body.text), ["format"]);
  assert.deepEqual(Object.keys(body.text.format), ["type", "name", "strict", "schema"]);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.name, PROFILE_INTELLIGENCE_FORMAT_NAME);
  assert.equal(body.input[0].content[0].text, PROFILE_INTELLIGENCE_SYSTEM_PROMPT_FR);
  assert.deepEqual(body.text.format.schema.properties.output_language.enum, ["fr"]);
  assert.equal(body.model, "gpt-4o-mini-2024-07-18");
  assert.equal(body.max_output_tokens, 1000);
  assert.equal(body.store, false);
  for (const forbidden of [
    "verbosity", "reasoning", "reasoning_effort", "response_format", "messages",
    "temperature", "top_p", "tools", "parallel_tool_calls",
  ]) assert.equal(forbidden in body, false, `${forbidden} must not be sent`);
  assert.equal("verbosity" in body.text, false);
  assert.equal(result.diagnostic.request_id, "req_test");
  assert.equal(result.metrics.input_tokens, 800);
  assert.equal(result.metrics.output_tokens, 200);
  assert.equal(result.metrics.estimated_cost_usd, 0.00024);
  assert.equal(result.outputLanguage, "fr");
  assert.equal(result.schemaValid, true);
  assert.equal(result.businessOutputValid, true);
  assert.deepEqual(result.languageValidation, { valid: true, detected_language: "fr", reason: "matched" });
});

test("explicit gpt-4o-mini benchmark call keeps Responses allowlist and benchmark pricing", async () => {
  let body = null;
  const englishSnapshot = { ...snapshot(), output_language: "en", profile_language: "en" };
  const result = await callProfileIntelligenceOpenAi({
    snapshot: englishSnapshot,
    apiKey: "test-key-never-logged",
    model: "gpt-4o-mini-2024-07-18",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(englishOutput()) }] }],
        usage: { input_tokens: 800, output_tokens: 200 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(body.model, "gpt-4o-mini-2024-07-18");
  assert.deepEqual(Object.keys(body), ["model", "input", "text", "max_output_tokens", "store"]);
  assert.equal(body.input[0].content[0].text, PROFILE_INTELLIGENCE_SYSTEM_PROMPT_EN);
  assert.match(body.input[1].content[0].text, /prompt_version=profile_intelligence_v2_prompt_v4_no_geo_en/);
  assert.equal(result.metrics.estimated_cost_usd, 0.00024);
});

test("output language resolution prefers client locale, then profile language, then French", () => {
  assert.equal(resolveProfileAiOutputLanguage("en", "fr"), "en");
  assert.equal(resolveProfileAiOutputLanguage("es", "en"), "en");
  assert.equal(resolveProfileAiOutputLanguage(null, null), "fr");
});

test("language validator accepts natural French and natural English under matching contracts", () => {
  const french = validateProfileAiStructuredOutput(output(), "fr");
  const english = validateProfileAiStructuredOutput(englishOutput(), "en");
  assert.equal(validateProfileAiOutputLanguage(french, "fr").valid, true);
  assert.equal(validateProfileAiOutputLanguage(english, "en").valid, true);
});

test("language validator rejects clear French-English contract divergence", () => {
  const englishUnderFrenchContract = validateProfileAiStructuredOutput({ ...englishOutput(), output_language: "fr" }, "fr");
  const frenchUnderEnglishContract = validateProfileAiStructuredOutput({ ...output(), output_language: "en" }, "en");
  assert.deepEqual(validateProfileAiOutputLanguage(englishUnderFrenchContract, "fr"), {
    valid: false,
    detected_language: "en",
    reason: "clear_mismatch",
  });
  assert.equal(validateProfileAiOutputLanguage(frenchUnderEnglishContract, "en").valid, false);
});

test("French output tolerates isolated acronyms, brands and technical terms", () => {
  const parsed = validateProfileAiStructuredOutput(output({
    niche: { value: "Automatisation Instagram B2B avec CRM et API", confidence: "high", evidence_fields: ["biography"] },
    themes: { value: ["stratégie Instagram", "automatisation CRM", "performance SEO"], confidence: "high", evidence_fields: ["biography"] },
    business_description: { value: "Accompagne les entreprises avec HubSpot et Instagram pour développer leur activité.", confidence: "high", evidence_fields: ["biography"] },
    keywords: { value: ["automatisation Instagram", "stratégie B2B", "performance CRM"], confidence: "high", evidence_fields: ["biography"] },
  }), "fr");
  assert.equal(validateProfileAiOutputLanguage(parsed, "fr").valid, true);
});

test("majority-English keyword lists are rejected by the French contract", () => {
  const parsed = validateProfileAiStructuredOutput(output({
    keywords: { value: ["business growth", "content strategy", "digital marketing", "lead generation"], confidence: "high", evidence_fields: ["biography"] },
  }), "fr");
  assert.equal(validateProfileAiOutputLanguage(parsed, "fr").valid, false);
});

test("insufficient text or proper nouns alone are handled conservatively", () => {
  const parsed = validateProfileAiStructuredOutput(output({
    suggested_category: { value: "Instagram", confidence: "low", evidence_fields: ["biography"] },
    niche: { value: "HubSpot", confidence: "low", evidence_fields: ["biography"] },
    probable_audience: { value: null, confidence: "low", evidence_fields: [] },
    themes: { value: ["Instagram", "OpenAI"], confidence: "low", evidence_fields: ["biography"] },
    business_description: { value: null, confidence: "low", evidence_fields: [] },
    keywords: { value: ["CRM", "API"], confidence: "low", evidence_fields: ["biography"] },
    exclusions: { value: [], confidence: "low", evidence_fields: [] },
  }), "fr");
  assert.deepEqual(validateProfileAiOutputLanguage(parsed, "fr"), {
    valid: true,
    detected_language: null,
    reason: "insufficient_or_ambiguous",
  });
});

test("missing or contract-mismatched output_language is rejected structurally", () => {
  const missing = output();
  delete missing.output_language;
  assert.equal(validateProfileAiStructuredOutput(missing, "fr"), null);
  assert.equal(validateProfileAiStructuredOutput(englishOutput(), "fr"), null);
});

test("language mismatch fails after one provider fetch and exposes no suggestions", async () => {
  let calls = 0;
  const mismatched = { ...englishOutput(), output_language: "fr" };
  const result = await callProfileIntelligenceOpenAi({
    snapshot: snapshot(),
    apiKey: "test-key",
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(mismatched) }] }],
        usage: { input_tokens: 700, output_tokens: 180 },
      }), { status: 200 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.schemaValid, true);
  assert.equal(result.businessOutputValid, false);
  assert.equal(result.errorCode, "output_language_mismatch");
  assert.equal(result.suggestions, null);
  const service = readFileSync(new URL("./client-account-onboarding.ts", import.meta.url), "utf8");
  assert.match(service, /status: providerResult\.ok \? "completed" as const : "failed_retryable" as const/);
  assert.match(service, /suggestions: providerResult\.ok \? providerResult\.suggestions : claimedPublicAnalysis\.ai_analysis\?\.suggestions \?\? null/);
});

test("invalid provider JSON fails open without suggestions", async () => {
  const result = await callProfileIntelligenceOpenAi({
    snapshot: snapshot(),
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "not-json" }] }] }), { status: 200 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "invalid_ai_output");
  assert.equal(result.suggestions, null);
});

test("provider timeout is bounded and retryable", async () => {
  const result = await callProfileIntelligenceOpenAi({
    snapshot: snapshot(),
    apiKey: "test-key",
    timeoutMs: 5,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "provider_timeout");
  assert.equal(result.providerCallAttempted, true);
});

test("provider timeout also bounds response body parsing", async () => {
  const result = await callProfileIntelligenceOpenAi({
    snapshot: snapshot(),
    apiKey: "test-key",
    timeoutMs: 5,
    fetchImpl: async (_url, init) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }),
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "provider_timeout");
  assert.equal(result.providerCallAttempted, true);
});

test("missing key and provider HTTP failures are redacted, normalized and never retried", async () => {
  let calls = 0;
  const missing = await callProfileIntelligenceOpenAi({ snapshot: snapshot(), apiKey: "", fetchImpl: async () => { calls += 1; return new Response(); } });
  assert.equal(missing.errorCode, "provider_key_missing");
  assert.equal(missing.providerCallAttempted, false);
  assert.equal(calls, 0);
  const temporary = await callProfileIntelligenceOpenAi({ snapshot: snapshot(), apiKey: "test", fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ error: { type: "server_error", code: "server_error", param: null, message: "must not survive" } }), { status: 503, headers: { "x-request-id": "req_503" } }); } });
  assert.equal(temporary.errorCode, "provider_temporary_failure");
  assert.deepEqual(temporary.diagnostic, { http_status: 503, error_type: "server_error", error_code: "server_error", error_param: null, request_id: "req_503", category: "provider_temporary_failure" });
  assert.doesNotMatch(JSON.stringify(temporary), /must not survive/);
  const schema = await callProfileIntelligenceOpenAi({ snapshot: snapshot(), apiKey: "test", fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "invalid_json_schema", param: "text.format.schema", message: "raw detail" } }), { status: 400 }); } });
  assert.equal(schema.errorCode, "provider_schema_rejected");
  const auth = await callProfileIntelligenceOpenAi({ snapshot: snapshot(), apiKey: "test", fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "invalid_api_key", param: null } }), { status: 401 }); } });
  assert.equal(auth.errorCode, "provider_auth_failed");
  const quota = await callProfileIntelligenceOpenAi({ snapshot: snapshot(), apiKey: "test", fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ error: { type: "insufficient_quota", code: "insufficient_quota", param: null } }), { status: 429 }); } });
  assert.equal(quota.errorCode, "provider_quota_exceeded");
  assert.equal(calls, 4);
});

test("all geographic output keys are rejected deterministically", () => {
  for (const key of ["suggested_activity_area", "suggested_location", "city", "country", "region", "geographic_area", "service_area"]) {
    const invalid = output({ [key]: { value: "Johannesburg", confidence: "high", evidence_fields: ["biography"] } });
    assert.equal(containsAiGeographicKey(invalid), true);
    assert.equal(validateProfileAiStructuredOutput(invalid), null);
  }
});

test("schema has no business-status or official-category mutation fields", () => {
  const properties = PROFILE_INTELLIGENCE_STRUCTURED_OUTPUT_SCHEMA.properties.suggestions.properties;
  assert.equal("is_business" in properties, false);
  assert.equal("official_category" in properties, false);
  assert.equal("suggested_business" in properties, false);
  assert.equal("suggested_category" in properties, true);
  for (const forbidden of ["public_location", "confirmed_location", "is_private", "is_verified"]) {
    assert.equal(forbidden in properties, false);
  }
  assert.equal(validateProfileAiStructuredOutput(output({
    official_category: { value: "Entrepreneur", confidence: "high", evidence_fields: ["biography"] },
  })), null);
});

test("AI suggestions cannot overwrite public category, business, visibility, verification, or location", () => {
  const factual = buildStoredPublicAnalysis({
    ...profile(),
    officialCategory: "Entrepreneur",
    isBusiness: true,
    isPrivate: false,
    isVerified: true,
  });
  factual.fields.location = {
    value: "Paris",
    source_type: "public_observed",
    source_field: "profile.public_address",
    source_provider: "searchapi",
    confidence: 1,
    observed_at: "2026-07-21T18:00:00.000Z",
    confirmed_at: null,
  };
  const completed = withProfileAiAnalysis(factual, {
    ...emptyProfileAiAnalysis(),
    status: "completed",
    suggestions: validateProfileAiStructuredOutput(output()),
  });
  assert.equal(completed.fields.officialCategory.value, "Entrepreneur");
  assert.equal(completed.fields.isBusiness.value, true);
  assert.equal(completed.fields.isPrivate.value, false);
  assert.equal(completed.fields.isVerified.value, true);
  assert.equal(completed.fields.location.value, "Paris");
  assert.equal(completed.fields.location.source_type, "public_observed");
});

test("policy handles double click, idempotence, concurrency, cooldown, expiry and terminal sessions", () => {
  const now = new Date("2026-07-21T18:10:00.000Z");
  const common = { sessionStatus: "active", currentStep: "analysis", expiresAt: "2026-07-28T18:00:00.000Z", requestKey: "key-a", now };
  assert.equal(evaluateProfileAiAnalysis(common).action, "allow");
  const running = { ...emptyProfileAiAnalysis(), status: "running", request_key: "key-a", requested_at: "2026-07-21T18:09:50.000Z", lease_expires_at: "2026-07-21T18:10:20.000Z" };
  assert.equal(evaluateProfileAiAnalysis({ ...common, aiAnalysis: running }).action, "return_existing");
  assert.deepEqual(evaluateProfileAiAnalysis({ ...common, requestKey: "key-b", aiAnalysis: running }), { action: "reject", code: "profile_ai_in_progress", status: 409 });
  const expiredLease = { ...running, lease_expires_at: "2026-07-21T18:09:59.000Z" };
  assert.deepEqual(evaluateProfileAiAnalysis({ ...common, requestKey: "key-b", aiAnalysis: expiredLease }), { action: "allow", reclaimedLease: true });
  const completed = { ...emptyProfileAiAnalysis(), status: "completed", request_key: "key-a", completed_at: "2026-07-21T18:09:30.000Z" };
  assert.equal(evaluateProfileAiAnalysis({ ...common, aiAnalysis: completed }).action, "return_existing");
  assert.deepEqual(evaluateProfileAiAnalysis({ ...common, requestKey: "key-b", aiAnalysis: completed }), { action: "reject", code: "profile_ai_cooldown", status: 429 });
  assert.equal(evaluateProfileAiAnalysis({ ...common, sessionStatus: "completed" }).action, "reject");
  assert.equal(evaluateProfileAiAnalysis({ ...common, expiresAt: "2026-07-21T18:00:00.000Z" }).action, "reject");
});

test("V2 suggestions survive serialization, remain distinct, and become user confirmed", () => {
  const factual = buildStoredPublicAnalysis(profile());
  const completed = withProfileAiAnalysis(factual, {
    ...emptyProfileAiAnalysis(),
    status: "completed",
    request_key: "key-a",
    requested_at: "2026-07-21T18:00:00.000Z",
    completed_at: "2026-07-21T18:00:03.000Z",
    suggestions: validateProfileAiStructuredOutput(output()),
  });
  const refreshed = readStoredPublicAnalysis(JSON.parse(JSON.stringify(completed)));
  assert.equal(refreshed?.fields.officialCategory.value, null);
  assert.equal(refreshed?.category, null);
  assert.equal(projectClientPublicAnalysis(refreshed)?.niche, "Automatisation Instagram");
  assert.equal(projectClientPublicAnalysis(refreshed)?.sources.niche, "ai_suggested");
  const confirmed = applyClientPublicAnalysisConfirmation({
    ...projectClientPublicAnalysis(refreshed),
    niche: "Automatisation Instagram B2B",
  }, refreshed, "2026-07-21T18:05:00.000Z");
  assert.equal(confirmed.ai_analysis?.suggestions?.niche.value, "Automatisation Instagram");
  assert.equal(confirmed.ai_analysis?.confirmed_values?.niche, "Automatisation Instagram B2B");
  assert.equal(confirmed.ai_analysis?.confirmation_status, "confirmed");
  assert.equal(projectClientPublicAnalysis(confirmed)?.sources.niche, "user_confirmed");
});

test("AI analysis implementation cannot create business records or call Target AI/SearchAPI", () => {
  const service = readFileSync(new URL("./client-account-onboarding.ts", import.meta.url), "utf8");
  const section = service.split("export async function analyzeClientInstagramProfileWithAi")[1].split("export async function loadClientOnboardingAvatarSource")[0];
  assert.doesNotMatch(section, /createClientInstagramAccount|lookupInstagramPublicProfile|TargetAi|targeting-ai|SearchAPI|SerpApi|markEntitlementConsumed|credentials|password/i);
  assert.doesNotMatch(section, /\.from\("ig_accounts"\)|\.from\("client_account_entitlements"\)|\.insert\(/);
  assert.match(section, /\.from\("client_instagram_onboarding_sessions"\)/);
  assert.match(section, /\.eq\("client_id", input\.clientId\)/);
  assert.match(section, /\.eq\("status", "active"\)/);
  assert.match(section, /\.eq\("current_step", "analysis"\)/);
});

test("Profile Intelligence is package-neutral while Growth Target AI gate stays locked", () => {
  const route = readFileSync(new URL("../../app/api/instagram-client/onboarding/route.ts", import.meta.url), "utf8");
  const wizard = readFileSync(new URL("../../app/instagram-client/ClientInstagramOnboardingWizard.tsx", import.meta.url), "utf8");
  assert.match(route, /action === "analyze_ai"/);
  assert.doesNotMatch(route.split("action === \"analyze_ai\"")[1].split("try \{")[0], /isClientAiTargetingEnabled|plan_not_allowed/);
  assert.match(wizard, /isClientAiTargetingEnabled/);
});

test("stored AI sanitizer preserves only the bounded contract", () => {
  const sanitized = readStoredProfileAiAnalysis({
    ...emptyProfileAiAnalysis(),
    status: "completed",
    model: "gpt-4o-mini-2024-07-18",
    suggestions: {
      ...output().suggestions,
      suggested_activity_area: { value: "Johannesburg", confidence: "high", evidence_fields: ["biography"] },
    },
    confirmed_values: { niche: "Automatisation Instagram", suggested_activity_area: "Johannesburg" },
    secret: "must-not-survive",
  });
  assert.equal(sanitized.status, "completed");
  assert.equal(sanitized.suggestions?.niche.value, "Automatisation Instagram");
  assert.equal("suggested_activity_area" in sanitized.suggestions, false);
  assert.equal("suggested_activity_area" in sanitized.confirmed_values, false);
  assert.equal(JSON.stringify(sanitized).includes("must-not-survive"), false);
});

test("confirmed targeting locations accept only public-observed or user-confirmed provenance", () => {
  assert.deepEqual(confirmedTargetingLocation("Paris", "public_observed"), { value: "Paris", source_type: "public_observed" });
  assert.deepEqual(confirmedTargetingLocation("Île-de-France", "user_confirmed"), { value: "Île-de-France", source_type: "user_confirmed" });
  assert.equal(confirmedTargetingLocation("Johannesburg", "ai_suggested"), null);
  assert.equal(confirmedTargetingLocation("", "user_confirmed"), null);
});

test("public location is preserved and client location confirmation remains separate from AI", () => {
  const stored = buildStoredPublicAnalysis(profile());
  stored.fields.location = {
    value: "Paris",
    source_type: "public_observed",
    source_field: "profile.public_address",
    source_provider: "searchapi",
    confidence: 1,
    observed_at: "2026-07-21T18:00:00.000Z",
    confirmed_at: null,
  };
  const hydrated = readStoredPublicAnalysis(stored);
  const confirmed = applyClientPublicAnalysisConfirmation({
    ...projectClientPublicAnalysis(hydrated),
    location: "Île-de-France",
  }, hydrated, "2026-07-21T18:06:00.000Z");
  assert.equal(confirmed.fields.location.value, "Paris");
  assert.equal(confirmed.fields.location.source_type, "public_observed");
  assert.equal(confirmed.confirmations.location?.value, "Île-de-France");
  assert.equal(confirmed.confirmations.location?.source_type, "user_confirmed");
  assert.equal(projectClientPublicAnalysis(confirmed)?.location, "Île-de-France");
});
