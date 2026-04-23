import type { ReactNode } from "react";

export const RESTAURANT_ACCENT = "#F59E0B";
export const RESTAURANT_ACCENT_TEXT = "#FBBF24";
export const RESTAURANT_ACCENT_DIM = "rgba(245,158,11,0.10)";
export const RESTAURANT_ACCENT_BORDER = "rgba(245,158,11,0.24)";

export function DashboardCard({
  title,
  eyebrow,
  description,
  action,
  children,
  accent = false,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <section
      style={{
        border: accent ? `1px solid ${RESTAURANT_ACCENT_BORDER}` : "1px solid rgba(255,255,255,0.08)",
        background: accent ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.035)",
        borderRadius: 22,
        padding: 20,
        boxShadow: "0 22px 80px rgba(0,0,0,0.18)",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
        <div>
          {eyebrow && (
            <p
              style={{
                color: RESTAURANT_ACCENT_TEXT,
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
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: "#f0f0ef", marginBottom: description ? 6 : 0 }}>
            {title}
          </h2>
          {description && <p style={{ color: "rgba(255,255,255,0.46)", fontSize: 13, lineHeight: 1.55 }}>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function KpiCard({
  label,
  value,
  detail,
  trend,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  trend: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneColor =
    tone === "good" ? "#34D399" : tone === "warn" ? RESTAURANT_ACCENT_TEXT : tone === "bad" ? "#F87171" : "#93C5FD";

  return (
    <article
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
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <p
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
        <span
          style={{
            color: toneColor,
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
      </div>
      <p style={{ color: "rgba(255,255,255,0.40)", fontSize: 12.5, lineHeight: 1.55, marginTop: 12 }}>{detail}</p>
    </article>
  );
}

export function ProgressRow({
  label,
  value,
  color = RESTAURANT_ACCENT,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 7 }}>
        <span style={{ color: "rgba(255,255,255,0.72)", fontSize: 13 }}>{label}</span>
        <span style={{ color: "#f0f0ef", fontSize: 13, fontWeight: 700 }}>{value}%</span>
      </div>
      <div style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${value}%`, borderRadius: 999, background: color }} />
      </div>
    </div>
  );
}

export function MiniBarChart({ values }: { values: number[] }) {
  return (
    <div
      style={{
        height: 240,
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.08)",
        background:
          "linear-gradient(180deg, rgba(245,158,11,0.08), rgba(255,255,255,0.02)), repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 56px)",
        display: "flex",
        alignItems: "end",
        gap: 10,
        padding: 18,
      }}
    >
      {values.map((height, index) => (
        <div
          key={`${height}-${index}`}
          style={{
            flex: 1,
            height: `${height}%`,
            borderRadius: "10px 10px 4px 4px",
            background: index > values.length / 2 ? RESTAURANT_ACCENT : "rgba(255,255,255,0.16)",
            opacity: index > values.length / 2 ? 0.95 : 0.8,
            minWidth: 10,
          }}
        />
      ))}
    </div>
  );
}

