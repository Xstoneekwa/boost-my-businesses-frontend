import { ANALYTICS_ACCENT_TEXT } from "./AnalyticsSectionCard";

export type CallsByTenantRow = {
  tenantId?: string;
  tenantName: string;
  totalCalls: number;
  completedCalls: number;
  escalations: number;
  autoHandledRate: number;
};

export type CallsByTenantTableProps = {
  rows: CallsByTenantRow[];
};

export default function CallsByTenantTable({ rows }: CallsByTenantTableProps) {
  return (
    <div className="mobile-table-scroll" style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 620, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.25fr repeat(4, minmax(92px, 0.65fr))", gap: 12, padding: "0 14px 4px" }}>
          {["Tenant", "Calls", "Completed", "Esc.", "Auto"].map((label, index) => (
            <span
              key={label}
              style={{
                color: "rgba(255,255,255,0.30)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                textAlign: index === 0 ? "left" : "right",
              }}
            >
              {label}
            </span>
          ))}
        </div>

        {rows.map((row) => (
          <div
            key={row.tenantId ?? row.tenantName}
            style={{
              display: "grid",
              gridTemplateColumns: "1.25fr repeat(4, minmax(92px, 0.65fr))",
              gap: 12,
              alignItems: "center",
              padding: "12px 14px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.025)",
            }}
          >
            <span style={{ color: "#f0f0ef", fontSize: 13, fontWeight: 700, whiteSpace: "normal" }}>{row.tenantName}</span>
            <span style={cellStyle}>{row.totalCalls.toLocaleString()}</span>
            <span style={cellStyle}>{row.completedCalls.toLocaleString()}</span>
            <span style={cellStyle}>{row.escalations.toLocaleString()}</span>
            <span style={{ ...cellStyle, color: ANALYTICS_ACCENT_TEXT, fontWeight: 800 }}>{row.autoHandledRate}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.62)",
  fontSize: 13,
  fontWeight: 500,
  textAlign: "right",
  whiteSpace: "nowrap",
};
