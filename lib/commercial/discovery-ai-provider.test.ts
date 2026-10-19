import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCommercialProspect, analyzeCommercialProspectWithRetry } from "./discovery-ai.ts";

const valid = { businessName: "Diagnostic Fixture", subsegment: "Hair Salon", locationConfidence: .9, verticalConfidence: .9, confidence: .9,
  dimensions: { instagramImportance: 7, contentQuality: 7, activity: 7, commercialStrength: 7, customerValue: 7, targetingFit: 7, growthPotential: 7, decisionMakerAccess: 7, budgetFit: 7 },
  evidence: ["Public salon description"], reasoning: "Observed fixture evidence.", recommendedChannel: "instagram", recommendedAngle: "A",
  signals: { isLocal: true, isBeautyAesthetics: true, isCommerciallyActive: true, appearsClosed: false } };
const fakeKey = ["unit", "fixture", "not-a-credential"].join("-");
function provider(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "x-request-id": "req_fixture123" } });
}
const success = () => ({ output: [{ content: [{ type: "output_text", text: JSON.stringify(valid) }] }], usage: { input_tokens: 10, output_tokens: 12 } });
async function analyze(status: number, body: unknown) {
  return analyzeCommercialProspect({ city: "Paris", market: "FR", evidence: {}, apiKey: fakeKey, fetchImpl: async () => provider(status, body) });
}

test("200 valid scoring retains HTTP/request id and the strict scoring contract", async () => {
  const result = await analyze(200, success());
  assert.equal(result.ok, true); assert.equal(result.analysis?.businessName, valid.businessName);
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 12 });
  assert.equal(result.providerDiagnostic?.OPENAI_HTTP_STATUS, 200);
  assert.equal(result.providerDiagnostic?.OPENAI_REQUEST_ID, "req_fixture123");
  assert.equal(result.providerDiagnostic?.OPENAI_FAILURE_CLASS, null);
});

for (const [status, type, code, category] of [
  [400, "invalid_request_error", "invalid_json_schema", "invalid_request"],
  [401, "invalid_request_error", "invalid_api_key", "auth"],
  [403, "permission_error", "permission_denied", "auth"],
  [429, "rate_limit_error", "rate_limit_exceeded", "rate_limit"],
  [429, "insufficient_quota", "insufficient_quota", "quota_or_credits"],
  [429, "insufficient_quota", "credit_balance_exhausted", "quota_or_credits"],
  [429, "insufficient_quota", "project_spend_limit_exceeded", "quota_or_credits"],
  [429, "insufficient_quota", "organization_spend_limit_exceeded", "quota_or_credits"],
  [429, "insufficient_quota", "organization_usage_limit_exceeded", "quota_or_credits"],
  [400, "invalid_request_error", "model_not_found", "model_or_endpoint"],
  [404, "invalid_request_error", null, "model_or_endpoint"],
  [408, "timeout_error", null, "timeout"],
  [500, "server_error", "server_error", "provider_5xx"],
  [503, "service_unavailable_error", "server_is_overloaded", "provider_5xx"],
  [409, "conflict_error", "conflict", "unknown_provider_error"],
] as const) {
  test(`${status}/${code}: retains structured diagnostics, classifies ${category}, fails closed`, async () => {
    const result = await analyze(status, { error: { type, code, param: "text.format.schema", message: "Controlled provider error" } });
    assert.equal(result.ok, false); assert.equal(result.analysis, null);
    assert.equal(result.providerDiagnostic?.OPENAI_HTTP_STATUS, status);
    assert.equal(result.providerDiagnostic?.OPENAI_ERROR_TYPE, type);
    assert.equal(result.providerDiagnostic?.OPENAI_ERROR_CODE, code);
    assert.equal(result.providerDiagnostic?.OPENAI_FAILURE_CLASS, category);
    assert.equal(result.providerDiagnostic?.OPENAI_ERROR_PARAM, "text.format.schema");
  });
}

test("quota is never retried, including when only error.type identifies it", async () => {
  let calls = 0;
  const result = await analyzeCommercialProspectWithRetry({ city: "Paris", evidence: {}, apiKey: fakeKey,
    fetchImpl: async () => { calls++; return provider(429, { error: { type: "insufficient_quota", code: null } }); },
    sleep: async () => { assert.fail("quota must not trigger backoff/retry"); } });
  assert.equal(calls, 1); assert.equal(result.attempts, 1);
  assert.equal(result.providerDiagnostic?.OPENAI_FAILURE_CLASS, "quota_or_credits");
});

