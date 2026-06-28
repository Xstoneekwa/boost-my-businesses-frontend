"use client";

import { useEffect, useState } from "react";
import type { CommercialPricingSnapshot } from "@/lib/commercial/pricing-snapshot";
import { commercialDiscountBreakdownLabels } from "@/lib/commercial/commercial-pricing-display";

type PricingStatusPayload = {
  agencyModeActive: boolean;
  agencyDisplayCount: number;
  billableAccountCount: number;
  pricingSnapshot: CommercialPricingSnapshot;
};

export default function ClientAgencyModeBanner(props: { lang?: "fr" | "en" }) {
  const lang = props.lang ?? "fr";
  const labels = commercialDiscountBreakdownLabels(lang);
  const [status, setStatus] = useState<PricingStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadStatus() {
      try {
        const response = await fetch("/api/instagram-client/commercial/pricing-status", {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const payload = await response.json() as {
          ok?: boolean;
          data?: PricingStatusPayload;
        };
        if (!cancelled && payload.ok && payload.data) {
          setStatus(payload.data);
        }
      } catch {
        if (!cancelled) setStatus(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadStatus();
    return () => { cancelled = true; };
  }, []);

  if (loading || !status?.agencyModeActive) return null;

  const message = lang === "fr"
    ? status.pricingSnapshot.clientMessageFr
    : status.pricingSnapshot.clientMessageEn;

  return (
    <section className="client-agency-banner" aria-label={labels.agencyMode}>
      <div className="client-agency-badge">{labels.agencyMode}</div>
      <p>{message}</p>
      <style jsx>{`
        .client-agency-banner {
          margin: 0 0 16px;
          padding: 14px 16px;
          border-radius: 14px;
          border: 1px solid rgba(16,185,129,.35);
          background: rgba(16,185,129,.08);
        }
        .client-agency-badge {
          display: inline-block;
          margin-bottom: 8px;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(16,185,129,.18);
          font-size: 0.82rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .client-agency-banner p {
          margin: 0;
          line-height: 1.45;
        }
      `}</style>
    </section>
  );
}
