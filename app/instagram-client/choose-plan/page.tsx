import { Suspense } from "react";
import CommercialCheckoutForm from "@/app/instagram-growth/checkout/CommercialCheckoutForm";

export const metadata = {
  title: "Choisir une offre — Espace client Instagram",
};

export default function ClientChoosePlanPage() {
  return (
    <main style={{ minHeight: "100dvh", background: "#09090b" }}>
      <Suspense fallback={<div style={{ color: "#fff", padding: 32 }}>Chargement…</div>}>
        <CommercialCheckoutForm flowType="additional_account" lang="fr" />
      </Suspense>
    </main>
  );
}
