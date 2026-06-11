export type CompassAiPeriod = "24h" | "7d" | "30d";
export type CompassAiHealthAssessment = "good" | "watch" | "risk" | "critical";
export type CompassAiSeverity = "critical" | "warning" | "info" | "positive";
export type CompassAiConfidence = "high" | "medium" | "low";
export type CompassAiTargetTab = "credentials" | "devices" | "activity_log" | "targets" | "client_accounts" | "profiles" | "compass";
export type CompassAiActionType = "open_tab" | "open_account" | "open_problem_group" | "prepare_request" | "archive_ct_review";
export type CompassAiRecommendationType =
  | "credential_blocker"
  | "device_blocker"
  | "ct_quality"
  | "activity_evidence"
  | "quota_pacing_internal"
  | "growth_trend_internal"
  | "package_entitlement"
  | "operational_risk";
export type CompassAiSourceFact =
  | "credential_blockers"
  | "account_dashboard_actions"
  | "login_actions"
  | "devices_status"
  | "compass_rules"
  | "activity_log_evidence"
  | "ct_quality_alerts"
  | "target_account_status"
  | "interaction_counters"
  | "quota_pacing"
  | "growth_trend"
  | "failed_interactions"
  | "account_status"
  | "package_entitlement"
  | "safe_run_evidence";
export type CompassAiSignal =
  | "inactive_accounts"
  | "under_quota"
  | "growth_down"
  | "credential_blocker"
  | "device_blocker"
  | "ct_quality";

export type CompassAiAffectedAccount = {
  account_id: string;
  username: string;
  client_id: string;
  reason: string;
  target_tab: CompassAiTargetTab;
};

export type CompassAiRecommendedAction = {
  label: string;
  target_tab: CompassAiTargetTab;
  filter: string;
  action_type: CompassAiActionType;
};

export type CompassAiEvidence = {
  source: string;
  summary: string;
  confidence: CompassAiConfidence;
};

export type CompassAiRecommendation = {
  id: string;
  severity: CompassAiSeverity;
  confidence: CompassAiConfidence;
  title: string;
  summary: string;
  recommendation_type: CompassAiRecommendationType;
  admin_summary: string;
  client_summary: string;
  client_visible: boolean;
  client_recommendation_input: boolean;
  technical_reason: string;
  client_safe_reason: string;
  affected_accounts: CompassAiAffectedAccount[];
  recommended_actions: CompassAiRecommendedAction[];
  evidence: CompassAiEvidence[];
  source_facts: CompassAiSourceFact[];
  target_tab: CompassAiTargetTab;
  recommended_action: string;
  why_this_matters: string;
  what_not_to_assume: string;
};

export type CompassAiInternalSignal = {
  signal: CompassAiSignal;
  admin_visible: true;
  client_raw_visible: false;
  client_recommendation_input: true;
  count: number;
  summary: string;
};

export type CompassAiAnalysis = {
  analysis_id: string;
  period: CompassAiPeriod;
  overall_summary: string;
  health_assessment: CompassAiHealthAssessment;
  recommendations: CompassAiRecommendation[];
  internal_signals: CompassAiInternalSignal[];
  filtered_recommendations_count: number;
  filtered_reasons: string[];
};

export type CompassAnalyzeSafeSnapshot = {
  period?: unknown;
  generated_at?: unknown;
  active_accounts_count?: unknown;
  blocked_groups?: unknown;
  under_quota_accounts?: unknown;
  inactive_accounts?: unknown;
  credentials_blockers?: unknown;
  device_blockers?: unknown;
  ct_quality_alerts?: unknown;
  growth_trend?: unknown;
  failed_interaction_evidence?: unknown;
  top_blockers?: unknown;
  target_tabs?: unknown;
  evidence_summaries?: unknown;
};

