"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type OfferPayload = {
  available: boolean;
  outreachUnavailableReason: string | null;
  outreachActivationPath: string | null;
  addonKey?: string;
  displayNameFr?: string;
  displayNameEn?: string;
  baseMonthlyPriceCents?: number | null;
  accountId?: string;
};

function euros(cents: number | null | undefined, lang: "fr" | "en") {
  if (!Number.isFinite(cents) || !cents) return "—";
  const amount = (cents / 100).toFixed(2);
  return lang === "fr" ? `${amount.replace(".", ",")} € / mois` : `€${amount} / month`;
}

export default function OutreachActivationForm(props: { lang?: "fr" | "en" }) {
  const lang = props.lang ?? "fr";
  const searchParams = useSearchParams();
  const accountId = useMemo(() => searchParams.get("account_id")?.trim() ?? "", [searchParams]);
  const [offer, setOffer] = useState<OfferPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadOffer() {
      setLoading(true);
      setError("");
      if (!accountId) {
        setOffer(null);
        setError(lang === "fr" ? "Compte Instagram manquant." : "Missing Instagram account.");
        setLoading(false);
        return;
      }
      const response = await fetch(
        `/api/instagram-client/outreach-activation/offer?account_id=${encodeURIComponent(accountId)}`,
        { headers: { Accept: "application/json" }, cache: "no-store" },
      );
      const payload = await response.json() as { ok?: boolean; data?: OfferPayload; error?: string };
      if (cancelled) return;
      setLoading(false);
      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error || (lang === "fr" ? "Impossible de charger l'offre." : "Could not load the offer."));
        return;
      }
      setOffer(payload.data);
    }
    void loadOffer();
    return () => { cancelled = true; };
  }, [accountId, lang]);

  return (
    <div className="commercial-checkout" style={{ maxWidth: 720, margin: "0 auto", padding: 32 }}>
      <div className="commercial-checkout-banner">
        {lang === "fr"
          ? "Activation de la prospection Instagram — aucun envoi automatique avant confirmation."
          : "Instagram outreach activation — no automatic sending before confirmation."}
      </div>
      <h1>{lang === "fr" ? "Activer la prospection" : "Activate outreach"}</h1>
      {loading ? <p>{lang === "fr" ? "Chargement…" : "Loading…"}</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
      {!loading && offer && !offer.available ? (
        <p>{lang === "fr"
          ? "L'activation de la prospection n'est pas encore disponible."
          : "Outreach activation is not available yet."}</p>
      ) : null}
      {!loading && offer?.available ? (
        <div className="commercial-checkout-lines">
          <div className="line">
            <strong>{lang === "fr" ? "Option" : "Option"}</strong>
            <div>{lang === "fr" ? offer.displayNameFr : offer.displayNameEn}</div>
            <div>{euros(offer.baseMonthlyPriceCents, lang)}</div>
          </div>
          <p style={{ color: "#a1a1aa", fontSize: "0.9rem", lineHeight: 1.5 }}>
            {lang === "fr"
              ? "Le paiement et l'activation de l'option seront finalisés via un checkout authentifié. Aucune activation directe depuis cette page."
              : "Payment and option activation will be completed through an authenticated checkout. This page does not activate outreach directly."}
          </p>
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <Link className="cd-btn cd-btn-soft" href="/instagram-client">
          {lang === "fr" ? "Retour au dashboard" : "Back to dashboard"}
        </Link>
      </div>
    </div>
  );
}
