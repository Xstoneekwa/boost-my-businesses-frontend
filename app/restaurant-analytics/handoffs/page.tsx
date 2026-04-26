import AnalyticsKpiCard from "@/components/restaurant-analytics/AnalyticsKpiCard";
import AnalyticsSectionCard, { ANALYTICS_ACCENT_TEXT } from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { fetchScopedRows, formatAge, readDate, readNumber, readString } from "@/lib/restaurant-analytics/data";
import { enrichLocationNames } from "@/lib/restaurant-analytics/name-enrichment";
import { requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { getRestaurantServerCopy } from "@/lib/restaurant-language-server";
import { createSupabaseClient } from "@/lib/supabase";
import type { UserContext } from "@/lib/userContext";

export const dynamic = "force-dynamic";

type HandoffItem = {
  id: string;
  location: string;
  reason: string;
  priority: string;
  status: string;
  age: string;
};

type HandoffsDataResult =
  | { ok: true; handoffs: HandoffItem[]; stats: { open: number; resolvedToday: number; avgAssignment: string; highPriority: number }; userContext: UserContext }
  | { ok: false; error: string; userContext?: UserContext };

function normalizePriority(priority: string) {
  const normalized = priority.toLowerCase();
  if (normalized.includes("critical")) return "Critical";
  if (normalized.includes("high") || normalized.includes("urgent")) return "High";
  if (normalized.includes("low")) return "Low";
  return priority || "Medium";
}

function normalizeStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("resolved") || normalized.includes("closed") || normalized.includes("complete")) return "Resolved";
  if (normalized.includes("assign")) return "Assigned";
  if (normalized.includes("open") || normalized.includes("pending")) return "Open";
  return status || "Open";
}

function isResolvedToday(rowDate: Date | null, status: string) {
  if (status !== "Resolved" || !rowDate) return false;

  const now = new Date();
  return (
    rowDate.getUTCFullYear() === now.getUTCFullYear() &&
    rowDate.getUTCMonth() === now.getUTCMonth() &&
    rowDate.getUTCDate() === now.getUTCDate()
  );
}