const periods = ["24h", "7d", "30d"] as const;
const healthAssessments = ["good", "watch", "risk", "critical"] as const;
const severities = ["critical", "warning", "info", "positive"] as const;
const confidences = ["high", "medium", "low"] as const;
const targetTabs = ["credentials", "devices", "activity_log", "targets", "client_accounts", "profiles", "compass"] as const;
const actionTypes = ["open_tab", "open_account", "open_problem_group", "prepare_request", "archive_ct_review"] as const;
const signals = ["inactive_accounts", "under_quota", "growth_down", "credential_blocker", "device_blocker", "ct_quality"] as const;
const recommendationTypes = [
  "credential_blocker",
  "device_blocker",
  "ct_quality",
  "activity_evidence",
  "quota_pacing_internal",
  "growth_trend_internal",
  "package_entitlement",
  "operational_risk",
] as const;
const sourceFacts = [
  "credential_blockers",
  "account_dashboard_actions",
  "login_actions",
  "devices_status",
  "compass_rules",
  "activity_log_evidence",
  "ct_quality_alerts",
  "target_account_status",
  "interaction_counters",
  "quota_pacing",
  "growth_trend",
  "failed_interactions",
  "account_status",
  "package_entitlement",
  "safe_run_evidence",
] as const;
const internalRecommendationTypes = new Set<CompassAiRecommendationType>([
  "quota_pacing_internal",
  "growth_trend_internal",
  "operational_risk",
]);
const accountRequiredTypes = new Set<CompassAiRecommendationType>([
  "credential_blocker",
  "device_blocker",
  "activity_evidence",
  "quota_pacing_internal",
  "growth_trend_internal",
]);
const genericRecommendationPatterns = [
  /improve (your )?growth strategy/i,
  /optimi[sz]e (your )?campaign/i,
  /review performance/i,
  /increase engagement/i,
  /post better content/i,
  /improve targeting/i,
  /try new audiences/i,
  /grow your account faster/i,
];
const destructiveActionPatterns = [
  /\b(remove|delete|revoke|rotate|disable|stop|cancel)\b/i,
  /\barchive\b/i,
];
const clientAlarmPatterns = [
  /\b(no work|under quota|queue stuck|worker error|failed run|offline for|growth down|not active for)\b/i,
];
const forbiddenTextTerms = [
  "pass" + "word",
  "credential_value",
  "secret",
  "tok" + "en",
  "authoriza" + "tion",
  "bear" + "er",
  ["service", "role"].join("_"),
  ["raw", "xml"].join("_"),
  "xml hierarchy",
  "screenshot",
  "payload",
  "verification_code",
  "2fa code",
  "adb",
  "serial",
  "udid",
  "vault",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clampText(value: unknown, fallback = "", max = 420) {
  return readString(value, fallback).slice(0, max);
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  const normalized = readString(value, "").toLowerCase();
  return allowed.includes(normalized) ? normalized as T[number] : fallback;
}

function containsForbiddenText(value: string) {
  const normalized = value.toLowerCase();
  return forbiddenTextTerms.some((term) => normalized.includes(term));
}

function normalizedText(value: unknown) {
  return readString(value, "").trim().toLowerCase();
}

function addKnownFact(facts: Set<CompassAiSourceFact>, value: string) {
  const normalized = value.toLowerCase();
  if (/credential|2fa|checkpoint|login|password|account_dashboard_action/.test(normalized)) {
    facts.add("credential_blockers");
    facts.add("account_dashboard_actions");
    facts.add("login_actions");
  }
  if (/device|phone|gateway|offline|unavailable/.test(normalized)) facts.add("devices_status");
  if (/ct|target|quality|source_profile|blue_badge|broken_link|archived/.test(normalized)) facts.add("ct_quality_alerts");
  if (/activity|proof|interaction|follow|like|dm|mute|unfollow/.test(normalized)) {
    facts.add("activity_log_evidence");
    facts.add("interaction_counters");
  }
  if (/under_quota|quota|pacing|day_limit|no_work|rest/.test(normalized)) facts.add("quota_pacing");
  if (/growth|trend|gain|flat/.test(normalized)) facts.add("growth_trend");
  if (/failed|failure|error|retry/.test(normalized)) {
    facts.add("failed_interactions");
    facts.add("safe_run_evidence");
  }
  if (/account_status|blocked|working|start_ready|valid|invalid/.test(normalized)) facts.add("account_status");
  if (/package|entitlement|plan|feature/.test(normalized)) facts.add("package_entitlement");
  if (/compass|insight|recommendation|rule/.test(normalized)) facts.add("compass_rules");
  if (/target_account_status/.test(normalized)) facts.add("target_account_status");
}

function collectGroundingContext(snapshot: unknown) {
  const facts = new Set<CompassAiSourceFact>();
  const accounts = new Set<string>();
  const ctRefs = new Set<string>();

  const walk = (value: unknown, parentKey = "", depth = 0) => {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = normalizedText(value);
      if (!text) return;
      addKnownFact(facts, `${parentKey}:${text}`);
      if (/^(username|account_username|account_id|accountid|client_id|clientid|id)$/.test(parentKey)) accounts.add(text.replace(/^@+/, ""));
      if (/^(ct|ct_id|ct_username|source_profile|source_profile_username|target_username|target_id)$/.test(parentKey)) ctRefs.add(text.replace(/^@+/, ""));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, parentKey, depth + 1));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, raw] of Object.entries(value)) {
      const safeKey = key.toLowerCase();
      addKnownFact(facts, safeKey);
      walk(raw, safeKey, depth + 1);
    }
  };

  walk(snapshot);
  return { facts, accounts, ctRefs };
}

