import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCompassAiPrompt,
  fallbackCompassAiUnavailable,
  sanitizeCompassSnapshot,
  validateCompassAiAnalysis,
} from "../app/api/instagram-dashboard/compass/analyze/compass-ai-contract.ts";

const routeSource = readFileSync(new URL("../app/api/instagram-dashboard/compass/analyze/route.ts", import.meta.url), "utf8");

test("sanitizes Compass AI snapshot before provider call", () => {
  const sanitized = sanitizeCompassSnapshot({
    period: "7d",
    credentials_blockers: [{ username: "client_account", secret_note: "must_not_render" }],
    raw_xml: "<hierarchy>must_not_render</hierarchy>",
    evidence_summaries: ["Safe summary", "Bearer must_not_render"],
  });

  const text = JSON.stringify(sanitized);
  assert.match(text, /Safe summary/);
  assert.doesNotMatch(text, /secret_note/);
  assert.doesNotMatch(text, /must_not_render/);
  assert.doesNotMatch(text, /hierarchy/);
});

test("builds strict prompt around facts and non-executable actions", () => {
  const prompt = buildCompassAiPrompt({ period: "7d", active_accounts_count: 4 });
  const combined = JSON.stringify(prompt);
  assert.match(combined, /Use only the provided facts/);
  assert.match(combined, /AI cannot execute actions/);
  assert.match(combined, /strict JSON/);
});

test("validates structured Compass AI output and forces internal signal flags", () => {
  const analysis = validateCompassAiAnalysis({
    analysis_id: "analysis-1",
    period: "7d",
    overall_summary: "Credentials blockers should be handled first.",
    health_assessment: "risk",
    recommendations: [{
      id: "rec-1",
      severity: "critical",
      confidence: "high",
      title: "Open Credentials",
      admin_summary: "Two accounts need secure access action.",
      client_summary: "Secure account access action is needed.",
      client_visible: true,
      client_recommendation_input: true,
      technical_reason: "credential blocker group",
      client_safe_reason: "Account access action required.",
      affected_accounts: [{
        account_id: "acct_1",
        username: "safe_user",
        client_id: "client_1",
        reason: "Secure account access update required.",
        target_tab: "credentials",
      }],
      recommended_actions: [{
        label: "Open Credentials",
        target_tab: "credentials",
        filter: "credentials",
        action_type: "open_tab",
      }],
      evidence: [{
        source: "credentials_actions",
        summary: "2 blocking actions",
        confidence: "high",
      }],
    }],
    internal_signals: [{
      signal: "inactive_accounts",
      admin_visible: true,
      client_raw_visible: true,
      client_recommendation_input: false,
      count: 5,
      summary: "5 accounts have no recent work signal.",
    }],
  });

  assert.ok(analysis);
  assert.equal(analysis.health_assessment, "risk");
  assert.equal(analysis.recommendations[0].affected_accounts[0].target_tab, "credentials");
  assert.equal(analysis.internal_signals[0].client_raw_visible, false);
  assert.equal(analysis.internal_signals[0].client_recommendation_input, true);
});

test("rejects invalid provider output", () => {
  assert.equal(validateCompassAiAnalysis({ recommendations: [] }), null);
});

test("missing provider config produces rules-only fallback", () => {
  const fallback = fallbackCompassAiUnavailable("7d", "AI advisor unavailable.");
  assert.equal(fallback.period, "7d");
  assert.equal(fallback.recommendations.length, 0);
  assert.equal(fallback.health_assessment, "watch");
});

test("route is server-side and does not expose provider key to clients", () => {
  assert.match(routeSource, /OPENAI_API_KEY/);
  assert.match(routeSource, /server_side_only/);
  assert.match(routeSource, /actions_executable: false/);
  assert.doesNotMatch(routeSource, /NEXT_PUBLIC_OPENAI/);
});
