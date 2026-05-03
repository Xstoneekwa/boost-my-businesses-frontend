"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type ExportReportButtonProps = {
  label: string;
  range?: string;
  lang?: string;
  fullWidth?: boolean;
  variant?: "primary" | "row";
  size?: "normal" | "compact";
};

const AC = "#F59E0B";
const AC_TEXT = "#FBBF24";

export default function ExportReportButton({
  label,
  range = "30d",
  lang = "en",
  fullWidth = false,
  variant = "primary",
  size = "normal",
}: ExportReportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  async function handleExport() {
    setIsExporting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        window.location.href = "/restaurant-login";
        return;
      }

      const response = await fetch(`/api/restaurant-dashboard-export?range=${encodeURIComponent(range)}&lang=${encodeURIComponent(lang)}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `restaurant-dashboard-${range}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={handleExport}
        disabled={isExporting}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          width: "100%",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(7,17,31,0.38)",
          borderRadius: 13,
          padding: "12px 13px",
          color: "rgba(255,255,255,0.78)",
          font: "inherit",
          fontSize: 13,
          fontWeight: 700,
          cursor: isExporting ? "wait" : "pointer",
        }}
      >
        {isExporting ? `${label}...` : label}
        <span style={{ color: AC_TEXT }}>→</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={isExporting}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: fullWidth ? "100%" : undefined,
        minHeight: 34,
        padding: size === "compact" ? "7px 10px" : "8px 12px",
        border: "none",
        borderRadius: 999,
        background: AC,
        color: "#160b02",
        font: "inherit",
        fontSize: size === "compact" ? 11 : 12,
        fontWeight: 900,
        cursor: isExporting ? "wait" : "pointer",
        boxShadow: "0 8px 28px rgba(245,158,11,0.16)",
      }}
    >
      {isExporting ? `${label}...` : label}
    </button>
  );
}