export function sanitizeCompassSnapshot(value: unknown): CompassAnalyzeSafeSnapshot {
  const redact = (input: unknown, depth = 0): unknown => {
    if (depth > 7) return null;
    if (typeof input === "string") {
      const trimmed = input.trim();
      return containsForbiddenText(trimmed) ? "[redacted]" : trimmed.slice(0, 420);
    }
    if (typeof input === "number" || typeof input === "boolean" || input === null) return input;
    if (Array.isArray(input)) return input.slice(0, 80).map((item) => redact(item, depth + 1));
    if (!isRecord(input)) return null;

    const safe: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(input)) {
      if (containsForbiddenText(key)) continue;
      safe[key] = redact(raw, depth + 1);
    }
    return safe;
  };

  const record = isRecord(value) ? value : {};
  return redact(record) as CompassAnalyzeSafeSnapshot;
}

export const COMPASS_AI_PROMPT_VERSION = "v1";

export const COMPASS_AI_DEFAULT_PROMPT_TEXT = [
  "You are Compass AI Advisor for an Instagram operations dashboard.",
  "Recommend operator actions that improve Phone Farm reliability, account readiness, CT quality, and safe growth operations.",
  "Prioritize critical blockers first, then operational risks, then quality/pacing opportunities.",
].join(" ");

export const COMPASS_AI_LOCKED_GUARDRAILS_TEXT = [
  "Absolute rule: No fact in input = no recommendation.",
  "Use only the provided system facts. Do not invent facts, counts, causes, actions, accounts, CTs, devices, trends, blockers, metrics, or evidence.",
  "If evidence is insufficient, return no recommendation or state insufficient_evidence in the summary.",
  "AI cannot execute actions. Recommend operator actions only.",
  "Never recommend destructive actions. Destructive actions require separate human confirmation outside AI.",
  "Do not include secrets or operational artifacts.",
  "Every recommendation must include source_facts, affected_accounts, evidence, confidence, target_tab, recommended_action, why_this_matters, and what_not_to_assume.",
  "Use snake_case keys exactly as shown. Do not use camelCase keys.",
  "Raw inactive, under-quota, no-work, and growth-down diagnostics must stay internal signals unless transformed into a broad client-safe opportunity.",
  "Allowed recommendation_type values only: credential_blocker, device_blocker, ct_quality, activity_evidence, quota_pacing_internal, growth_trend_internal, package_entitlement, operational_risk.",
  "Reject generic advice such as improve growth strategy, optimize campaign, review performance, increase engagement, post better content, improve targeting, try new audiences, or grow faster unless directly grounded in a provided system fact.",
].join(" ");

