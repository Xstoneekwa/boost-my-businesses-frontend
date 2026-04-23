import { ANALYTICS_ACCENT } from "./AnalyticsSectionCard";

export type AgentPerformanceRow = {
  agentId?: string;
  agentName: string;
  handledCalls: number;
  successRate: number;
  avgDuration: string;
  color?: string;
};

export type AgentPerformanceTableProps = {
  rows: AgentPerformanceRow[];
};

export default function AgentPerformanceTable({ rows }: AgentPerformanceTableProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((row) => {
        const color = row.color ?? ANALYTICS_ACCENT;

        return (
          <div
            key={row.agentId ?? row.agentName}
            style={{
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.025)",
              borderRadius: 14,
              padding: 14,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 9 }}>
              <div>
                <p style={{ color: "#f0f0ef", fontSize: 13.5, fontWeight: 800, marginBottom: 3 }}>{row.agentName}</p>
                <p style={{ color: "rgba(255,255,255,0.38)", fontSize: 12 }}>
                  {row.handledCalls.toLocaleString()} calls handled · {row.avgDuration} avg
                </p>
              </div>
              <span style={{ color, fontSize: 13, fontWeight: 800 }}>{row.successRate}%</span>
            </div>
            <div style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
              <div style={{ width: `${row.successRate}%`, height: "100%", borderRadius: 999, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
