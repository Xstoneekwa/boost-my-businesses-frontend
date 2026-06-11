import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCompassAiPrompt,
  COMPASS_AI_DEFAULT_PROMPT_TEXT,
  COMPASS_AI_LOCKED_GUARDRAILS_TEXT,
  COMPASS_AI_OUTPUT_SCHEMA,
  COMPASS_AI_PROMPT_VERSION,
  fallbackCompassAiUnavailable,
  sanitizeCompassSnapshot,
  validateCompassAiAnalysis,
} from "../app/api/instagram-dashboard/compass/analyze/compass-ai-contract.ts";

const routeSource = readFileSync(new URL("../app/api/instagram-dashboard/compass/analyze/route.ts", import.meta.url), "utf8");
const groundingSnapshot = {
  period: "7d",
  credentials_blockers: [{
    account_id: "acct_1",
    username: "safe_user",
    client_id: "client_1",
    reason: "password_update_required",
  }],
  ct_quality_alerts: [{
    ct_id: "ct_1",
    target_username: "source_ct",
    summary: "Low-quality CT affects safe_user.",
  }],
  under_quota_accounts: [{
    account_id: "acct_1",
    username: "safe_user",
    client_id: "client_1",
  }],
};

function credentialRecommendation(overrides = {}) {
  return {
    id: "rec-1",
    severity: "critical",
    confidence: "high",
    title: "Open Credentials for safe_user",
    summary: "safe_user has a credential blocker from system facts.",
    recommendation_type: "credential_blocker",
    admin_summary: "safe_user needs secure access action.",
    client_summary: "Secure account access action is needed.",
    client_visible: true,
    client_recommendation_input: true,
    technical_reason: "credential blocker group",
    client_safe_reason: "Account access action required.",
    source_facts: ["credential_blockers", "account_dashboard_actions"],
    affected_accounts: [{
      account_id: "acct_1",
      username: "safe_user",
      client_id: "client_1",
      reason: "password_update_required",
      target_tab: "credentials",
    }],
    recommended_actions: [{
      label: "Open Credentials",
      target_tab: "credentials",
      filter: "credentials",
      action_type: "open_tab",
    }],
    evidence: [{
      source: "account_dashboard_actions",
      summary: "Open credential action exists for this account.",
      confidence: "high",
    }],
    target_tab: "credentials",
    recommended_action: "Review credential actions before restarting campaigns.",
    why_this_matters: "Blocked credentials prevent sessions from running correctly.",
    what_not_to_assume: "Do not assume the password is wrong unless the action says password_update_required.",
    ...overrides,
  };
}

function analysisWithRecommendations(recommendations) {
  return {
    analysis_id: "analysis-1",
    period: "7d",
    overall_summary: "Grounded Compass recommendations.",
    health_assessment: "risk",
    recommendations,
    internal_signals: [],
  };
}

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
  assert.equal(COMPASS_AI_PROMPT_VERSION, "v1");
  assert.match(COMPASS_AI_DEFAULT_PROMPT_TEXT, /Compass AI Advisor/);
  assert.match(COMPASS_AI_LOCKED_GUARDRAILS_TEXT, /Guardrails and validation cannot be disabled|No fact in input = no recommendation/);
  assert.ok(COMPASS_AI_OUTPUT_SCHEMA.recommendations[0].source_facts);
  assert.match(combined, /Use only the provided system facts/);
  assert.match(combined, /No fact in input = no recommendation/);
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
      summary: "safe_user has a credential blocker from system facts.",
      recommendation_type: "credential_blocker",
      admin_summary: "Two accounts need secure access action.",
      client_summary: "Secure account access action is needed.",
      client_visible: true,
      client_recommendation_input: true,
      technical_reason: "credential blocker group",
      client_safe_reason: "Account access action required.",
      source_facts: ["credential_blockers"],
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
      target_tab: "credentials",
      recommended_action: "Review credential actions before restarting campaigns.",
      why_this_matters: "Blocked credentials prevent sessions from running correctly.",
      what_not_to_assume: "Do not assume the password is wrong unless the action says password_update_required.",
    }],
    internal_signals: [{
      signal: "inactive_accounts",
      admin_visible: true,
      client_raw_visible: true,
      client_recommendation_input: false,
      count: 5,
      summary: "5 accounts have no recent work signal.",
    }],
  }, groundingSnapshot);

  assert.ok(analysis);
  assert.equal(analysis.health_assessment, "risk");
  assert.equal(analysis.recommendations[0].affected_accounts[0].target_tab, "credentials");
  assert.equal(analysis.recommendations[0].source_facts[0], "credential_blockers");
  assert.equal(analysis.internal_signals[0].client_raw_visible, false);
  assert.equal(analysis.internal_signals[0].client_recommendation_input, true);
});

test("rejects generic recommendation without evidence", () => {
  const analysis = validateCompassAiAnalysis(analysisWithRecommendations([
    credentialRecommendation({
      title: "Improve your growth strategy",
      summary: "Improve targeting to get better growth.",
      evidence: [],
    }),
  ]), groundingSnapshot);

  assert.ok(analysis);
  assert.equal(analysis.recommendations.length, 0);
  assert.equal(analysis.filtered_recommendations_count, 1);
  assert.match(analysis.filtered_reasons.join(","), /missing_evidence|generic_recommendation/);
});