export const COMPASS_AI_OUTPUT_SCHEMA = {
  analysis_id: "string",
  period: "24h|7d|30d",
  overall_summary: "string",
  health_assessment: "good|watch|risk|critical",
  recommendations: [{
    id: "string",
    severity: "critical|warning|info|positive",
    confidence: "high|medium|low",
    title: "string",
    summary: "string",
    recommendation_type: "credential_blocker|device_blocker|ct_quality|activity_evidence|quota_pacing_internal|growth_trend_internal|package_entitlement|operational_risk",
    admin_summary: "string",
    client_summary: "string",
    client_visible: "boolean",
    client_recommendation_input: "boolean",
    technical_reason: "string",
    client_safe_reason: "string",
    source_facts: ["credential_blockers|account_dashboard_actions|login_actions|devices_status|compass_rules|activity_log_evidence|ct_quality_alerts|target_account_status|interaction_counters|quota_pacing|growth_trend|failed_interactions|account_status|package_entitlement|safe_run_evidence"],
    affected_accounts: [{
      account_id: "string",
      username: "string",
      client_id: "string",
      reason: "string",
      target_tab: "credentials|devices|activity_log|targets|client_accounts|profiles|compass",
    }],
    recommended_actions: [{
      label: "string",
      target_tab: "credentials|devices|activity_log|targets|client_accounts|profiles|compass",
      filter: "string",
      action_type: "open_tab|open_account|open_problem_group|prepare_request|archive_ct_review",
    }],
    evidence: [{
      source: "string",
      summary: "string",
      confidence: "high|medium|low",
    }],
    target_tab: "credentials|devices|activity_log|targets|client_accounts|profiles|compass",
    recommended_action: "Open Credentials|Open Devices|Open Activity Log|Open Targets|Open Profiles|Open Client Accounts|Prepare review|Suggest archive CT review|Suggest password request|Suggest device check",
    why_this_matters: "string tied to source_facts",
    what_not_to_assume: "string explaining limits; never invent missing causes",
  }],
  internal_signals: [{
    signal: "inactive_accounts|under_quota|growth_down|credential_blocker|device_blocker|ct_quality",
    admin_visible: true,
    client_raw_visible: false,
    client_recommendation_input: true,
    count: "number",
    summary: "string",
  }],
} as const;

export function buildCompassAiPrompt(snapshot: CompassAnalyzeSafeSnapshot) {
  return [
    {
      role: "system",
      content: [
        COMPASS_AI_DEFAULT_PROMPT_TEXT,
        COMPASS_AI_LOCKED_GUARDRAILS_TEXT,
        "Return strict JSON only, matching the requested schema exactly.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        prompt_version: COMPASS_AI_PROMPT_VERSION,
        output_schema: COMPASS_AI_OUTPUT_SCHEMA,
        safe_snapshot: snapshot,
      }),
    },
  ];
}

function normalizeAffectedAccount(value: unknown): CompassAiAffectedAccount | null {
  if (!isRecord(value)) return null;
  const accountId = clampText(value.account_id, "", 120);
  const username = clampText(value.username, "", 120).replace(/^@+/, "");
  const clientId = clampText(value.client_id, "", 120);
  const reason = clampText(value.reason, "", 240);
  const targetTab = enumValue(value.target_tab, targetTabs, "compass");
  if (!accountId || !username) return null;
  return { account_id: accountId, username, client_id: clientId, reason, target_tab: targetTab };
}

function normalizeRecommendedAction(value: unknown): CompassAiRecommendedAction | null {
  if (!isRecord(value)) return null;
  const label = clampText(value.label, "", 120);
  const targetTab = enumValue(value.target_tab, targetTabs, "compass");
  const filter = clampText(value.filter, "", 80);
  const actionType = enumValue(value.action_type, actionTypes, "open_tab");
  if (!label) return null;
  return { label, target_tab: targetTab, filter, action_type: actionType };
}

function normalizeEvidence(value: unknown): CompassAiEvidence | null {
  if (!isRecord(value)) return null;
  const source = clampText(value.source, "", 120);
  const summary = clampText(value.summary, "", 260);
  const confidence = enumValue(value.confidence, confidences, "medium");
  if (!source || !summary) return null;
  return { source, summary, confidence };
}

