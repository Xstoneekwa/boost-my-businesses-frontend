export type CompassAiPeriod = "24h" | "7d" | "30d";
export type CompassAiHealthAssessment = "good" | "watch" | "risk" | "critical";
export type CompassAiSeverity = "critical" | "warning" | "info" | "positive";
export type CompassAiConfidence = "high" | "medium" | "low";
export type CompassAiTargetTab = "credentials" | "devices" | "activity_log" | "targets" | "client_accounts" | "profiles" | "compass";
export type CompassAiActionType = "open_tab" | "open_account" | "open_problem_group" | "prepare_request" | "archive_ct_review";
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
  admin_summary: string;
  client_summary: string;
  client_visible: boolean;
  client_recommendation_input: boolean;
  technical_reason: string;
  client_safe_reason: string;
  affected_accounts: CompassAiAffectedAccount[];
  recommended_actions: CompassAiRecommendedAction[];
  evidence: CompassAiEvidence[];
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

export function buildCompassAiPrompt(snapshot: CompassAnalyzeSafeSnapshot) {
  return [
    {
      role: "system",
      content: [
        "You are Compass AI Advisor for an Instagram operations dashboard.",
        "Use only the provided facts. Do not invent facts, counts, causes, accounts, or evidence.",
        "AI cannot execute actions. Recommend operator actions only.",
        "Return strict JSON only, matching the requested schema.",
        "Do not include secrets or operational artifacts.",
        "Raw inactive, under-quota, no-work, and growth-down diagnostics must stay internal signals unless transformed into a broad client-safe opportunity.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        output_schema: {
          analysis_id: "string",
          period: "24h|7d|30d",
          overall_summary: "string",
          health_assessment: "good|watch|risk|critical",
          recommendations: "array",
          internal_signals: "array",
        },
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
  const adminSummary = clampText(value.admin_summary, "", 420);
  if (!title || !adminSummary) return null;
  return {
    id,
    severity: enumValue(value.severity, severities, "info"),
    confidence: enumValue(value.confidence, confidences, "medium"),
    title,
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

export function validateCompassAiAnalysis(value: unknown): CompassAiAnalysis | null {
  if (!isRecord(value)) return null;
  const recommendations = Array.isArray(value.recommendations)
    ? value.recommendations.map(normalizeRecommendation).filter((item): item is CompassAiRecommendation => Boolean(item)).slice(0, 12)
    : [];
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
  };
}
