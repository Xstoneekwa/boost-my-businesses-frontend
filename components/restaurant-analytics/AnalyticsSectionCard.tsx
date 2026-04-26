import type { ReactNode } from "react";

export const ANALYTICS_ACCENT = "#F59E0B";
export const ANALYTICS_ACCENT_TEXT = "#FBBF24";
export const ANALYTICS_ACCENT_DIM = "rgba(245,158,11,0.10)";
export const ANALYTICS_ACCENT_BORDER = "rgba(245,158,11,0.24)";

export type SectionTone = "default" | "accent";

export type AnalyticsSectionCardProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  action?: ReactNode;
  tone?: SectionTone;
  children: ReactNode;
};

export default function AnalyticsSectionCard({
  title,
  eyebrow,
  description,
  action,
  tone = "default",
  children,
}: AnalyticsSectionCardProps) {
  const isAccent = tone === "accent";

  return (
    <section
      className="dashboard-section-card"
      style={{
        border: isAccent ? `1px solid ${ANALYTICS_ACCENT_BORDER}` : "1px solid rgba(255,255,255,0.08)",
        background: isAccent ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.035)",
        borderRadius: 22,
        padding: 20,
        boxShadow: "0 22px 80px rgba(0,0,0,0.18)",
        minWidth: 0,
      }}
    >
      <div
        className="mobile-card-row"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div>
          {eyebrow && (
            <p
              style={{
                color: ANALYTICS_ACCENT_TEXT,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              {eyebrow}
            </p>
          )}
          <h2
            className="dashboard-card-title"
            style={{
              color: "#f0f0ef",
              fontFamily: "'Syne', sans-serif",
              fontSize: 20,
              marginBottom: description ? 6 : 0,
            }}
          >
            {title}
          </h2>
          {description && (
            <p style={{ color: "rgba(255,255,255,0.46)", fontSize: 13, lineHeight: 1.55 }}>
              {description}
            </p>
          )}
        </div>
        {action}
      </div>

      {children}
    </section>
  );
}