function getAverageAssignmentLabel(rows: Record<string, unknown>[]) {
  const seconds = rows
    .map((row) => readNumber(row, ["assignment_seconds", "time_to_assignment_seconds", "assigned_after_seconds"], Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (!seconds.length) return "N/A";

  const averageSeconds = seconds.reduce((sum, value) => sum + value, 0) / seconds.length;
  const minutes = Math.max(1, Math.round(averageSeconds / 60));

  return `${minutes}m`;
}

async function getHandoffsData(): Promise<HandoffsDataResult> {
  try {
    const userContext = await requireDashboardUserContext();
    const supabase = createSupabaseClient();
    const rows = await fetchScopedRows({
      supabase,
      userContext,
      sources: ["analytics_handoffs", "restaurant_handoffs", "restaurant_call_handoffs", "handoffs"],
      limit: 50,
    });
    const enrichedRows = await enrichLocationNames(supabase, rows);

    const handoffs = enrichedRows.map((row, index) => {
      const status = normalizeStatus(readString(row, ["status", "handoff_status", "resolution_status"], "Open"));
      const priority = normalizePriority(readString(row, ["priority", "severity", "urgency"], "Medium"));

      return {
        id: readString(row, ["id", "handoff_id", "call_id"], `handoff_${index + 1}`),
        location: readString(row, ["location_name", "locationName", "location_display_name", "display_name", "name", "location_slug"], "Unknown location"),
        reason: readString(row, ["reason", "handoff_reason", "escalation_reason", "summary", "intent"], "Unspecified handoff"),
        priority,
        status,
        age: formatAge(row),
      };
    });

    const open = handoffs.filter((handoff) => handoff.status !== "Resolved").length;
    const resolvedToday = enrichedRows.filter((row) => isResolvedToday(readDate(row), normalizeStatus(readString(row, ["status", "handoff_status", "resolution_status"], "Open")))).length;
    const highPriority = handoffs.filter((handoff) => handoff.priority === "High" || handoff.priority === "Critical").length;

    return {
      ok: true,
      handoffs,
      stats: {
        open,
        resolvedToday,
        avgAssignment: getAverageAssignmentLabel(enrichedRows),
        highPriority,
      },
      userContext,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export default async function RestaurantAnalyticsHandoffsPage() {
  const result = await getHandoffsData();
  const { copy } = await getRestaurantServerCopy();
  const tenantCopy = result.userContext?.role === "tenant" ? copy.dashboard.handoffs : null;

  if (!result.ok) {
    return (
      <div style={{ maxWidth: 1220, margin: "0 auto" }}>
        <DashboardPageHeader
          eyebrow={tenantCopy?.eyebrow ?? "Human escalation"}
          title={tenantCopy?.title ?? "Handoffs"}
          description={tenantCopy?.description ?? "Track calls that required a human, including priority, reason, location, context quality, and resolution state."}
          badges={[tenantCopy?.operationsQueue ?? "Operations queue", tenantCopy ? copy.dashboard.error : "Error"]}
        />
        <ErrorState message={result.error} title={tenantCopy?.loadErrorTitle} eyebrow={tenantCopy ? copy.dashboard.supabaseError : undefined} />
      </div>
    );
  }

  return (
    <div className="dashboard-page" style={{ maxWidth: 1220, margin: "0 auto" }}>
      <DashboardPageHeader
        eyebrow={tenantCopy?.eyebrow ?? "Human escalation"}
        title={tenantCopy?.title ?? "Handoffs"}
        description={tenantCopy?.description ?? "Track calls that required a human, including priority, reason, location, context quality, and resolution state."}
        badges={[tenantCopy?.operationsQueue ?? "Operations queue", tenantCopy ? copy.dashboard.liveData : "Live data"]}
      />

      <section className="dashboard-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 18 }}>
        <AnalyticsKpiCard label={tenantCopy?.open ?? "Open Handoffs"} value={result.stats.open.toLocaleString()} trend="Queue" detail={tenantCopy?.openDetail ?? "Escalations waiting for team action."} tone="warning" />
        <AnalyticsKpiCard label={tenantCopy?.resolvedToday ?? "Resolved Today"} value={result.stats.resolvedToday.toLocaleString()} trend="Today" detail={tenantCopy?.resolvedDetail ?? "Handoffs closed by staff today."} tone="good" />
        <AnalyticsKpiCard label={tenantCopy?.avgAssignment ?? "Avg Assignment"} value={result.stats.avgAssignment} trend={tenantCopy ? copy.dashboard.liveData : "Live"} detail={tenantCopy?.avgDetail ?? "Average time before staff assignment."} tone="good" />
        <AnalyticsKpiCard label={tenantCopy?.highPriority ?? "High Priority"} value={result.stats.highPriority.toLocaleString()} trend="Review" detail={tenantCopy?.highDetail ?? "Sensitive requests needing faster attention."} tone="danger" />
      </section>

      <AnalyticsSectionCard title={tenantCopy?.queueTitle ?? "Handoff queue"} eyebrow={tenantCopy?.queueEyebrow ?? "Escalation list"} description={tenantCopy?.queueDescription ?? "Live escalation records from Supabase, scoped to the current dashboard role."}>
        {result.handoffs.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {result.handoffs.map((handoff) => (
              <div
                key={handoff.id}
                className="mobile-card-row"
                style={{ display: "grid", gridTemplateColumns: "1fr 0.8fr 0.5fr 0.5fr 60px", gap: 12, alignItems: "center", padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)" }}
              >
                <span style={{ color: "#f0f0ef", fontSize: 13, fontWeight: 800 }}>{handoff.reason}</span>
                <span style={{ color: "rgba(255,255,255,0.62)", fontSize: 13 }}>{handoff.location}</span>
                <span style={{ color: handoff.priority === "High" || handoff.priority === "Critical" ? "#F87171" : ANALYTICS_ACCENT_TEXT, fontSize: 13, fontWeight: 800 }}>{handoff.priority}</span>
                <span style={{ color: handoff.status === "Resolved" ? "#34D399" : ANALYTICS_ACCENT_TEXT, fontSize: 13, fontWeight: 800 }}>{handoff.status}</span>
                <span style={{ color: "rgba(255,255,255,0.46)", fontSize: 13, textAlign: "right" }}>{handoff.age}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={tenantCopy?.noHandoffsTitle ?? "No handoffs found"} text={tenantCopy?.noHandoffsText ?? "There are no human escalation records for the current dashboard scope."} />
        )}
      </AnalyticsSectionCard>
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
        {title ?? "Could not load handoffs."}
      </h2>
      <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.65 }}>{message}</p>
    </section>
  );
}
