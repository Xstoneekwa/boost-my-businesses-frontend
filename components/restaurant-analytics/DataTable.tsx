import { RESTAURANT_ACCENT_TEXT } from "./DashboardCard";

type Column<T> = {
  key: keyof T;
  label: string;
  align?: "left" | "right";
  accent?: boolean;
};

export function DataTable<T extends Record<string, string>>({
  columns,
  rows,
}: {
  columns: Column<T>[];
  rows: T[];
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 560, display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `1.2fr repeat(${columns.length - 1}, minmax(90px, 0.65fr))`,
            gap: 12,
            padding: "0 14px 4px",
          }}
        >
          {columns.map((column) => (
            <span
              key={String(column.key)}
              style={{
                color: "rgba(255,255,255,0.30)",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                textAlign: column.align ?? "left",
              }}
            >
              {column.label}
            </span>
          ))}
        </div>

        {rows.map((row, index) => (
          <div
            key={index}
            style={{
              display: "grid",
              gridTemplateColumns: `1.2fr repeat(${columns.length - 1}, minmax(90px, 0.65fr))`,
              gap: 12,
              alignItems: "center",
              padding: "12px 14px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.025)",
            }}
          >
            {columns.map((column, columnIndex) => (
              <span
                key={String(column.key)}
                style={{
                  color: column.accent ? RESTAURANT_ACCENT_TEXT : columnIndex === 0 ? "#f0f0ef" : "rgba(255,255,255,0.62)",
                  fontWeight: column.accent || columnIndex === 0 ? 700 : 500,
                  fontSize: 13,
                  textAlign: column.align ?? "left",
                  whiteSpace: "nowrap",
                }}
              >
                {row[column.key]}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