test("rejects recommendation that references unknown account", () => {
  const analysis = validateCompassAiAnalysis(analysisWithRecommendations([
    credentialRecommendation({
      affected_accounts: [{
        account_id: "acct_unknown",
        username: "unknown_user",
        client_id: "client_unknown",
        reason: "password_update_required",
        target_tab: "credentials",
      }],
    }),
  ]), groundingSnapshot);

  assert.ok(analysis);
  assert.equal(analysis.recommendations.length, 0);
  assert.match(analysis.filtered_reasons.join(","), /unknown_account_reference/);
});

test("rejects recommendation with unsupported destructive action", () => {
  const analysis = validateCompassAiAnalysis(analysisWithRecommendations([
    credentialRecommendation({
      recommended_action: "Remove config automatically.",
      recommended_actions: [{
        label: "Remove config",
        target_tab: "credentials",
        filter: "credentials",
        action_type: "open_tab",
      }],
    }),
  ]), groundingSnapshot);

  assert.ok(analysis);
  assert.equal(analysis.recommendations.length, 0);
  assert.match(analysis.filtered_reasons.join(","), /destructive_action/);
});

test("rejects under-quota raw client visible recommendation", () => {
  const analysis = validateCompassAiAnalysis(analysisWithRecommendations([
    credentialRecommendation({
      id: "under-quota",
      recommendation_type: "quota_pacing_internal",
      title: "Review pacing for safe_user",
      summary: "safe_user is under quota according to internal pacing facts.",
      admin_summary: "safe_user is under quota according to internal pacing facts.",
      client_summary: "Your account is under quota.",
      client_visible: true,
      source_facts: ["quota_pacing"],
      recommended_action: "Open Profiles to review pacing.",
      recommended_actions: [{
        label: "Open Profiles",
        target_tab: "profiles",
        filter: "under_quota",
        action_type: "open_tab",
      }],
      target_tab: "profiles",
      evidence: [{
        source: "quota_pacing",
        summary: "Internal pacing fact exists for this account.",
        confidence: "high",
      }],
    }),
  ]), groundingSnapshot);

  assert.ok(analysis);
  assert.equal(analysis.recommendations.length, 0);
  assert.match(analysis.filtered_reasons.join(","), /client_alarm_text_not_allowed|internal_signal_marked_client_visible/);
});

test("accepts valid credential recommendation", () => {
  const analysis = validateCompassAiAnalysis(analysisWithRecommendations([
    credentialRecommendation(),
  ]), groundingSnapshot);

  assert.ok(analysis);
  assert.equal(analysis.recommendations.length, 1);
  assert.equal(analysis.filtered_recommendations_count, 0);
});

test("accepts valid CT quality recommendation", () => {
  const analysis = validateCompassAiAnalysis(analysisWithRecommendations([
    credentialRecommendation({
      id: "ct-quality",
      recommendation_type: "ct_quality",
      title: "Review low-quality CT source",
      summary: "System CT quality evidence marks source_ct for review.",
      admin_summary: "System CT quality evidence marks source_ct for review.",
      source_facts: ["ct_quality_alerts"],
      affected_accounts: [],
      recommended_action: "Suggest archive CT review.",
      recommended_actions: [{
        label: "Suggest archive CT review",
        target_tab: "targets",
        filter: "low_quality",
        action_type: "archive_ct_review",
      }],
      target_tab: "targets",
      evidence: [{
        source: "ct_quality_alerts",
        summary: "source_ct is present in CT quality alerts.",
        confidence: "high",
      }],
      why_this_matters: "Low-quality CT sources can reduce followable profile discovery.",
      what_not_to_assume: "Do not assume the CT should be archived without human review.",
    }),
  ]), groundingSnapshot);

  assert.ok(analysis);
  assert.equal(analysis.recommendations.length, 1);
  assert.equal(analysis.recommendations[0].recommendation_type, "ct_quality");
});

test("keeps valid recommendation and filters invalid recommendation", () => {
  const analysis = validateCompassAiAnalysis(analysisWithRecommendations([
    credentialRecommendation(),
    credentialRecommendation({ id: "generic", title: "Improve targeting", summary: "Improve targeting." }),
  ]), groundingSnapshot);

  assert.ok(analysis);
  assert.equal(analysis.recommendations.length, 1);
  assert.equal(analysis.filtered_recommendations_count, 1);
  assert.match(analysis.filtered_reasons.join(","), /generic_recommendation/);
});

test("no facts input returns no recommendations", () => {
  const analysis = validateCompassAiAnalysis(analysisWithRecommendations([
    credentialRecommendation(),
  ]), {});

  assert.ok(analysis);
  assert.equal(analysis.recommendations.length, 0);
  assert.equal(analysis.filtered_recommendations_count, 1);
  assert.match(analysis.filtered_reasons.join(","), /source_fact_not_in_snapshot|unknown_account_reference/);
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
