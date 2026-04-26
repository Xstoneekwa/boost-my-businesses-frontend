import type { ReactNode } from "react";
import { ANALYTICS_ACCENT_BORDER, ANALYTICS_ACCENT_DIM, ANALYTICS_ACCENT_TEXT } from "./AnalyticsSectionCard";

export type DashboardPageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  badges?: string[];
  action?: ReactNode;
};

export default function DashboardPageHeader({
  eyebrow,
  title,
  description,
  badges = [],
  action,
}: DashboardPageHeaderProps) {
  return (
    <header
      className="dashboard-page"
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 24,
        marginBottom: 28,
        flexWrap: "wrap",
      }}
    >
      <div style={{ maxWidth: 760 }}>
        <p
          style={{
            color: ANALYTICS_ACCENT_TEXT,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          {eyebrow}
        </p>
        <h1
          className="dashboard-page-title"
          style={{
            color: "#f0f0ef",
            fontFamily: "'Syne', sans-serif",
            fontSize: "clamp(2rem, 4vw, 3.15rem)",
            lineHeight: 1.05,
            letterSpacing: "-0.04em",
            marginBottom: 12,
          }}
        >
          {title}
        </h1>
        <p className="dashboard-page-copy" style={{ color: "rgba(255,255,255,0.56)", fontSize: 15.5, lineHeight: 1.7 }}>
          {description}
        </p>
      </div>

      <div className="mobile-inline-actions dashboard-header-badges" style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {badges.map((badge) => (
          <span
            key={badge}
            className="dashboard-badge-pill"
            style={{
              border: badge.toLowerCase().includes("live") ? `1px solid ${ANALYTICS_ACCENT_BORDER}` : "1px solid rgba(255,255,255,0.08)",
              background: badge.toLowerCase().includes("live") ? ANALYTICS_ACCENT_DIM : "rgba(255,255,255,0.035)",
              color: badge.toLowerCase().includes("live") ? ANALYTICS_ACCENT_TEXT : "rgba(255,255,255,0.70)",
              borderRadius: 999,
              padding: "9px 13px",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {badge}
          </span>
        ))}
        {action}
      </div>
    </header>
  );
}