function normalizeRecommendation(value: unknown, index: number): CompassAiRecommendation | null {
  if (!isRecord(value)) return null;
  const id = clampText(value.id, `ai_rec_${index + 1}`, 120) || `ai_rec_${index + 1}`;
  const title = clampText(value.title, "", 140);
  const summary = clampText(value.summary, readString(value.admin_summary), 420);
  const adminSummary = clampText(value.admin_summary, summary, 420);
  if (!title || !adminSummary) return null;
  const targetTab = enumValue(value.target_tab, targetTabs, "compass");
  const recommendedAction = clampText(value.recommended_action, "", 180);
  return {
    id,
    severity: enumValue(value.severity, severities, "info"),
    confidence: enumValue(value.confidence, confidences, "medium"),
    title,
    summary: summary || adminSummary,
    recommendation_type: enumValue(value.recommendation_type, recommendationTypes, "operational_risk"),
    admin_summary: adminSummary,
    client_summary: clampText(value.client_summary, "", 260),
    client_visible: readBoolean(value.client_visible, false),
    client_recommendation_input: readBoolean(value.client_recommendation_input, true),
    technical_reason: clampText(value.technical_reason, "", 260),
    client_safe_reason: clampText(value.client_safe_reason, "", 260),
    affected_accounts: Array.isArray(value.affected_accounts)
      ? value.affected_accounts.map(normalizeAffectedAccount).filter((item): item is CompassAiAffectedAccount => Boolean(item)).slice(0, 30)
      : [],
    recommended_actions: Array.isArray(value.recommended_actions)
      ? value.recommended_actions.map(normalizeRecommendedAction).filter((item): item is CompassAiRecommendedAction => Boolean(item)).slice(0, 8)
      : [],
    evidence: Array.isArray(value.evidence)
      ? value.evidence.map(normalizeEvidence).filter((item): item is CompassAiEvidence => Boolean(item)).slice(0, 12)
      : [],
    source_facts: Array.isArray(value.source_facts)
      ? value.source_facts.map((item) => enumValue(item, sourceFacts, "" as CompassAiSourceFact)).filter(Boolean).slice(0, 8)
      : [],
    target_tab: targetTab,
    recommended_action: recommendedAction,
    why_this_matters: clampText(value.why_this_matters, "", 260),
    what_not_to_assume: clampText(value.what_not_to_assume, "", 260),
  };
}

function normalizeInternalSignal(value: unknown): CompassAiInternalSignal | null {
  if (!isRecord(value)) return null;
  const signal = enumValue(value.signal, signals, "inactive_accounts");
  const summary = clampText(value.summary, "", 260);
  if (!summary) return null;
  return {
    signal,
    admin_visible: true,
    client_raw_visible: false,
    client_recommendation_input: true,
    count: Math.max(0, Math.trunc(readNumber(value.count, 0))),
    summary,
  };
}

function containsGenericAdvice(recommendation: CompassAiRecommendation) {
  const text = [
    recommendation.title,
    recommendation.summary,
    recommendation.admin_summary,
    recommendation.client_summary,
    recommendation.recommended_action,
    recommendation.why_this_matters,
  ].join(" ");
  return genericRecommendationPatterns.some((pattern) => pattern.test(text));
}

function containsClientAlarmText(recommendation: CompassAiRecommendation) {
  if (!recommendation.client_visible) return false;
  const text = [recommendation.client_summary, recommendation.client_safe_reason].join(" ");
  return clientAlarmPatterns.some((pattern) => pattern.test(text));
}

function containsDestructiveAction(recommendation: CompassAiRecommendation) {
  const actionText = [
    recommendation.recommended_action,
    ...recommendation.recommended_actions.map((action) => action.label),
  ].join(" ");
  if (!destructiveActionPatterns.some((pattern) => pattern.test(actionText))) return false;
  return !(recommendation.recommendation_type === "ct_quality" && /suggest archive ct review/i.test(actionText));
}

function actionIsSupported(action: CompassAiRecommendedAction) {
  if (!action.label) return false;
  if (!targetTabs.includes(action.target_tab)) return false;
  if (!actionTypes.includes(action.action_type)) return false;
  if (containsForbiddenText(action.label)) return false;
  return true;
}

function recommendationTextInventsMetric(recommendation: CompassAiRecommendation, contextFacts: Set<CompassAiSourceFact>) {
  const text = [
    recommendation.title,
    recommendation.summary,
    recommendation.admin_summary,
    recommendation.technical_reason,
    recommendation.why_this_matters,
  ].join(" ");
  const hasNumber = /\b\d+(\.\d+)?%?\b/.test(text);
  const hasMetricFact = recommendation.source_facts.some((fact) => contextFacts.has(fact));
  return hasNumber && !hasMetricFact;
}

