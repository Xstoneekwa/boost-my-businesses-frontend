import { ANALYTICS_ACCENT_TEXT } from "./AnalyticsSectionCard";

export type AnalyticsKpiTone = "neutral" | "good" | "warning" | "danger";

export type AnalyticsKpiCardProps = {
  label: string;
  value: string | number;
  detail?: string;
  trend?: string;
  tone?: AnalyticsKpiTone;
};

const toneColors: Record<AnalyticsKpiTone, string> = {
  neutral: "#93C5FD",
  good: "#34D399",
  warning: ANALYTICS_ACCENT_TEXT,
  danger: "#F87171",
};

export default function AnalyticsKpiCard({
  label,
  value,
  detail,
  trend,
  tone = "neutral",
}: AnalyticsKpiCardProps) {
  return (
    <article
      className="dashboard-summary-card"
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.025))",
        borderRadius: 18,
        padding: 18,
        minHeight: 150,
        boxShadow: "0 20px 70px rgba(0,0,0,0.18)",
      }}
    >
      <p
        style={{
          color: "rgba(255,255,255,0.42)",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 14,
        }}
      >
        {label}
      </p>
      <div className="mobile-card-row" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <p
          className="dashboard-kpi-value"
          style={{
            color: "#f0f0ef",
            fontFamily: "'Syne', sans-serif",
            fontSize: "2rem",
            lineHeight: 1,
            fontWeight: 800,
            letterSpacing: "-0.04em",
          }}
        >
          {value}
        </p>
        {trend && (
          <span
            className="dashboard-badge-pill"
            style={{
              color: toneColors[tone],
              background: "rgba(255,255,255,0.055)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 999,
              padding: "4px 8px",
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {trend}
          </span>
        )}
      </div>
      {detail && <p style={{ color: "rgba(255,255,255,0.40)", fontSize: 12.5, lineHeight: 1.55, marginTop: 12 }}>{detail}</p>}
    </article>
  );
}