test("bounded existing transient retry preserves the diagnostics of BOTH actual attempts", async () => {
  let calls = 0;
  const result = await analyzeCommercialProspectWithRetry({ city: "Paris", evidence: {}, apiKey: fakeKey,
    fetchImpl: async () => ++calls === 1 ? provider(503, { error: { type: "server_error", code: "server_is_overloaded" } }) : provider(200, success()), sleep: async () => undefined });
  assert.equal(calls, 2); assert.equal(result.ok, true);
  assert.deepEqual(result.providerAttemptsSafe.map((d) => d.OPENAI_HTTP_STATUS), [503, 200]);
});

for (const [body, errorCode] of [["<html>not json</html>", "invalid_json"], [{ output: [{ content: [{ type: "output_text", text: "not json" }] }] }, "invalid_json"], [{ output: [{ content: [{ type: "output_text", text: "{}" }] }] }, "schema_invalid"]] as const) {
  test(`malformed scoring/JSON fails as parsing, preserving HTTP 200 (${errorCode})`, async () => {
    const result = await analyze(200, body);
    assert.equal(result.ok, false); assert.equal(result.errorCode, errorCode);
    assert.equal(result.providerDiagnostic?.OPENAI_FAILURE_CLASS, "parsing");
    assert.equal(result.providerDiagnostic?.OPENAI_HTTP_STATUS, 200);
  });
}
test("non-JSON provider rejection retains HTTP/request id and primary HTTP failure class", async () => {
  const result = await analyze(503, "<html>unavailable</html>");
  assert.equal(result.ok, false); assert.equal(result.providerDiagnostic?.OPENAI_HTTP_STATUS, 503);
  assert.equal(result.providerDiagnostic?.OPENAI_FAILURE_CLASS, "provider_5xx");
  assert.doesNotMatch(JSON.stringify(result), /<html>/);
});
test("HTTP 200 error payload cannot masquerade as scoring success", async () => {
  const result = await analyze(200, { error: { type: "insufficient_quota", code: "credit_balance_exhausted" } });
  assert.equal(result.ok, false); assert.equal(result.providerDiagnostic?.OPENAI_FAILURE_CLASS, "quota_or_credits");
});
test("timeout retains the timeout class without persisting thrown error text", async () => {
  const result = await analyzeCommercialProspect({ city: "Paris", evidence: {}, apiKey: fakeKey, timeoutMs: 1,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error(fakeKey), { name: "AbortError" })))) });
  assert.equal(result.errorCode, "provider_timeout");
  assert.equal(result.providerDiagnostic?.OPENAI_FAILURE_CLASS, "timeout");
  assert.equal(result.providerDiagnostic?.OPENAI_HTTP_STATUS, null); assert.doesNotMatch(JSON.stringify(result), new RegExp(fakeKey));
});
test("safe metadata cannot retain API keys, Authorization, JWTs, headers or full raw response", async () => {
  const jwt = ["eyJfixture", "payload", "signature"].join(".");
  const result = await analyze(401, { error: { type: fakeKey, code: fakeKey, param: fakeKey,
    message: `Incorrect API key ${fakeKey}; Authorization: Bearer ${fakeKey}; JWT ${jwt}; contact private@example.invalid ${"x".repeat(1000)}` },
    Authorization: `Bearer ${fakeKey}`, prompt: "SENSITIVE_PROMPT_NOT_FOR_DIAGNOSTICS" });
  const safe = JSON.stringify(result);
  for (const secret of [fakeKey, jwt, "private@example.invalid", "SENSITIVE_PROMPT_NOT_FOR_DIAGNOSTICS", "Authorization"]) assert.ok(!safe.includes(secret));
  assert.equal(result.providerDiagnostic?.OPENAI_ERROR_CODE, null);
  assert.ok((result.providerDiagnostic?.OPENAI_ERROR_MESSAGE_SAFE?.length ?? 0) <= 400);
});
test("error messages cannot persist an echoed prompt/evidence or contact number", async () => {
  const result = await analyze(400, { error: { type: "invalid_request_error", message: "Invalid input: PRIVATE_SHORT_PROMPT +33 6 12 34 56 78" } });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SHORT_PROMPT|33 6 12/);
});
test("France and ZA requests preserve prompts, schema, model, token limit and single direct call", async () => {
  for (const market of ["FR", "ZA"] as const) {
    let calls = 0;
    await analyzeCommercialProspect({ city: market === "FR" ? "Paris" : "Cape Town", market, evidence: {}, apiKey: fakeKey, model: "unchanged-model",
      fetchImpl: async (url, init) => {
        calls++; const body = JSON.parse(String(init?.body));
        assert.match(String(url), /\/v1\/responses$/); assert.equal(body.model, "unchanged-model");
        assert.equal(body.max_output_tokens, 1400); assert.equal(body.store, false);
        assert.match(body.input[0].content[0].text, market === "FR" ? /French/ : /South African/);
        assert.equal(body.text.format.strict, true); return provider(200, success());
      } });
    assert.equal(calls, 1);
  }
});
