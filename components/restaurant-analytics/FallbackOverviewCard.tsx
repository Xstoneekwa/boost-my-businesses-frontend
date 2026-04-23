import AnalyticsSectionCard, { ANALYTICS_ACCENT_TEXT } from "./AnalyticsSectionCard";

export type FallbackOverviewItem = {
  reason: string;
  count: number;
  share: number;
  color?: string;
};

export type FallbackOverviewCardProps = {
  items: FallbackOverviewItem[];
};

export default function FallbackOverviewCard({ items }: FallbackOverviewCardProps) {
  return (
    <AnalyticsSectionCard
      title="Fallback Overview"
      eyebrow="Exception handling"
      description="Reasons the system could not confidently complete the call without backup logic."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        {items.map((item) => {
          const color = item.color ?? ANALYTICS_ACCENT_TEXT;

          return (
            <div key={item.reason}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 7 }}>
                <span style={{ color: "rgba(255,255,255,0.72)", fontSize: 13 }}>{item.reason}</span>
                <span style={{ color: "#f0f0ef", fontSize: 13, fontWeight: 700 }}>
                  {item.count} · {item.share}%
                </span>
              </div>
              <div style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${item.share}%`, borderRadius: 999, background: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </AnalyticsSectionCard>
  );
}
