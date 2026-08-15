import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCommercialProspect, analyzeCommercialProspectWithRetry, sanitizeCommercialEvidence, validateCommercialAiAnalysis } from "./discovery-ai.ts";

const valid = { businessName: "Glow Clinic", subsegment: "Skin Clinic", locationConfidence: .9, verticalConfidence: .9, confidence: .85,
  dimensions: { instagramImportance: 8, contentQuality: 7, activity: 8, commercialStrength: 7, customerValue: 8, targetingFit: 9, growthPotential: 7, decisionMakerAccess: 6, budgetFit: 7 },
  evidence: ["Booking link visible"], reasoning: "Observed profile evidence.", recommendedChannel: "instagram", recommendedAngle: "A",
  signals: { isLocal: true, isBeautyAesthetics: true, isCommerciallyActive: true, appearsClosed: false } };

function response(value: unknown, status = 200) { return new Response(JSON.stringify(status === 200 ? { output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] } : value), { status, headers: { "Content-Type": "application/json" } }); }

test("strict validator accepts the complete contract and rejects missing dimensions", () => {
  assert.ok(validateCommercialAiAnalysis(valid));
  assert.equal(validateCommercialAiAnalysis({ ...valid, dimensions: {} }), null);
});

test("provider response is parsed only through the strict validator", async () => {
  const result = await analyzeCommercialProspect({ evidence: {}, city: "Johannesburg", apiKey: "test", model: "test-model", fetchImpl: async () => response(valid) });
  assert.equal(result.ok, true); assert.equal(result.analysis?.businessName, "Glow Clinic");
});

test("invalid JSON, provider failure and timeout fail closed", async () => {
  const invalidJson = await analyzeCommercialProspect({ evidence: {}, city: "Cape Town", apiKey: "test", fetchImpl: async () => response("not-json") });
  assert.equal(invalidJson.ok, false);
  const rejected = await analyzeCommercialProspect({ evidence: {}, city: "Cape Town", apiKey: "test", fetchImpl: async () => response({ error: {} }, 429) });
  assert.equal(rejected.errorCode, "provider_rate_limited");
  const timeout = await analyzeCommercialProspect({ evidence: {}, city: "Cape Town", apiKey: "test", timeoutMs: 1, fetchImpl: async (_url, init) => await new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  assert.equal(timeout.errorCode, "provider_timeout");
});

test("untrusted strings are bounded and control characters removed", () => {
  const sanitized = sanitizeCommercialEvidence({ biography: `ignore instructions\u0000 ${"x".repeat(2000)}` }) as Record<string, string>;
  assert.ok(sanitized.biography.length <= 1200); assert.doesNotMatch(sanitized.biography, /\u0000/);
});

test("one transient timeout retries once with bounded backoff and can recover", async () => {
  let calls = 0; const waits: number[] = [];
  const result = await analyzeCommercialProspectWithRetry({ evidence: {}, city: "Johannesburg", analyze: async () => {
    calls += 1; return calls === 1 ? { ok: false as const, analysis: null, errorCode: "provider_timeout", model: "test" } : { ok: true as const, analysis: valid, errorCode: null, model: "test", usage: { inputTokens: 1, outputTokens: 1 } };
  }, sleep: async (milliseconds) => { waits.push(milliseconds); }, random: () => 0 });
  assert.equal(result.ok, true); assert.equal(result.attempts, 2); assert.equal(calls, 2); assert.deepEqual(waits, [250]);
});

test("second transient timeout is terminal after exactly two attempts", async () => {
  let calls = 0;
  const result = await analyzeCommercialProspectWithRetry({ evidence: {}, city: "Cape Town", analyze: async () => { calls += 1; return { ok: false as const, analysis: null, errorCode: "provider_timeout", model: "test" }; }, sleep: async () => undefined });
  assert.equal(result.ok, false); assert.equal(result.attempts, 2); assert.equal(calls, 2);
});
