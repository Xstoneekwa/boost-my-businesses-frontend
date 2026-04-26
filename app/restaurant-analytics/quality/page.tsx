import AnalyticsKpiCard from "@/components/restaurant-analytics/AnalyticsKpiCard";
import AnalyticsSectionCard, { ANALYTICS_ACCENT_BORDER, ANALYTICS_ACCENT_TEXT } from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import QualitySummaryCard, { type QualitySummaryMetric } from "@/components/restaurant-analytics/QualitySummaryCard";
import {
  averageRows,
  countByString,
  fetchScopedRows,
  formatInteger,
  formatPercent,
  percentOf,
  readBoolean,
  readString,
  sumRows,
} from "@/lib/restaurant-analytics/data";
import { requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { getRestaurantServerCopy } from "@/lib/restaurant-language-server";
import { createSupabaseClient } from "@/lib/supabase";
import type { UserContext } from "@/lib/userContext";

export const dynamic = "force-dynamic";

type QualityInsight = {
  label: string;
  value: string;
  detail: string;
};

type ReasonInsight = {
  reason: string;
  count: number;
  detail: string;
};

type QualityDataResult =
  | {
      ok: true;
      kpis: {
        reviewedCalls: number;
        passRate: number;
        needsTuning: number;
        criticalQa: number;
      };
      qualityMetrics: QualitySummaryMetric[];
      reviewItems: string[];
      escalationReasons: ReasonInsight[];
      missedOpportunities: QualityInsight[];
      frustratedSignals: QualityInsight[];
      followUpCalls: string[];
      hasAnyRows: boolean;
      userContext: UserContext;
    }
  | { ok: false; error: string; userContext?: UserContext };

function normalizeRate(value: number) {
  return value > 0 && value <= 1 ? value * 100 : value;
}

function firstAvailableRate(rows: Record<string, unknown>[], keys: string[]) {
  const average = averageRows(rows, keys);
  return normalizeRate(average);
}

function buildReviewItems(rows: Record<string, unknown>[]) {
  return rows
    .map((row) => readString(row, ["review_item", "next_action", "qa_note", "recommendation", "issue_summary", "summary"]))
    .filter(Boolean)
    .slice(0, 8);
}

function buildEscalationReasons(handoffRows: Record<string, unknown>[], qualityRows: Record<string, unknown>[]) {
  const grouped = countByString([...handoffRows, ...qualityRows], ["escalation_reason", "handoff_reason", "reason", "top_escalation_reason"]);

  return grouped.slice(0, 5).map((item) => ({
    reason: item.label,
    count: item.count,
    detail: "Calls with this reason required staff review, manager context, or safer routing.",
  }));
}

function buildMissedOpportunities(fallbackRows: Record<string, unknown>[], qualityRows: Record<string, unknown>[]): QualityInsight[] {
  const rows = [...fallbackRows, ...qualityRows];
  const groupedReasons = countByString(rows, ["fallback_reason", "missed_opportunity_reason", "reason"]);

  if (groupedReasons.length) {
    return groupedReasons.slice(0, 3).map((item) => ({
      label: item.label,
      value: formatInteger(item.count),
      detail: "Detected from fallback or missed-opportunity analytics.",
    }));
  }

  const noSlotReturned = sumRows(rows, ["no_slot_returned", "no_booking_slot_returned", "availability_failed"]);
  const abandoned = sumRows(rows, ["abandoned_before_confirmation", "abandoned_calls", "incomplete_booking_calls"]);
  const lowConfidence = sumRows(rows, ["low_confidence_routing", "low_confidence_calls"]);

  return [
    noSlotReturned
      ? { label: "No booking slot returned", value: formatInteger(noSlotReturned), detail: "Availability lookup failed or returned no bookable options." }
      : null,
    abandoned
      ? { label: "Abandoned before confirmation", value: formatInteger(abandoned), detail: "Guest dropped before the booking details were complete." }
      : null,
    lowConfidence
      ? { label: "Low confidence routing", value: formatInteger(lowConfidence), detail: "The assistant did not have enough certainty to complete the call safely." }
      : null,
  ].filter(Boolean) as QualityInsight[];
}

function buildFrustratedSignals(rows: Record<string, unknown>[]): QualityInsight[] {
  const negativeSentiment = sumRows(rows, ["negative_sentiment", "negative_sentiment_calls", "frustrated_customers"]);
  const repeatedCorrection = sumRows(rows, ["repeated_correction", "repeated_correction_calls"]);
  const urgentLanguage = sumRows(rows, ["urgent_language", "urgent_language_calls", "urgent_calls"]);

  return [
    negativeSentiment ? { label: "Negative sentiment", value: formatInteger(negativeSentiment), detail: "Calls flagged with negative guest sentiment." } : null,
    repeatedCorrection ? { label: "Repeated correction", value: formatInteger(repeatedCorrection), detail: "Calls where guests had to correct the assistant repeatedly." } : null,
    urgentLanguage ? { label: "Urgent language", value: formatInteger(urgentLanguage), detail: "Calls containing urgency, complaint, or time-sensitive language." } : null,
  ].filter(Boolean) as QualityInsight[];
}

function buildFollowUps(qualityRows: Record<string, unknown>[], handoffRows: Record<string, unknown>[]) {
  return [...qualityRows, ...handoffRows]
    .filter((row) => readBoolean(row, ["needs_follow_up", "follow_up_required", "requires_follow_up"], Boolean(readString(row, ["follow_up", "follow_up_action"]))))
    .map((row) => readString(row, ["follow_up", "follow_up_action", "next_action", "summary", "reason"], "Review this call with the restaurant team."))
    .slice(0, 8);
}

function localizeGeneratedText(text: string, lang: "fr" | "en") {
  if (lang !== "fr") return text;

  const translations: Record<string, string> = {
    "Measured from reviewed call quality analytics.": "Calculé à partir des appels revus par l'équipe qualité.",
    "Returning guests matched to known preferences or history.": "Clients reconnus avec préférences ou historique utile.",
    "Escalations containing summary, reason, and next action.": "Escalades contenant un résumé, une raison et une prochaine action.",
    "Eligible bookings receiving confirmation or reminder flow.": "Réservations éligibles recevant confirmation ou rappel.",
    "Calls with this reason required staff review, manager context, or safer routing.": "Appels ayant nécessité une revue équipe, un contexte manager ou une orientation plus prudente.",
    "Detected from fallback or missed-opportunity analytics.": "Détecté depuis les appels non finalisés ou les opportunités à revoir.",
    "Availability lookup failed or returned no bookable options.": "Aucun créneau réservable n'a pu être proposé.",
    "Guest dropped before the booking details were complete.": "Le client a quitté l'appel avant finalisation de la réservation.",
    "The assistant did not have enough certainty to complete the call safely.": "L'assistant n'avait pas assez de certitude pour finaliser la demande.",
    "Calls flagged with negative guest sentiment.": "Appels signalés avec un sentiment client négatif.",
    "Calls where guests had to correct the assistant repeatedly.": "Appels où le client a dû corriger plusieurs fois l'assistant.",
    "Calls containing urgency, complaint, or time-sensitive language.": "Appels contenant une urgence, une réclamation ou une demande sensible au temps.",
    "Review this call with the restaurant team.": "Revoir cet appel avec l'équipe du restaurant.",
    "No booking slot returned": "Aucun créneau proposé",
    "Abandoned before confirmation": "Abandon avant confirmation",
    "Low confidence routing": "Orientation incertaine",
    "Negative sentiment": "Sentiment négatif",
    "Repeated correction": "Corrections répétées",
    "Urgent language": "Langage urgent",
  };

  return translations[text] ?? text;
}

async function getQualityData(): Promise<QualityDataResult> {
  try {
    const userContext = await requireDashboardUserContext();
    const supabase = createSupabaseClient();

    const [qualityRows, fallbackRows, handoffRows] = await Promise.all([
      fetchScopedRows({
        supabase,
        userContext,
        sources: ["analytics_call_quality", "restaurant_call_quality", "call_quality", "restaurant_calls"],
      }),
      fetchScopedRows({
        supabase,
        userContext,
        sources: ["analytics_fallback_overview", "restaurant_fallbacks", "fallbacks"],
      }),
      fetchScopedRows({
        supabase,
        userContext,
        sources: ["analytics_handoffs", "restaurant_handoffs", "restaurant_call_handoffs", "handoffs"],
      }),
    ]);

    const reviewedCalls = sumRows(qualityRows, ["reviewed_calls", "total_reviewed", "total_calls"]) || qualityRows.length;
    const passedCalls = sumRows(qualityRows, ["passed_calls", "qa_passed", "pass_count"]);
    const passRate = firstAvailableRate(qualityRows, ["pass_rate", "qa_pass_rate", "quality_pass_rate"]) || percentOf(passedCalls, reviewedCalls);
    const needsTuning =
      sumRows(qualityRows, ["needs_tuning", "needs_tuning_calls", "tuning_queue", "tuning_items"]) ||
      qualityRows.filter((row) => readBoolean(row, ["needs_tuning", "requires_tuning"])).length;
    const criticalQa =
      sumRows(qualityRows, ["critical_qa", "critical_issues", "critical_count"]) ||
      qualityRows.filter((row) => readString(row, ["severity", "priority"]).toLowerCase().includes("critical")).length;

    return {
      ok: true,
      kpis: {
        reviewedCalls,
        passRate,
        needsTuning,
        criticalQa,
      },
      qualityMetrics: [
        {
          label: "Intent accuracy",
          value: formatPercent(firstAvailableRate(qualityRows, ["intent_accuracy", "intent_accuracy_rate"])),
          detail: "Measured from reviewed call quality analytics.",
        },
        {
          label: "Memory match rate",
          value: formatPercent(firstAvailableRate(qualityRows, ["memory_match_rate", "memory_match"])),
          detail: "Returning guests matched to known preferences or history.",
        },
        {
          label: "Handoff completeness",
          value: formatPercent(firstAvailableRate(qualityRows, ["handoff_completeness", "handoff_completeness_rate"])),
          detail: "Escalations containing summary, reason, and next action.",
        },
        {
          label: "Reminder coverage",
          value: formatPercent(firstAvailableRate(qualityRows, ["reminder_coverage", "reminder_coverage_rate"])),
          detail: "Eligible bookings receiving confirmation or reminder flow.",
        },
      ],
      reviewItems: buildReviewItems(qualityRows),
      escalationReasons: buildEscalationReasons(handoffRows, qualityRows),
      missedOpportunities: buildMissedOpportunities(fallbackRows, qualityRows),
      frustratedSignals: buildFrustratedSignals(qualityRows),
      followUpCalls: buildFollowUps(qualityRows, handoffRows),
      hasAnyRows: Boolean(qualityRows.length || fallbackRows.length || handoffRows.length),
      userContext,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export default async function RestaurantAnalyticsQualityPage() {
  const result = await getQualityData();
  const { copy, lang } = await getRestaurantServerCopy();
  const tenantCopy = result.userContext?.role === "tenant" ? copy.dashboard.quality : null;

  if (!result.ok) {
    return (
      <div style={{ maxWidth: 1220, margin: "0 auto" }}>
        <DashboardPageHeader
          eyebrow={tenantCopy?.eyebrow ?? "Quality assurance"}
          title={tenantCopy?.title ?? "Quality"}
          description={tenantCopy?.description ?? "Review assistant accuracy, memory usage, handoff completeness, fallback quality, and operational readiness."}
          badges={[tenantCopy?.qaQueue ?? "QA queue", tenantCopy ? copy.dashboard.error : "Error"]}
        />
        <ErrorState message={result.error} title={tenantCopy?.loadErrorTitle} eyebrow={tenantCopy ? copy.dashboard.supabaseError : undefined} />
      </div>
    );
  }

  return (
    <div className="dashboard-page" style={{ maxWidth: 1220, margin: "0 auto" }}>
      <DashboardPageHeader
        eyebrow={tenantCopy?.eyebrow ?? "Quality assurance"}
        title={tenantCopy?.title ?? "Quality"}
        description={tenantCopy?.description ?? "Review assistant accuracy, memory usage, handoff completeness, fallback quality, and operational readiness."}
        badges={[tenantCopy?.qaQueue ?? "QA queue", tenantCopy ? copy.dashboard.liveData : "Live data"]}
      />

      {!result.hasAnyRows && (
        <div style={{ marginBottom: 18 }}>
          <EmptyState title={tenantCopy?.noDataTitle ?? "No quality data found"} text={tenantCopy?.noDataText ?? "Supabase returned no quality, fallback, or handoff rows for the current dashboard scope."} />
        </div>
      )}

      <section className="dashboard-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 18 }}>
        <AnalyticsKpiCard label={tenantCopy?.reviewedCalls ?? "Reviewed Calls"} value={formatInteger(result.kpis.reviewedCalls)} trend={tenantCopy ? copy.dashboard.liveData : "Live"} detail={tenantCopy?.reviewedDetail ?? "Calls sampled for QA in the current period."} />
        <AnalyticsKpiCard label={tenantCopy?.passRate ?? "Pass Rate"} value={formatPercent(result.kpis.passRate)} trend={tenantCopy?.title ?? "Quality"} detail={tenantCopy?.passDetail ?? "Calls that met quality standards."} tone="good" />
        <AnalyticsKpiCard label={tenantCopy?.needsTuning ?? "Needs Tuning"} value={formatInteger(result.kpis.needsTuning)} trend="Queue" detail={tenantCopy?.needsTuningDetail ?? "Calls marked for prompt or routing improvement."} tone="warning" />
        <AnalyticsKpiCard label={tenantCopy?.criticalQa ?? "Critical QA"} value={formatInteger(result.kpis.criticalQa)} trend="Action" detail={tenantCopy?.criticalDetail ?? "Quality issues that need immediate review."} tone="danger" />
      </section>

      <section className="dashboard-two-col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18, marginBottom: 18 }}>
        <QualitySummaryCard
          metrics={
            tenantCopy
              ? result.qualityMetrics.map((metric) => ({
                  ...metric,
                  detail: localizeGeneratedText(metric.detail, lang),
                  label:
                    metric.label === "Intent accuracy"
                      ? tenantCopy.metrics.intentAccuracy
                      : metric.label === "Memory match rate"
                        ? tenantCopy.metrics.memoryMatch
                        : metric.label === "Handoff completeness"
                          ? tenantCopy.metrics.handoffCompleteness
                          : metric.label === "Reminder coverage"
                            ? tenantCopy.metrics.reminderCoverage
                            : metric.label,
                }))
              : result.qualityMetrics
          }
          title={tenantCopy?.summaryTitle}
          eyebrow={tenantCopy?.summaryEyebrow}
          description={tenantCopy?.summaryDescription}
        />

        <AnalyticsSectionCard title={tenantCopy?.reviewQueue ?? "Review queue"} eyebrow={tenantCopy?.nextActions ?? "Next actions"} description={tenantCopy?.reviewDescription ?? "QA notes, transcript reviews, and prompt tuning tasks from Supabase."}>
          {result.reviewItems.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {result.reviewItems.map((item) => (
                <div key={item} style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)", borderRadius: 14, padding: "12px 14px", color: "rgba(255,255,255,0.68)", fontSize: 13.5, lineHeight: 1.55 }}>
                  {item}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title={tenantCopy?.noReviewTitle ?? "No review actions"} text={tenantCopy?.noReviewText ?? "No QA review actions are available for the current scope."} />
          )}
        </AnalyticsSectionCard>
      </section>

      <section className="dashboard-two-col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18, marginBottom: 18 }}>
        <AnalyticsSectionCard
          title={tenantCopy?.topEscalation ?? "Top Escalation Reasons"}
          eyebrow={tenantCopy?.handoffDrivers ?? "Human handoff drivers"}
          description={tenantCopy?.escalationDescription ?? "Reasons calls leave automation and require restaurant staff or manager review."}
        >
          {result.escalationReasons.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {result.escalationReasons.map((item) => (
                <div key={item.reason} style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)", borderRadius: 14, padding: 14 }}>
                  <div className="dashboard-inline-stat" style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                    <p style={{ color: "#f0f0ef", fontSize: 14, fontWeight: 800 }}>{item.reason}</p>
                    <span style={{ color: ANALYTICS_ACCENT_TEXT, fontSize: 13, fontWeight: 900 }}>{item.count}</span>
                  </div>
                  <p style={{ color: "rgba(255,255,255,0.52)", fontSize: 13, lineHeight: 1.55 }}>{tenantCopy ? localizeGeneratedText(item.detail, lang) : item.detail}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title={tenantCopy?.noEscalationTitle ?? "No escalation reasons"} text={tenantCopy?.noEscalationText ?? "No handoff reason data exists for the current scope."} />
          )}
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          title={tenantCopy?.missedTitle ?? "Fallback / Missed Opportunities"}
          eyebrow={tenantCopy?.leakage ?? "Revenue leakage"}
          description={tenantCopy?.missedDescription ?? "Conversion risks caused by missing data, incomplete booking flows, or low-confidence automation."}
          tone="accent"
        >
          {result.missedOpportunities.length ? (
            <div className="dashboard-three-col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              {result.missedOpportunities.map((item) => (
                <div key={item.label} style={{ border: `1px solid ${ANALYTICS_ACCENT_BORDER}`, background: "rgba(7,17,31,0.42)", borderRadius: 14, padding: 14 }}>
                  <p style={{ color: "rgba(255,255,255,0.38)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                    {tenantCopy ? localizeGeneratedText(item.label, lang) : item.label}
                  </p>
                  <p style={{ color: ANALYTICS_ACCENT_TEXT, fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, marginBottom: 6 }}>
                    {item.value}
                  </p>
                  <p style={{ color: "rgba(255,255,255,0.54)", fontSize: 12.5, lineHeight: 1.55 }}>{tenantCopy ? localizeGeneratedText(item.detail, lang) : item.detail}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title={tenantCopy?.noFallbackTitle ?? "No fallback opportunities"} text={tenantCopy?.noFallbackText ?? "No fallback or missed-opportunity records exist for the current scope."} />
          )}
        </AnalyticsSectionCard>
      </section>

      <section className="dashboard-two-col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18 }}>
        <AnalyticsSectionCard
          title={tenantCopy?.frustratedTitle ?? "Frustrated Customers Detected"}
          eyebrow={tenantCopy?.sentiment ?? "Sentiment monitoring"}
          description={tenantCopy?.frustratedDescription ?? "Signals that should be reviewed before they become public feedback or lost repeat visits."}
        >
          {result.frustratedSignals.length ? (
            <div className="dashboard-three-col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
              {result.frustratedSignals.map((item) => (
                <div key={item.label} style={{ border: "1px solid rgba(248,113,113,0.22)", background: "rgba(248,113,113,0.075)", borderRadius: 14, padding: 14 }}>
                  <p style={{ color: "#FCA5A5", fontSize: 24, fontFamily: "'Syne', sans-serif", fontWeight: 800, marginBottom: 6 }}>{item.value}</p>
                  <p style={{ color: "rgba(255,255,255,0.64)", fontSize: 13, lineHeight: 1.45 }}>{tenantCopy ? localizeGeneratedText(item.label, lang) : item.label}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title={tenantCopy?.noFrustrationTitle ?? "No frustration signals"} text={tenantCopy?.noFrustrationText ?? "No negative sentiment or urgent-language records exist for the current scope."} />
          )}
        </AnalyticsSectionCard>

        <AnalyticsSectionCard
          title={tenantCopy?.followUpTitle ?? "Calls Needing Follow-up"}
          eyebrow={tenantCopy?.openLoop ?? "Open operational loop"}
          description={tenantCopy?.followUpDescription ?? "Calls that should move into staff workflow, CRM notes, manager review, or guest callback."}
        >
          {result.followUpCalls.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {result.followUpCalls.map((item) => (
                <div key={item} style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)", borderRadius: 14, padding: "12px 14px" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: ANALYTICS_ACCENT_TEXT, boxShadow: `0 0 10px ${ANALYTICS_ACCENT_TEXT}`, flexShrink: 0, marginTop: 6 }} />
                  <p style={{ color: "rgba(255,255,255,0.68)", fontSize: 13.5, lineHeight: 1.55 }}>{tenantCopy ? localizeGeneratedText(item, lang) : item}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title={tenantCopy?.noFollowUpTitle ?? "No follow-up calls"} text={tenantCopy?.noFollowUpText ?? "No follow-up actions are currently attached to calls in this scope."} />
          )}
        </AnalyticsSectionCard>
      </section>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)", borderRadius: 14, padding: 18 }}>
      <p style={{ color: "#f0f0ef", fontSize: 14, fontWeight: 800, marginBottom: 6 }}>{title}</p>
      <p style={{ color: "rgba(255,255,255,0.54)", fontSize: 13, lineHeight: 1.6 }}>{text}</p>
    </div>
  );
}

function ErrorState({ message, title, eyebrow }: { message: string; title?: string; eyebrow?: string }) {
  return (
    <section style={{ border: "1px solid rgba(248,113,113,0.28)", background: "rgba(248,113,113,0.08)", borderRadius: 22, padding: 22 }}>
      <p style={{ color: "#FCA5A5", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
        {eyebrow ?? "Supabase error"}
      </p>
      <h2 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 22, marginBottom: 8 }}>
        {title ?? "Could not load quality data."}
      </h2>
      <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.65 }}>{message}</p>
    </section>
  );
}
