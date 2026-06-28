"use client";

import {
  appliedDiscountKindLabel,
  commercialDiscountBreakdownLabels,
  eurosFromCents,
  formatDiscountPercentLabel,
} from "@/lib/commercial/commercial-pricing-display";
import type { CommercialPricingSnapshot } from "@/lib/commercial/pricing-snapshot";

export default function CommercialDiscountBreakdown(props: {
  lang?: "fr" | "en";
  snapshot: CommercialPricingSnapshot;
  showAgencyBanner?: boolean;
}) {
  const lang = props.lang ?? "fr";
  const labels = commercialDiscountBreakdownLabels(lang);
  const snapshot = props.snapshot;

  return (
    <div className="commercial-discount-breakdown">
      {props.showAgencyBanner && snapshot.agencyModeActive ? (
        <div className="commercial-discount-agency-banner">
          <strong>{labels.agencyMode}</strong>
          <p>{lang === "fr" ? snapshot.clientMessageFr : snapshot.clientMessageEn}</p>
        </div>
      ) : null}

      <div className="commercial-discount-row">
        <span>{labels.basePrice}</span>
        <span>{eurosFromCents(snapshot.packBaseMonthlyCents, lang)} / {lang === "fr" ? "mois" : "mo"}</span>
      </div>

      {snapshot.durationDiscountPercent > 0 ? (
        <div className="commercial-discount-row muted">
          <span>{labels.durationDiscount}</span>
          <span>{formatDiscountPercentLabel(snapshot.durationDiscountPercent, lang)}</span>
        </div>
      ) : null}

      {snapshot.volumeDiscountPercent > 0 ? (
        <div className="commercial-discount-row muted">
          <span>{labels.volumeDiscount}</span>
          <span>{formatDiscountPercentLabel(snapshot.volumeDiscountPercent, lang)}</span>
        </div>
      ) : null}

      {snapshot.appliedDiscountPercent > 0 ? (
        <div className="commercial-discount-row highlight">
          <span>{labels.bestDiscount}</span>
          <span>
            {formatDiscountPercentLabel(snapshot.appliedDiscountPercent, lang)}
            {" "}
            ({appliedDiscountKindLabel(snapshot.appliedDiscountKind, lang)})
          </span>
        </div>
      ) : null}

      <p className="commercial-discount-note">{labels.noStacking}</p>

      <style jsx>{`
        .commercial-discount-breakdown { display: grid; gap: 8px; margin-top: 12px; }
        .commercial-discount-agency-banner {
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid rgba(16,185,129,.35);
          background: rgba(16,185,129,.08);
        }
        .commercial-discount-agency-banner strong { display: block; margin-bottom: 6px; }
        .commercial-discount-agency-banner p { margin: 0; line-height: 1.45; }
        .commercial-discount-row { display: flex; justify-content: space-between; gap: 12px; }
        .commercial-discount-row.muted { color: #a8a29e; font-size: 0.95rem; }
        .commercial-discount-row.highlight { font-weight: 600; }
        .commercial-discount-note { margin: 4px 0 0; color: #a8a29e; font-size: 0.9rem; line-height: 1.4; }
      `}</style>
    </div>
  );
}