function validateRecommendationGrounding(
  recommendation: CompassAiRecommendation,
  context: ReturnType<typeof collectGroundingContext>,
) {
  if (!recommendation.source_facts.length) return "missing_source_facts";
  if (!recommendation.source_facts.some((fact) => context.facts.has(fact))) return "source_fact_not_in_snapshot";
  if (!recommendation.evidence.length) return "missing_evidence";
  if (accountRequiredTypes.has(recommendation.recommendation_type) && !recommendation.affected_accounts.length) return "missing_affected_accounts";
  if (context.accounts.size > 0) {
    const unknownAccount = recommendation.affected_accounts.find((account) => {
      const accountId = normalizedText(account.account_id);
      const username = normalizedText(account.username).replace(/^@+/, "");
      const clientId = normalizedText(account.client_id);
      return !context.accounts.has(accountId) && !context.accounts.has(username) && (!clientId || !context.accounts.has(clientId));
    });
    if (unknownAccount) return "unknown_account_reference";
  } else if (recommendation.affected_accounts.length) {
    return "unknown_account_reference";
  }
  if (recommendation.recommendation_type === "ct_quality" && context.ctRefs.size === 0 && !recommendation.evidence.some((item) => /ct|target|source/i.test(item.source))) {
    return "unknown_ct_reference";
  }
  if (!recommendation.recommended_actions.length && !recommendation.recommended_action) return "missing_recommended_action";
  if (recommendation.recommended_actions.some((action) => !actionIsSupported(action))) return "unsupported_action";
  if (containsDestructiveAction(recommendation)) return "destructive_action_requires_human_confirmation";
  if (containsGenericAdvice(recommendation)) return "generic_recommendation_without_specific_fact";
  if (containsClientAlarmText(recommendation)) return "client_alarm_text_not_allowed";
  if (internalRecommendationTypes.has(recommendation.recommendation_type) && recommendation.client_visible) return "internal_signal_marked_client_visible";
  if (recommendationTextInventsMetric(recommendation, context.facts)) return "invented_metric";
  return null;
}

export function validateCompassAiAnalysis(value: unknown, snapshot?: unknown): CompassAiAnalysis | null {
  if (!isRecord(value)) return null;
  const context = collectGroundingContext(snapshot);
  const rawRecommendations = Array.isArray(value.recommendations)
    ? value.recommendations.map(normalizeRecommendation).filter((item): item is CompassAiRecommendation => Boolean(item)).slice(0, 12)
    : [];
  const filteredReasons: string[] = [];
  const recommendations = rawRecommendations.filter((recommendation) => {
    const reason = validateRecommendationGrounding(recommendation, context);
    if (reason) {
      filteredReasons.push(reason);
      return false;
    }
    return true;
  });
  const internalSignals = Array.isArray(value.internal_signals)
    ? value.internal_signals.map(normalizeInternalSignal).filter((item): item is CompassAiInternalSignal => Boolean(item)).slice(0, 12)
    : [];
  const summary = clampText(value.overall_summary, "", 520);
  if (!summary) return null;
  return {
    analysis_id: clampText(value.analysis_id, `compass_${Date.now().toString(36)}`, 120),
    period: enumValue(value.period, periods, "7d"),
    overall_summary: summary,
    health_assessment: enumValue(value.health_assessment, healthAssessments, "watch"),
    recommendations,
    internal_signals: internalSignals,
    filtered_recommendations_count: rawRecommendations.length - recommendations.length,
    filtered_reasons: Array.from(new Set(filteredReasons)).slice(0, 12),
  };
}

export function fallbackCompassAiUnavailable(period: CompassAiPeriod, reason: string): CompassAiAnalysis {
  return {
    analysis_id: `compass_rules_${Date.now().toString(36)}`,
    period,
    overall_summary: reason,
    health_assessment: "watch",
    recommendations: [],
    internal_signals: [],
    filtered_recommendations_count: 0,
    filtered_reasons: [],
  };
}
