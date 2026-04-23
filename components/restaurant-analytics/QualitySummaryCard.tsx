import AnalyticsSectionCard from "./AnalyticsSectionCard";

export type QualitySummaryMetric = {
  label: string;
  value: string;
  detail: string;
};

export type QualitySummaryCardProps = {
  metrics: QualitySummaryMetric[];
  title?: string;
  eyebrow?: string;
  description?: string;
};

export default function QualitySummaryCard({ metrics, title = "Quality Summary", eyebrow = "QA review", description = "Operational quality checks from call scoring, transcript review, handoff completeness, and memory usage." }: QualitySummaryCardProps) {
  return (
    <AnalyticsSectionCard
      title={title}
      eyebrow={eyebrow}
      description={description}
      tone="accent"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {metrics.map((metric) => (
          <div
            key={metric.label}
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(7,17,31,0.45)",
              borderRadius: 16,
              padding: 14,
            }}
          >
            <p
              style={{
                color: "rgba(255,255,255,0.42)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 9,
              }}
            >
              {metric.label}
            </p>
            <p
              style={{
                color: "#f0f0ef",
                fontFamily: "'Syne', sans-serif",
                fontSize: 26,
                lineHeight: 1,
                fontWeight: 800,
                letterSpacing: "-0.035em",
                marginBottom: 9,
              }}
            >
              {metric.value}
            </p>
            <p style={{ color: "rgba(255,255,255,0.54)", fontSize: 12.5, lineHeight: 1.55 }}>{metric.detail}</p>
          </div>
        ))}
      </div>
    </AnalyticsSectionCard>
  );
}
