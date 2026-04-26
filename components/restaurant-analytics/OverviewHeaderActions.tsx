"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useState } from "react";
import {
  ANALYTICS_ACCENT_BORDER,
  ANALYTICS_ACCENT_DIM,
  ANALYTICS_ACCENT_TEXT,
} from "@/components/restaurant-analytics/AnalyticsSectionCard";
import { useRestaurantLanguage } from "@/components/restaurant-language/RestaurantLanguageToggle";
import { restaurantCommonCopy } from "@/lib/restaurant-language";
import type { UserRole } from "@/lib/userContext";

type OverviewHeaderActionsProps = {
  role: UserRole;
  status: string;
  dateRangeKey: string;
  dateRangeLabel: string;
};

const basePill: CSSProperties = {
  borderRadius: 999,
  padding: "9px 13px",
  fontSize: 12,
  fontWeight: 700,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 36,
  transition: "border-color 160ms, background 160ms, color 160ms, transform 160ms",
};

const passivePill: CSSProperties = {
  ...basePill,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.035)",
  color: "rgba(255,255,255,0.70)",
};

const activePill: CSSProperties = {
  ...basePill,
  border: `1px solid ${ANALYTICS_ACCENT_BORDER}`,
  background: ANALYTICS_ACCENT_DIM,
  color: ANALYTICS_ACCENT_TEXT,
};

const hoverPill: CSSProperties = {
  borderColor: ANALYTICS_ACCENT_BORDER,
  background: "rgba(245,158,11,0.14)",
  color: ANALYTICS_ACCENT_TEXT,
  transform: "translateY(-1px)",
};

export default function OverviewHeaderActions({
  role,
  status,
  dateRangeKey,
  dateRangeLabel,
}: OverviewHeaderActionsProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [lang] = useRestaurantLanguage();
  const tenantCopy = restaurantCommonCopy[lang].dashboard;
  const isTenant = role === "tenant";
  const modeLabel = isTenant ? tenantCopy.mode : "Superadmin Mode";
  const visibleDateRangeLabel = isTenant && dateRangeKey === "30d" ? tenantCopy.last30Days : dateRangeLabel;
  const visibleStatus = isTenant && status === "Live data" ? tenantCopy.liveData : isTenant && status === "Error" ? tenantCopy.error : status;

  const dateStyle = hovered === "date" ? { ...activePill, ...hoverPill } : activePill;
  const tenantsStyle = hovered === "tenants" ? { ...passivePill, ...hoverPill } : passivePill;

  return (
    <div className="dashboard-header-actions" style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <Link
        href={`/restaurant-analytics/overview?range=${dateRangeKey}`}
        className="dashboard-badge-pill"
        style={dateStyle}
        aria-current="page"
        onMouseEnter={() => setHovered("date")}
        onMouseLeave={() => setHovered(null)}
      >
        {visibleDateRangeLabel}
      </Link>

      {!isTenant && (
        <Link
          href="/restaurant-analytics/tenants"
          className="dashboard-badge-pill"
          style={tenantsStyle}
          onMouseEnter={() => setHovered("tenants")}
          onMouseLeave={() => setHovered(null)}
        >
          Tenants
        </Link>
      )}

      <span className="dashboard-badge-pill" style={activePill}>{modeLabel}</span>
      <span className="dashboard-badge-pill" style={activePill}>{visibleStatus}</span>
    </div>
  );
}
