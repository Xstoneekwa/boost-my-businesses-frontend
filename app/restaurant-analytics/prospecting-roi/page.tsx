import { redirect } from "next/navigation";
import AnalyticsKpiCard from "@/components/restaurant-analytics/AnalyticsKpiCard";
import AnalyticsSectionCard from "@/components/restaurant-analytics/AnalyticsSectionCard";
import DashboardPageHeader from "@/components/restaurant-analytics/DashboardPageHeader";
import { averageRows, formatInteger, readNumber, readString, sumRows } from "@/lib/restaurant-analytics/data";
import { canAccessTenantPages, requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { createSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type ProspectingRoiRow = {
  month?: unknown;
  total_calls?: unknown;
  completed_calls?: unknown;
  interested_leads?: unknown;
  total_variable_cost?: unknown;
  total_fixed_cost?: unknown;
  total_cost?: unknown;
  variable_cost_per_call?: unknown;
  full_cost_per_call?: unknown;
  cost_per_interested_lead?: unknown;
};

type ProspectingRoiDataResult =
  | { ok: true; rows: ProspectingRoiRow[]; kpis: ProspectingRoiKpis }
  | { ok: false; error: string };

type ProspectingRoiKpis = {
  totalCalls: number;
  completedCalls: number;
  interestedLeads: number;
  totalCost: number;
  costPerCall: number;
  costPerInterestedLead: number;
};

const tableColumns: Array<{ key: keyof ProspectingRoiRow; label: string; kind: "month" | "integer" | "cost" }> = [
  { key: "month", label: "Month", kind: "month" },
  { key: "total_calls", label: "Total Calls", kind: "integer" },
  { key: "completed_calls", label: "Completed Calls", kind: "integer" },
  { key: "interested_leads", label: "Interested Leads", kind: "integer" },
  { key: "total_variable_cost", label: "Variable Cost", kind: "cost" },
  { key: "total_fixed_cost", label: "Fixed Cost", kind: "cost" },
  { key: "total_cost", label: "Total Cost", kind: "cost" },
  { key: "variable_cost_per_call", label: "Variable Cost / Call", kind: "cost" },
  { key: "full_cost_per_call", label: "Full Cost / Call", kind: "cost" },
  { key: "cost_per_interested_lead", label: "Cost / Interested Lead", kind: "cost" },
];

function buildKpis(rows: ProspectingRoiRow[]): ProspectingRoiKpis {
  const totalCalls = sumRows(rows, ["total_calls"]);
  const completedCalls = sumRows(rows, ["completed_calls"]);
  const interestedLeads = sumRows(rows, ["interested_leads"]);
  const totalCost = sumRows(rows, ["total_cost"]);

  return {
    totalCalls,
    completedCalls,
    interestedLeads,
    totalCost,
    costPerCall: totalCalls ? totalCost / totalCalls : averageRows(rows, ["full_cost_per_call"]),
    costPerInterestedLead: interestedLeads ? totalCost / interestedLeads : averageRows(rows, ["cost_per_interested_lead"]),
  };
}

function formatCost(value: number) {
  return value.toLocaleString("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMonth(value: unknown) {
  const month = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  if (!month) return "—";

  const date = new Date(month);
  if (!Number.isFinite(date.getTime())) return month;

  return new Intl.DateTimeFormat("en", {
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatTableCell(row: ProspectingRoiRow, key: keyof ProspectingRoiRow, kind: "month" | "integer" | "cost") {
  if (kind === "month") return formatMonth(row[key]);

  const value = readNumber(row, [key], Number.NaN);
  if (!Number.isFinite(value)) return "—";

  return kind === "integer" ? formatInteger(value) : formatCost(value);
}

async function getProspectingRoiData(): Promise<ProspectingRoiDataResult> {
  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("prospecting_roi_dashboard")
      .select("*")
      .order("month", { ascending: false })
      .returns<ProspectingRoiRow[]>();

    if (error) throw new Error(error.message);

    const rows = data ?? [];
    return { ok: true, rows, kpis: buildKpis(rows) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export default async function RestaurantAnalyticsProspectingRoiPage() {
  const userContext = await requireDashboardUserContext();

  if (!canAccessTenantPages(userContext)) {
    redirect("/restaurant-analytics/overview");
  }

  const result = await getProspectingRoiData();

  return (
    <div className="dashboard-page" style={{ maxWidth: 1220, margin: "0 auto" }}>
      <DashboardPageHeader
        eyebrow="Internal prospecting"
        title="Prospecting ROI"
        description="Internal admin view for prospecting costs, call performance, and ROI."
        badges={["Private admin view", result.ok ? "Live data" : "Error"]}
      />

      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : result.rows.length ? (
        <>
          <section className="dashboard-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 18 }}>
            <AnalyticsKpiCard label="Total Calls" value={formatInteger(result.kpis.totalCalls)} trend="All months" detail="Total prospecting calls in the ROI view." />
            <AnalyticsKpiCard label="Completed Calls" value={formatInteger(result.kpis.completedCalls)} trend="Completed" detail="Calls marked completed across the period." tone="good" />
            <AnalyticsKpiCard label="Interested Leads" value={formatInteger(result.kpis.interestedLeads)} trend="Qualified" detail="Leads showing interest after prospecting." tone="good" />
            <AnalyticsKpiCard label="Total Cost" value={formatCost(result.kpis.totalCost)} trend="Spend" detail="Variable and fixed prospecting costs combined." tone="warning" />
            <AnalyticsKpiCard label="Cost / Call" value={formatCost(result.kpis.costPerCall)} trend="Blended" detail="Total cost divided by total calls." />
            <AnalyticsKpiCard label="Cost / Interested Lead" value={formatCost(result.kpis.costPerInterestedLead)} trend="ROI" detail="Total cost divided by interested leads." tone="warning" />
          </section>

          <AnalyticsSectionCard
            title="Monthly ROI table"
            eyebrow="Supabase view"
            description="All fields from public.prospecting_roi_dashboard."
          >
            <ProspectingRoiTable rows={result.rows} />
          </AnalyticsSectionCard>
        </>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function ProspectingRoiTable({ rows }: { rows: ProspectingRoiRow[] }) {
  return (
    <div className="mobile-table-scroll" style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 1120, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr repeat(9, minmax(96px, 0.8fr))", gap: 12, padding: "0 14px 4px" }}>
          {tableColumns.map((column, index) => (
            <span
              key={column.key}
              style={{
                color: "rgba(255,255,255,0.30)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                textAlign: index === 0 ? "left" : "right",
              }}
            >
              {column.label}
            </span>
          ))}
        </div>

        {rows.map((row, index) => (
          <div
            key={`${readString(row, ["month"], "month")}-${index}`}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr repeat(9, minmax(96px, 0.8fr))",
              gap: 12,
              alignItems: "center",
              padding: "12px 14px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.025)",
            }}
          >
            {tableColumns.map((column, columnIndex) => (
              <span
                key={column.key}
                style={{
                  color: columnIndex === 0 ? "#f0f0ef" : "rgba(255,255,255,0.62)",
                  fontSize: 13,
                  fontWeight: columnIndex === 0 ? 800 : 600,
                  textAlign: columnIndex === 0 ? "left" : "right",
                  whiteSpace: "nowrap",
                }}
              >
                {formatTableCell(row, column.key, column.kind)}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)", borderRadius: 14, padding: 18 }}>
      <p style={{ color: "#f0f0ef", fontSize: 14, fontWeight: 800, marginBottom: 6 }}>No prospecting ROI data yet.</p>
      <p style={{ color: "rgba(255,255,255,0.54)", fontSize: 13, lineHeight: 1.6 }}>Monthly prospecting cost and conversion rows will appear here once the Supabase view returns data.</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <section style={{ border: "1px solid rgba(248,113,113,0.28)", background: "rgba(248,113,113,0.08)", borderRadius: 22, padding: 22 }}>
      <p style={{ color: "#FCA5A5", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
        Supabase error
      </p>
      <h2 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: 22, marginBottom: 8 }}>
        Could not load Prospecting ROI.
      </h2>
      <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.65 }}>{message}</p>
    </section>
  );
}
